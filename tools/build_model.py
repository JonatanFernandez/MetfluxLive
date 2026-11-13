#!/usr/bin/env python3
"""Stage 1: convert a standard-GEM repository (zip or folder) into compact JSON.

Outputs in data/<slug>/:
  model.json       metabolites, reactions, subsystems, genes, compartments
  structures.json  2D depictions + symmetry orbits per (compartment-less) metabolite
and in tools/cache/<slug>/:
  canon.json       canonical SMILES per metabolite (input for build_atommaps.py)

Usage:
  build_model.py <zip-or-dir> <slug> [--structures-from <other-slug>]
"""
import argparse, csv, io, json, os, re, sys, zipfile
from pathlib import Path

import yaml
from rdkit import Chem, RDLogger
from rdkit.Chem import rdDepictor

RDLogger.DisableLog("rdApp.*")
ROOT = Path(__file__).resolve().parent.parent


# ---------------------------------------------------------------- input ----
class Source:
    """Uniform access to files inside a zip archive or a directory."""

    def __init__(self, path):
        self.path = Path(path)
        self.zip = zipfile.ZipFile(path) if self.path.is_file() else None
        if self.zip:
            self.names = self.zip.namelist()
        else:
            self.names = [str(p.relative_to(self.path)) for p in self.path.rglob("*") if p.is_file()]

    def find(self, pattern):
        rx = re.compile(pattern)
        hits = [n for n in self.names if rx.search(n)]
        return hits[0] if hits else None

    def read(self, name):
        if self.zip:
            return self.zip.read(name).decode("utf-8")
        return (self.path / name).read_text("utf-8")


def omap(node):
    """Convert PyYAML !!omap output (lists of pairs) into plain dicts."""
    if isinstance(node, list):
        if node and all(isinstance(x, tuple) and len(x) == 2 for x in node):
            return {k: omap(v) for k, v in node}
        return [omap(x) for x in node]
    if isinstance(node, dict):
        return {k: omap(v) for k, v in node.items()}
    return node


def read_tsv(text):
    rows = list(csv.DictReader(io.StringIO(text), delimiter="\t"))
    return [{k: (v or "").strip('"') for k, v in r.items()} for r in rows]


# ----------------------------------------------------------- structures ----
def proper_orbits(mol, max_matches=2000):
    """Groups of atoms interchangeable by a *proper* symmetry operation.

    Atoms swapped only by a mirror operation (prochiral arms, e.g. the two
    CH2-COOH arms of citrate) are distinguishable by enzymes and must not be
    scrambled; atoms swapped by a rotation (succinate, fumarate) are.
    """
    n = mol.GetNumAtoms()
    if n > 120:
        return []
    try:
        matches = mol.GetSubstructMatches(mol, uniquify=False, useChirality=True, maxMatches=max_matches)
    except Exception:
        return []
    if len(matches) <= 1 or len(matches) >= max_matches:
        return []
    parent = list(range(n))

    def find(a):
        while parent[a] != a:
            parent[a] = parent[parent[a]]
            a = parent[a]
        return a

    for sig in matches:
        if all(sig[i] == i for i in range(n)):
            continue
        proper = True
        for a in range(n):
            if sig[a] != a:
                continue
            atom = mol.GetAtomWithIdx(a)
            nh = atom.GetTotalNumHs()
            nbrs = [x.GetIdx() for x in atom.GetNeighbors()]
            if atom.GetIsAromatic() or len(nbrs) + nh != 4 or nh >= 2:
                continue
            if any(b.GetBondTypeAsDouble() != 1.0 for b in atom.GetBonds()):
                continue
            # parity of the permutation induced on the neighbours
            seen, transpositions = set(), 0
            for x in nbrs:
                if x in seen:
                    continue
                length, y = 0, x
                while y not in seen:
                    seen.add(y)
                    y = sig[y]
                    length += 1
                transpositions += length - 1
            if transpositions % 2 == 1:
                proper = False
                break
        if not proper:
            continue
        for i in range(n):
            a, b = find(i), find(sig[i])
            if a != b:
                parent[a] = b
    groups = {}
    for i in range(n):
        groups.setdefault(find(i), []).append(i)
    return [g for g in groups.values() if len(g) > 1]


def depict(smiles):
    """Return (canonical smiles, structure dict) or None if unparsable."""
    mol = Chem.MolFromSmiles(smiles)
    if mol is None or mol.GetNumAtoms() == 0:
        return None
    canon = Chem.MolToSmiles(mol)
    mol = Chem.MolFromSmiles(canon)  # atom order == canonical SMILES order
    if mol is None:
        return None
    orbits = proper_orbits(mol)
    draw = Chem.Mol(mol)
    try:
        Chem.Kekulize(draw, clearAromaticFlags=True)
    except Exception:
        pass
    rdDepictor.Compute2DCoords(draw)
    try:
        Chem.WedgeMolBonds(draw, draw.GetConformer())
    except Exception:
        pass
    conf = draw.GetConformer()
    e, h, q, x, y, b = [], [], [], [], [], []
    for a in draw.GetAtoms():
        p = conf.GetAtomPosition(a.GetIdx())
        e.append(a.GetSymbol() if a.GetAtomicNum() else "R")
        h.append(a.GetTotalNumHs())
        q.append(a.GetFormalCharge())
        x.append(round(p.x, 2))
        y.append(round(-p.y, 2))
    for bd in draw.GetBonds():
        order = {1.0: 1, 2.0: 2, 3.0: 3}.get(bd.GetBondTypeAsDouble(), 1)
        wedge = {Chem.BondDir.BEGINWEDGE: 1, Chem.BondDir.BEGINDASH: 2}.get(bd.GetBondDir(), 0)
        b += [bd.GetBeginAtomIdx(), bd.GetEndAtomIdx(), order, wedge]
    s = {"e": e, "h": h, "x": x, "y": y, "b": b}
    if any(q):
        s["q"] = q
    if orbits:
        s["sym"] = orbits
    return canon, s


# ----------------------------------------------------------------- main ----
def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("source")
    ap.add_argument("slug")
    ap.add_argument("--structures-from", help="slug of an already built model to borrow SMILES from")
    args = ap.parse_args()

    src = Source(args.source)
    yml_name = src.find(r"model/[^/]+\.ya?ml$")
    if not yml_name:
        sys.exit("No model/*.yml found in source")
    print("parsing", yml_name)
    class loader(getattr(yaml, "CSafeLoader", yaml.SafeLoader)):
        pass

    # YAML 1.1 reads bare NO / yes / on as booleans; metabolite names such as "NO" must stay text
    loader.yaml_implicit_resolvers = {
        ch: [(tag, rx) for tag, rx in lst if tag != "tag:yaml.org,2002:bool"]
        for ch, lst in loader.yaml_implicit_resolvers.items()
    }
    model = omap(yaml.load(src.read(yml_name), Loader=loader))
    if isinstance(model, list):  # top-level omap already flattened into a dict normally
        model = {k: v for d in model for k, v in d.items()}
    meta = model["metaData"]

    def tsv(name):
        f = src.find(r"model/%s\.tsv$" % name)
        return read_tsv(src.read(f)) if f else []

    met_x = {r["mets"]: r for r in tsv("metabolites")}
    rxn_x = {r["rxns"]: r for r in tsv("reactions")}
    gene_x = {r["genes"]: r for r in tsv("genes")}

    out = ROOT / "data" / args.slug
    cache = ROOT / "tools" / "cache" / args.slug
    out.mkdir(parents=True, exist_ok=True)
    cache.mkdir(parents=True, exist_ok=True)

    borrowed = {}
    if args.structures_from:
        p = ROOT / "tools" / "cache" / args.structures_from / "smiles.json"
        borrowed = json.loads(p.read_text())

    # ---- metabolites
    comps = model["compartments"]
    mets, met_index, bases, base_index, smiles_of = [], {}, [], {}, {}
    for m in model["metabolites"]:
        mid = m["id"]
        x = met_x.get(mid, {})
        base = x.get("metsNoComp") or re.sub(r"[a-z]$", "", mid)
        if base not in base_index:
            base_index[base] = len(bases)
            entry = {"id": base, "n": str(m.get("name", base)), "f": str(m.get("formula") or "")}
            for key, col in (("kegg", "metKEGGID"), ("hmdb", "metHMDBID"), ("chebi", "metChEBIID"),
                             ("bigg", "metBiGGID"), ("mnx", "metMetaNetXID")):
                if x.get(col):
                    entry[key] = x[col]
            bases.append(entry)
            smi = x.get("metSmiles") or borrowed.get(base, "")
            if smi:
                smiles_of[base] = smi
        met_index[mid] = len(mets)
        rec = {"id": mid, "b": base_index[base], "c": m.get("compartment", mid[-1])}
        ch = m.get("charge")
        if ch:
            rec["q"] = int(ch)
        mets.append(rec)

    # ---- structures
    print("depicting", len(smiles_of), "structures")
    structures, canon = {}, {}
    for base, smi in smiles_of.items():
        r = depict(smi)
        if r:
            canon[base], structures[base] = r
    for b in bases:
        if b["id"] in structures:
            b["s"] = 1

    # ---- genes
    genes = []
    for g in model.get("genes", []):
        gx = gene_x.get(g["id"], {})
        sym = g.get("name") or gx.get("geneSymbols") or g["id"]
        genes.append([g["id"], sym, gx.get("geneNames", "")])
    sym_of = {g[0]: g[1] for g in genes}

    # ---- reactions
    subsystems, sub_index, rxns = [], {}, []
    for r in model["reactions"]:
        ss = r.get("subsystem") or ["Unassigned"]
        ss = ss[0] if isinstance(ss, list) else ss
        if ss not in sub_index:
            sub_index[ss] = len(subsystems)
            subsystems.append(ss)
        st = r.get("metabolites") or {}
        rule = r.get("gene_reaction_rule") or ""
        rule = re.sub(r"[A-Za-z0-9_.\-]+", lambda mo: sym_of.get(mo.group(0), mo.group(0)), rule)
        rec = {
            "id": r["id"], "n": str(r.get("name") or r["id"]),
            "m": [met_index[k] for k in st], "c": [float(v) for v in st.values()],
            "lb": float(r.get("lower_bound", 0)), "ub": float(r.get("upper_bound", 1000)),
            "ss": sub_index[ss],
        }
        if rule:
            rec["g"] = rule
        ann = r.get("annotation") or {}
        ec = ann.get("ec-code") or r.get("eccodes")
        if ec:
            rec["ec"] = ec if isinstance(ec, list) else [ec]
        x = rxn_x.get(r["id"], {})
        for key, col in (("kegg", "rxnKEGGID"), ("rhea", "rxnRheaID"), ("bigg", "rxnBiGGID")):
            if x.get(col):
                rec[key] = x[col]
        if r.get("objective_coefficient"):
            rec["obj"] = 1
        rxns.append(rec)

    doc = {
        "meta": {"id": meta.get("id") or meta.get("short_name") or args.slug,
                 "name": meta.get("name") or meta.get("full_name") or meta.get("description") or "",
                 "version": str(meta.get("version", "")), "taxonomy": str(meta.get("taxonomy", "")),
                 "source": meta.get("sourceUrl") or meta.get("github") or "", "slug": args.slug},
        "compartments": comps, "subsystems": subsystems, "bases": bases, "mets": mets, "rxns": rxns, "genes": genes,
    }
    dump = lambda o: json.dumps(o, separators=(",", ":"), ensure_ascii=False)
    (out / "model.json").write_text(dump(doc))
    (out / "structures.json").write_text(dump(structures))
    (cache / "canon.json").write_text(dump(canon))
    (cache / "smiles.json").write_text(dump(smiles_of))
    print(f"{args.slug}: {len(mets)} mets ({len(bases)} unique, {len(structures)} with structure), "
          f"{len(rxns)} rxns, {len(subsystems)} subsystems, {len(genes)} genes")
    for f in ("model.json", "structures.json"):
        print(f"  {f}: {os.path.getsize(out / f) / 1e6:.1f} MB")


if __name__ == "__main__":
    main()
