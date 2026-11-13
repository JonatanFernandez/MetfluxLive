#!/usr/bin/env python3
"""Stage 3: precomputed map layouts.

Output data/<slug>/layout.json:
  currency   base indices hidden from maps (H2O, ATP, ...)
  global     one node per subsystem + structural edges (shared metabolites)
  subs       per subsystem: metabolite and reaction node positions
  listOnly   subsystems too large / unstructured to draw (shown as tables)

Usage: build_layout.py <slug>
"""
import json, math, random, sys
from collections import Counter, defaultdict
from pathlib import Path

import igraph as ig

ROOT = Path(__file__).resolve().parent.parent
CURRENCY_NAMES = {
    "H+", "H2O", "ATP", "ADP", "AMP", "Pi", "PPi", "NAD+", "NADH", "NADP+", "NADPH", "CoA", "O2", "CO2",
    "HCO3-", "FAD", "FADH2", "Na+", "K+", "UDP", "GDP", "GTP", "UTP", "CTP", "CDP", "CMP", "UMP", "GMP",
    "NH4+", "H2O2", "FMN", "FMNH2", "chloride", "Ca2+", "ubiquinone", "ubiquinol", "PAP", "PAPS",
    "ferricytochrome C", "ferrocytochrome C", "thioredoxin", "thioredoxin disulfide",
}
MAX_DRAW = 700  # reactions


def layout_graph(n, edges, weights=None, seed=1):
    random.seed(seed)
    g = ig.Graph(n=n, edges=edges)
    if n <= 2:
        return [(float(i), 0.0) for i in range(n)]
    if n <= 400:
        try:
            lay = g.layout_kamada_kawai(maxiter=60 * n, seed=g.layout_fruchterman_reingold(niter=300, weights=weights).coords)
        except Exception:
            lay = g.layout_fruchterman_reingold(niter=800, weights=weights)
    else:
        lay = g.layout_fruchterman_reingold(niter=1500, weights=weights, grid=False)
    return lay.coords


def pack_components(n, edges, coords_fn):
    """Lay out connected components separately and pack them on a row/shelf layout."""
    g = ig.Graph(n=n, edges=edges)
    comps = sorted(g.connected_components(), key=len, reverse=True)
    pos = [None] * n
    boxes = []
    for comp in comps:
        idx = {v: i for i, v in enumerate(comp)}
        sub_edges = [(idx[a], idx[b]) for a, b in edges if a in idx and b in idx]
        c = coords_fn(len(comp), sub_edges)
        # normalise so that the median edge length is 1
        if sub_edges:
            ls = sorted(math.dist(c[a], c[b]) for a, b in sub_edges)
            scale = 1.0 / max(ls[len(ls) // 2], 1e-6)
        else:
            scale = 1.0
        xs = [p[0] * scale for p in c]
        ys = [p[1] * scale for p in c]
        x0, y0 = min(xs), min(ys)
        boxes.append((comp, [x - x0 for x in xs], [y - y0 for y in ys], max(xs) - x0, max(ys) - y0))
    # shelf packing
    total_area = sum((w + 2) * (h + 2) for _, _, _, w, h in boxes)
    row_w = max(math.sqrt(total_area) * 1.3, max(b[3] for b in boxes) + 2)
    cx = cy = row_h = 0.0
    for comp, xs, ys, w, h in boxes:
        if cx > 0 and cx + w > row_w:
            cx, cy, row_h = 0.0, cy + row_h + 2.0, 0.0
        for v, x, y in zip(comp, xs, ys):
            pos[v] = (cx + x, cy + y)
        cx += w + 2.0
        row_h = max(row_h, h)
    return pos


def main():
    slug = sys.argv[1]
    data = ROOT / "data" / slug
    model = json.loads((data / "model.json").read_text())
    bases, mets, rxns, subsystems = model["bases"], model["mets"], model["rxns"], model["subsystems"]
    deg = Counter()
    for r in rxns:
        for b in {mets[i]["b"] for i in r["m"]}:
            deg[b] += 1
    lower = {n.lower() for n in CURRENCY_NAMES}
    currency = {i for i, b in enumerate(bases) if b["n"].lower() in lower or deg[i] > 0.035 * len(rxns)}
    is_cur = lambda mi: mets[mi]["b"] in currency

    by_ss = defaultdict(list)
    for j, r in enumerate(rxns):
        by_ss[r["ss"]].append(j)
    ss_lower = [s.lower() for s in subsystems]
    transport_ss = {i for i, s in enumerate(ss_lower) if "transport" in s}
    exchange_ss = {i for i, s in enumerate(ss_lower) if "exchange" in s}

    # ---------------- global map
    ss_bases = {s: Counter(mets[i]["b"] for j in js for i in rxns[j]["m"] if not is_cur(i)) for s, js in by_ss.items()}
    nodes = [s for s in range(len(subsystems)) if s not in transport_ss]
    idx = {s: i for i, s in enumerate(nodes)}
    cand = defaultdict(list)
    for a in nodes:
        for b in nodes:
            if a >= b:
                continue
            shared = len(set(ss_bases[a]) & set(ss_bases[b]))
            if shared:
                w = shared / math.sqrt(len(ss_bases[a]) * len(ss_bases[b]))
                cand[a].append((w, b, shared))
                cand[b].append((w, a, shared))
    edge_set = {}
    for a, lst in cand.items():
        for w, b, shared in sorted(lst, reverse=True)[:4]:
            edge_set[(min(a, b), max(a, b))] = (w, shared)
    gedges = [(idx[a], idx[b]) for a, b in edge_set]
    gpos = pack_components(len(nodes), gedges, lambda n, e: layout_graph(n, e))
    # node radius (layout units) grows with the number of reactions; spread and remove overlaps
    rad = [0.10 + 0.035 * math.sqrt(min(len(by_ss[s]), 450)) for s in nodes]
    gpos = [[x * 2.0, y * 2.0] for x, y in gpos]
    random.seed(7)
    for _ in range(600):
        moved = False
        for i in range(len(nodes)):
            for j in range(i + 1, len(nodes)):
                dx, dy = gpos[j][0] - gpos[i][0], gpos[j][1] - gpos[i][1]
                d = math.hypot(dx, dy)
                need = rad[i] + rad[j] + 0.55
                if d < need:
                    if d < 1e-6:
                        dx, dy, d = random.random() - 0.5, random.random() - 0.5, 0.5
                    push = (need - d) / 2 + 1e-3
                    gpos[i][0] -= dx / d * push; gpos[i][1] -= dy / d * push
                    gpos[j][0] += dx / d * push; gpos[j][1] += dy / d * push
                    moved = True
        if not moved:
            break
    glob = {
        "nodes": [{"ss": s, "x": round(gpos[idx[s]][0], 3), "y": round(gpos[idx[s]][1], 3), "n": len(by_ss[s]),
                   "r": round(rad[idx[s]], 3)} for s in nodes],
        "edges": [[a, b, shared] for (a, b), (w, shared) in edge_set.items()],
    }

    # ---------------- per-subsystem maps
    transports = [j for s in transport_ss for j in by_ss[s]]
    met_transports = defaultdict(list)
    for j in transports:
        core = [i for i in rxns[j]["m"] if not is_cur(i)]
        if len(core) >= 2:
            for i in core:
                met_transports[i].append(j)
    subs, list_only = {}, []
    for s, js in by_ss.items():
        if s in transport_ss or s in exchange_ss or len(js) > MAX_DRAW:
            list_only.append(s)
            continue
        met_set = {i for j in js for i in rxns[j]["m"] if not is_cur(i)}
        if not met_set:
            list_only.append(s)
            continue
        # transports linking metabolites already on this map
        extra = set()
        for i in met_set:
            for j in met_transports.get(i, ()):
                core = [k for k in rxns[j]["m"] if not is_cur(k)]
                if all(k in met_set for k in core):
                    extra.add(j)
        rlist = js + sorted(extra)
        mlist = sorted(met_set)
        mi = {m: k for k, m in enumerate(mlist)}
        edges = []
        for k, j in enumerate(rlist):
            for i in rxns[j]["m"]:
                if i in mi:
                    edges.append((mi[i], len(mlist) + k))
        n = len(mlist) + len(rlist)
        pos = pack_components(n, edges, lambda nn, ee: layout_graph(nn, ee))
        subs[str(s)] = {
            "m": mlist, "mx": [round(pos[k][0], 2) for k in range(len(mlist))], "my": [round(pos[k][1], 2) for k in range(len(mlist))],
            "r": rlist, "rx": [round(pos[len(mlist) + k][0], 2) for k in range(len(rlist))],
            "ry": [round(pos[len(mlist) + k][1], 2) for k in range(len(rlist))],
        }
        print(f"  {subsystems[s][:50]:50s} {len(mlist):5d} mets {len(rlist):5d} rxns", flush=True)

    out = {"currency": sorted(currency), "global": glob, "subs": subs, "listOnly": sorted(list_only)}
    (data / "layout.json").write_text(json.dumps(out, separators=(",", ":")))
    print(f"{slug}: layout for {len(subs)} subsystems, {len(list_only)} list-only; "
          f"{(data / 'layout.json').stat().st_size / 1e6:.1f} MB")


if __name__ == "__main__":
    main()
