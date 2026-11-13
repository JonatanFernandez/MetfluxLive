#!/usr/bin/env python3
"""Print the atom transitions of reactions in readable form.  Usage: inspect_map.py <slug> <rxnId|name-fragment>..."""
import json, sys
from pathlib import Path
ROOT = Path(__file__).resolve().parent.parent
slug = sys.argv[1]
m = json.loads((ROOT / "data" / slug / "model.json").read_text())
am = json.loads((ROOT / "data" / slug / "atommaps.json").read_text())
st = json.loads((ROOT / "data" / slug / "structures.json").read_text())
nm = lambda i: m["bases"][m["mets"][i]["b"]]["n"] + "[" + m["mets"][i]["c"] + "]"
S = lambda i: st.get(m["bases"][m["mets"][i]["b"]]["id"])

def env(s, a):
    """Describe an atom by itself and its neighbours, e.g. C3(H2; C,C)."""
    nb = []
    for k in range(0, len(s["b"]), 4):
        x, y, o = s["b"][k], s["b"][k + 1], s["b"][k + 2]
        if x == a: nb.append(("=" if o == 2 else "") + s["e"][y] + str(y))
        if y == a: nb.append(("=" if o == 2 else "") + s["e"][x] + str(x))
    return f'{s["e"][a]}{a}(H{s["h"][a]};{",".join(sorted(nb))})'

def eq(r):
    f = lambda sign: " + ".join(f"{abs(c):g} {nm(i)}" for i, c in zip(r["m"], r["c"]) if c * sign > 0)
    return f(-1) + " -> " + f(1)

for q in sys.argv[2:]:
    for r in m["rxns"]:
        if r["id"] != q and not (len(q) > 3 and q.lower() in r["n"].lower()):
            continue
        a = am.get(r["id"])
        print(f'\n{r["id"]} {r["n"]} [{m["subsystems"][r["ss"]]}]\n  {eq(r)}')
        if not a:
            print("  (no atom map)"); continue
        print(f'  kind={a["k"]} conf={a.get("c")}')
        for seg in a["s"]:
            sl, pl, pairs = seg[0], seg[1], seg[2]
            if pairs == -1:
                print(f"  {nm(r['m'][sl])} == {nm(r['m'][pl])} (identity x{seg[3] if len(seg) > 3 else 1})"); continue
            ss, ps = S(r["m"][sl]), S(r["m"][pl])
            items = [f"{env(ss, pairs[k])}->{env(ps, pairs[k + 1])}" for k in range(0, len(pairs), 2) if ss["e"][pairs[k]] == "C"]
            if len(items) > 14: items = items[:14] + [f"... +{len(items) - 14} C"]
            print(f"  {nm(r['m'][sl])} -> {nm(r['m'][pl])}: " + "  ".join(items))
