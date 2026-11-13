#!/usr/bin/env python3
"""Stage 2: atom-to-atom mappings for every reaction whose metabolites have structures.

Strategy per reaction (substrates -> products, heavy atoms only):
  1. identity   the same metabolite on both sides (transport) maps atom i -> atom i
  2. currency   cofactor pairs (ATP/ADP, NAD+/NADH, ...) are mapped by maximum common substructure
  3. mapper     the remainder is mapped with RXNMapper (attention-guided, Schwaller et al. 2021)
  3b. mcs       reactions RXNMapper cannot take (R-groups, too long) are mapped greedily by repeated
                maximum common substructure between the remaining molecules (lower confidence)
  4. overrides  tools/atommap_overrides.json replaces computed maps for hand-curated reactions

Output data/<slug>/atommaps.json:
  { rxnId: { "k": "id"|"map"|"mcs"|"part", "c": confidence,
             "s": [[subLocal, prodLocal, -1 | [sAtom, pAtom, ...], copies?], ...] } }
"local" indices are positions in the reaction's metabolite list in model.json.
"part" means some atoms could not be mapped; the tracer falls back to metabolite-level mixing for them.

Usage: build_atommaps.py <slug> [--limit N]
"""
import argparse, json, sys
from collections import Counter
from pathlib import Path

from rdkit import Chem, RDLogger
from rdkit.Chem import rdFMCS

RDLogger.DisableLog("rdApp.*")
ROOT = Path(__file__).resolve().parent.parent

CURRENCY_PAIRS = [
    ("ATP", "ADP"), ("ATP", "AMP"), ("GTP", "GDP"), ("GTP", "GMP"), ("UTP", "UDP"), ("UTP", "UMP"),
    ("CTP", "CDP"), ("CTP", "CMP"), ("ITP", "IDP"), ("dATP", "dADP"), ("dGTP", "dGDP"),
    ("NAD+", "NADH"), ("NADP+", "NADPH"), ("FAD", "FADH2"), ("FMN", "FMNH2"),
    ("ubiquinone", "ubiquinol"),
]
MAX_COPIES = 60
MAX_ATOMS = 330
MCS_CONF = 0.3


def as_int(c):
    r = round(abs(c))
    return r if abs(abs(c) - r) < 1e-6 and 1 <= r <= MAX_COPIES else None


def mcs_pairs(ma, mb):
    res = rdFMCS.FindMCS([ma, mb], atomCompare=rdFMCS.AtomCompare.CompareElements,
                         bondCompare=rdFMCS.BondCompare.CompareAny, timeout=5)
    if not res.smartsString:
        return []
    patt = Chem.MolFromSmarts(res.smartsString)
    a, b = ma.GetSubstructMatch(patt), mb.GetSubstructMatch(patt)
    out = []
    for i, j in zip(a, b):
        out += [i, j]
    return out


def reduce_coa(mol, coa_q, s_pos):
    """Strip the CoA body (keeping the thiol S) so long acyl-CoA reactions fit the mapper.

    Returns (smiles, orig, s_atom, core) where orig[i] is the original index of the i-th atom of
    `smiles` and core lists the removed atoms in query order; None if the molecule has no CoA.
    """
    match = mol.GetSubstructMatch(coa_q)
    if not match:
        return None
    core = [a for k, a in enumerate(match) if k != s_pos]
    rw = Chem.RWMol(mol)
    for a in rw.GetAtoms():
        a.SetIntProp("o", a.GetIdx())
    for idx in sorted(core, reverse=True):
        rw.RemoveAtom(idx)
    try:
        Chem.SanitizeMol(rw)
        smi = Chem.MolToSmiles(rw)
        order = list(rw.GetPropsAsDict(includePrivate=True, includeComputed=True)["_smilesAtomOutputOrder"])
    except Exception:
        return None
    return smi, [rw.GetAtomWithIdx(i).GetIntProp("o") for i in order], match[s_pos], core


def greedy_mcs(smols, pmols, rounds=6):
    """Map leftover molecules by repeatedly taking the largest common substructure.

    Returns [substrateIdx, substrateAtom, productIdx, productAtom] quadruples.
    """
    def fragment(mol, alive):
        rw = Chem.RWMol(mol)
        for a in rw.GetAtoms():
            a.SetIntProp("o", a.GetIdx())
        for idx in sorted(set(range(mol.GetNumAtoms())) - alive, reverse=True):
            rw.RemoveAtom(idx)
        try:
            Chem.SanitizeMol(rw, catchErrors=True)
        except Exception:
            pass
        return rw

    alive_s = [set(range(m.GetNumAtoms())) for m in smols]
    alive_p = [set(range(m.GetNumAtoms())) for m in pmols]
    out = []
    for _ in range(rounds):
        best = None
        for i, sm in enumerate(smols):
            if len(alive_s[i]) < 1:
                continue
            fs = fragment(sm, alive_s[i])
            for j, pm in enumerate(pmols):
                if len(alive_p[j]) < 1:
                    continue
                bound = min(len(alive_s[i]), len(alive_p[j]))
                if best and bound <= best[0]:
                    continue
                fp = fragment(pm, alive_p[j])
                try:
                    res = rdFMCS.FindMCS([fs, fp], atomCompare=rdFMCS.AtomCompare.CompareElements,
                                         bondCompare=rdFMCS.BondCompare.CompareAny, timeout=2)
                except Exception:
                    continue
                if res.numAtoms < 1 or (best and res.numAtoms <= best[0]):
                    continue
                patt = Chem.MolFromSmarts(res.smartsString)
                if patt is None:
                    continue
                a, b = fs.GetSubstructMatch(patt), fp.GetSubstructMatch(patt)
                if not a or not b:
                    continue
                best = (res.numAtoms, i, j,
                        [fs.GetAtomWithIdx(x).GetIntProp("o") for x in a],
                        [fp.GetAtomWithIdx(x).GetIntProp("o") for x in b])
        if not best or best[0] < 2:
            break
        _, i, j, sa, pa = best
        for x, y in zip(sa, pa):
            out.append([i, x, j, y])
        alive_s[i] -= set(sa)
        alive_p[j] -= set(pa)
    return out


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("slug")
    ap.add_argument("--limit", type=int, default=0)
    args = ap.parse_args()

    data = ROOT / "data" / args.slug
    cache_dir = ROOT / "tools" / "cache"
    model = json.loads((data / "model.json").read_text())
    canon = json.loads((cache_dir / args.slug / "canon.json").read_text())
    cache_file = cache_dir / "rxnmapper_cache.json"  # shared between models
    cache = json.loads(cache_file.read_text()) if cache_file.exists() else {}
    ov_file = ROOT / "tools" / "atommap_overrides.json"
    overrides = json.loads(ov_file.read_text()) if ov_file.exists() else {}

    bases, mets = model["bases"], model["mets"]
    name_of = [b["n"] for b in bases]
    mols, wild = {}, set()

    def mol_of(bi):
        bid = bases[bi]["id"]
        if bid not in mols:
            smi = canon.get(bid)
            m = Chem.MolFromSmiles(smi) if smi else None
            mols[bid] = (smi, m)
            if m is not None and any(a.GetAtomicNum() == 0 for a in m.GetAtoms()):
                wild.add(bid)  # R-groups: RXNMapper cannot take them, the MCS fallback can
        return mols[bid]

    coa_q, coa_s = None, -1
    for bi, b in enumerate(bases):
        if b["n"] == "CoA" and mol_of(bi)[1] is not None:
            coa_q = mol_of(bi)[1]
            coa_s = next(a.GetIdx() for a in coa_q.GetAtoms() if a.GetSymbol() == "S")
    reduced_cache = {}

    def reduced(bi):
        if bi not in reduced_cache:
            reduced_cache[bi] = reduce_coa(mol_of(bi)[1], coa_q, coa_s) if coa_q is not None else None
        return reduced_cache[bi]

    pair_set = set(CURRENCY_PAIRS) | {(b, a) for a, b in CURRENCY_PAIRS}
    mcs_cache = {}
    base_by_name = {b["n"]: i for i, b in enumerate(bases)}
    for rule in overrides.get("pairs", []):
        ia, ib = base_by_name.get(rule["a"]), base_by_name.get(rule["b"])
        if ia is None or ib is None or any(canon.get(bases[base_by_name[n]]["id"]) != smi for n, smi in rule["smiles"].items()):
            print("  pair rule skipped:", rule["a"], rule["b"])
            continue
        pair_set |= {(rule["a"], rule["b"]), (rule["b"], rule["a"])}
        mcs_cache[(ia, ib)] = [x for ab in rule["atoms"] for x in ab]
        mcs_cache[(ib, ia)] = [x for ab in rule["atoms"] for x in ab[::-1]]
    result, jobs, mcs_jobs = {}, [], []  # jobs: (rxnId, rxn_smiles, sub_slots, prod_slots)
    stats = Counter()

    rxns = model["rxns"][: args.limit] if args.limit else model["rxns"]
    rxn_by_id = {r["id"]: r for r in model["rxns"]}
    for r in rxns:
        if len(r["m"]) < 2:
            stats["exchange"] += 1
            continue
        subs = [(i, as_int(c)) for i, c in enumerate(r["c"]) if c < 0]
        prods = [(i, as_int(c)) for i, c in enumerate(r["c"]) if c > 0]
        if not subs or not prods:
            stats["exchange"] += 1
            continue
        base = lambda loc: mets[r["m"][loc]]["b"]
        segs, partial = [], False
        left = {i: n for i, n in subs}
        right = {i: n for i, n in prods}
        if any(n is None for n in left.values()) or any(n is None for n in right.values()):
            partial = True
        # 1. identity
        for si in list(left):
            for pi in list(right):
                if base(si) == base(pi) and left.get(si) and right.get(pi):
                    n = min(left[si], right[pi])
                    segs.append([si, pi, -1, n])
                    left[si] -= n
                    right[pi] -= n
        # 2. currency pairs
        for si in list(left):
            for pi in list(right):
                if left.get(si) and right.get(pi) and (name_of[base(si)], name_of[base(pi)]) in pair_set:
                    ma, mb = mol_of(base(si))[1], mol_of(base(pi))[1]
                    if ma is None or mb is None:
                        continue
                    key = (base(si), base(pi))
                    if key not in mcs_cache:
                        mcs_cache[key] = mcs_pairs(ma, mb)
                    n = min(left[si], right[pi])
                    segs.append([si, pi, mcs_cache[key], n])
                    left[si] -= n
                    right[pi] -= n
        # 3. remainder -> RXNMapper
        rem_s = [(i, n) for i, n in left.items() if n]
        rem_p = [(i, n) for i, n in right.items() if n]

        def expand(rem):
            slots, smiles, natoms, ok, has_wild = [], [], 0, True, False
            for loc, n in rem:
                smi, m = mol_of(base(loc))
                if m is None:
                    if smi is None and bases[base(loc)]["f"] in ("H", "", "e-"):
                        continue  # protons / electrons carry no heavy atoms
                    ok = False
                    continue
                if m.GetNumHeavyAtoms() == 0:
                    continue
                if bases[base(loc)]["id"] in wild:
                    has_wild = True
                for _ in range(n):
                    slots.append(loc)
                    smiles.append(smi)
                    natoms += m.GetNumAtoms()
            return slots, smiles, natoms, ok, has_wild

        ss, ssmi, sn, sok, sw = expand(rem_s)
        ps, psmi, pn, pok, pw = expand(rem_p)
        entry = {"k": "id", "s": segs}
        if not (sok and pok):
            partial = True
        if ssmi and psmi:
            big = sn + pn > MAX_ATOMS
            if big and not (sw or pw) and sok and pok:
                # try again with the CoA bodies stripped
                red_s = [reduced(base(x)) for x in ss]
                red_p = [reduced(base(x)) for x in ps]
                size = lambda slots, reds: sum(len(rd[1]) if rd else mol_of(base(x))[1].GetNumAtoms() for x, rd in zip(slots, reds))
                if (sum(1 for x in red_s if x) == sum(1 for x in red_p if x) > 0
                        and size(ss, red_s) + size(ps, red_p) <= MAX_ATOMS):
                    smi = (".".join(rd[0] if rd else sm for rd, sm in zip(red_s, ssmi)) + ">>" +
                           ".".join(rd[0] if rd else sm for rd, sm in zip(red_p, psmi)))
                    jobs.append((r["id"], smi, ss, ps, (red_s, red_p)))
                    entry["k"] = "map"
                    big = False
                    stats["coa_reduced"] += 1
                    sn = pn = 0
            if entry["k"] == "map":
                pass
            elif big or sw or pw or not (sok and pok):
                if len(ssmi) + len(psmi) <= 14:
                    mcs_jobs.append((r["id"], ss, ps))
                else:
                    partial = True
                    stats["too_big"] += 1
            else:
                jobs.append((r["id"], ".".join(ssmi) + ">>" + ".".join(psmi), ss, ps, None))
                entry["k"] = "map"
        elif ssmi or psmi:
            # leftover atoms only on one side (e.g. phosphate release): nothing to map
            if any(a.GetSymbol() == "C" for smi in ssmi + psmi for a in Chem.MolFromSmiles(smi).GetAtoms()):
                partial = True
        if partial:
            entry["k"] = "part" if entry["k"] != "map" else "map"
            entry["p"] = 1
        result[r["id"]] = entry
        stats[entry["k"] + ("+partial" if partial and entry["k"] == "map" else "")] += 1

    print("classified:", dict(stats), "| mapper jobs:", len(jobs), flush=True)

    # ---- run RXNMapper on uncached reactions
    todo = sorted({j[1] for j in jobs if j[1] not in cache}, key=len)
    if todo:
        from rxnmapper import RXNMapper
        mapper = RXNMapper()
        print("mapping", len(todo), "unique reactions", flush=True)

        def run(batch):
            try:
                for smi, res in zip(batch, mapper.get_attention_guided_atom_maps(batch, canonicalize_rxns=False)):
                    cache[smi] = [res["mapped_rxn"], round(float(res["confidence"]), 3)]
            except Exception as ex:
                if len(batch) == 1:
                    cache[batch[0]] = [None, 0, str(ex)[:80]]
                else:
                    for one in batch:
                        run([one])

        B = 8
        for k in range(0, len(todo), B):
            run(todo[k:k + B])
            if (k // B) % 50 == 0:
                print(f"  {k}/{len(todo)}", flush=True)
                cache_file.write_text(json.dumps(cache))
        cache_file.write_text(json.dumps(cache))

    # ---- decode mapped reactions into atom pairs
    fails = 0
    for rid, smi, ss, ps, red in jobs:
        mapped, conf = cache.get(smi, [None, 0])[:2]
        entry = result[rid]
        ok = False
        if mapped:
            try:
                lhs, rhs = mapped.split(">>")
                lm = [Chem.MolFromSmiles(x) for x in lhs.split(".")]
                rm = [Chem.MolFromSmiles(x) for x in rhs.split(".")]
                if len(lm) == len(ss) and len(rm) == len(ps) and all(lm) and all(rm):
                    where = {}
                    orig = lambda rd, k, i: rd[k][1][i] if rd and rd[k] else i
                    for k, (slot, m) in enumerate(zip(ss, lm)):
                        for a in m.GetAtoms():
                            if a.GetAtomMapNum():
                                where[a.GetAtomMapNum()] = (slot, orig(red and red[0], k, a.GetIdx()), a.GetAtomicNum(), k)
                    pairs = {}
                    for k, (slot, m) in enumerate(zip(ps, rm)):
                        for a in m.GetAtoms():
                            src = where.get(a.GetAtomMapNum())
                            if src and src[2] == a.GetAtomicNum():
                                dst = orig(red and red[1], k, a.GetIdx())
                                pairs.setdefault((src[0], slot), []).extend([src[1], dst])
                                # a mapped thiol S carries its whole CoA body along
                                rs, rp = red and red[0][src[3]], red and red[1][k]
                                if rs and rp and src[1] == rs[2] and dst == rp[2]:
                                    for x, y in zip(rs[3], rp[3]):
                                        pairs[(src[0], slot)].extend([x, y])
                    for (si, pi), flat in pairs.items():
                        entry["s"].append([si, pi, flat])
                    entry["c"] = conf
                    ok = True
            except Exception:
                ok = False
        if not ok:
            fails += 1
            entry["k"] = "id"
            if len(ss) + len(ps) <= 14:
                mcs_jobs.append((rid, ss, ps))
            else:
                entry["k"], entry["p"] = "part", 1
            continue

    # ---- greedy MCS fallback
    mcs_store_file = cache_dir / "mcs_cache.json"
    mcs_store = json.loads(mcs_store_file.read_text()) if mcs_store_file.exists() else {}
    print("mcs fallback jobs:", len(mcs_jobs), flush=True)
    for n, (rid, ss, ps) in enumerate(mcs_jobs):
        r = rxn_by_id[rid]
        bid = lambda loc: bases[mets[r["m"][loc]]["b"]]["id"]
        key = ".".join(bid(x) for x in ss) + ">>" + ".".join(bid(x) for x in ps)
        if key not in mcs_store:
            mcs_store[key] = greedy_mcs([mol_of(mets[r["m"][x]]["b"])[1] for x in ss],
                                        [mol_of(mets[r["m"][x]]["b"])[1] for x in ps])
            if n % 100 == 0:
                print(f"  mcs {n}/{len(mcs_jobs)}", flush=True)
                mcs_store_file.write_text(json.dumps(mcs_store))
        entry = result[rid]
        pairs = {}
        for si, sa, pi, pa in mcs_store[key]:
            pairs.setdefault((ss[si], ps[pi]), []).extend([sa, pa])
        for (sl, pl), flat in pairs.items():
            entry["s"].append([sl, pl, flat])
        entry["k"], entry["c"] = "mcs", MCS_CONF
    mcs_store_file.write_text(json.dumps(mcs_store))
    for rid in [k for k, v in result.items() if not v["s"]]:
        del result[rid]

    # ---- hand-curated overrides (matched by metabolite names, any compartment, either direction)
    applied = 0
    for rule in overrides.get("rules", []):
        bad = [n for n, smi in rule["smiles"].items()
               if canon.get(next((b["id"] for b in bases if b["n"] == n), ""), None) != smi]
        if bad:
            print("  override skipped (structure differs):", rule["name"][:50], bad)
            continue
        want_s, want_p = set(rule["sub"]), set(rule["prod"])
        for r in model["rxns"]:
            names = [name_of[mets[i]["b"]] for i in r["m"]]
            neg = {n for n, c in zip(names, r["c"]) if c < 0}
            pos = {n for n, c in zip(names, r["c"]) if c > 0}
            if want_s <= neg and want_p <= pos:
                flip = False
            elif want_s <= pos and want_p <= neg:
                flip = True
            else:
                continue
            loc = {n: q for q, n in enumerate(names)}
            involved = {loc[n] for n in want_s | want_p}
            entry = result.setdefault(r["id"], {"k": "map", "s": []})
            entry["s"] = [sg for sg in entry["s"] if not (sg[0] in involved and sg[1] in involved)]
            grouped = {}
            for sn, sa, pn, pa in rule["pairs"]:
                key = (loc[pn], loc[sn]) if flip else (loc[sn], loc[pn])
                grouped.setdefault(key, []).extend([pa, sa] if flip else [sa, pa])
            for (sl, pl), flat in grouped.items():
                entry["s"].append([sl, pl, flat])
            entry["k"], entry["c"], entry["cur"] = "map", 1, 1
            entry.pop("p", None)
            applied += 1
    print("curated overrides applied to", applied, "reactions")

    (data / "atommaps.json").write_text(json.dumps(result, separators=(",", ":")))
    kinds = Counter(v["k"] for v in result.values())
    print(f"{args.slug}: {len(result)} reactions with atom transitions {dict(kinds)}; mapper failures {fails}")


if __name__ == "__main__":
    main()
