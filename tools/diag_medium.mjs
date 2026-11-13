// Which closed uptakes limit growth? Opens each exchange in turn on top of the default medium.
import fs from "node:fs";
import loadHighs from "../vendor/highs/highs.mjs";
import { FbaProblem, packNetwork } from "../js/core/fba.js";
import { defaultMedium, findExchanges, applyMedium, DEFAULT_MEDIUM } from "../js/core/medium.js";
const slug = process.argv[2] || "mouse-gem";
const model = JSON.parse(fs.readFileSync(new URL(`../data/${slug}/model.json`, import.meta.url)));
const highs = await loadHighs({ print: () => {}, printErr: () => {} });
const P = new FbaProblem(highs, packNetwork(model));
const ex = findExchanges(model), med = defaultMedium(model);
const nm = (m) => model.bases[model.mets[m].b].n;
console.log("missing from model:", DEFAULT_MEDIUM.filter(d => !med.some(i => nm(i.met).toLowerCase() === d[0].toLowerCase())).map(d => d[0]).join(", "));
const base = applyMedium(model, ex, med, model.rxns.map(r => r.lb), model.rxns.map(r => r.ub));
const obj = model.rxns.findIndex(r => r.obj);
const solve = (lb, ub) => P.solve({ lb, ub, objective: obj, maximize: true, parsimonious: false }).objective;
const g0 = solve(base.lb, base.ub);
console.log("default growth", g0.toFixed(5));
// all open
const lbAll = Float64Array.from(base.lb), ubAll = Float64Array.from(base.ub);
for (const [, e] of ex) { if (e.dir < 0) lbAll[e.rxn] = Math.min(lbAll[e.rxn], -1); else ubAll[e.rxn] = Math.max(ubAll[e.rxn], 1); }
console.log("all uptakes open (1.0):", solve(lbAll, ubAll).toFixed(4));
// limiting medium components: relax each cap x10
for (const it of med) { if (it.unlimited) continue; const e = ex.get(it.met); const lb = Float64Array.from(base.lb), ub = Float64Array.from(base.ub);
  if (e.dir < 0) lb[e.rxn] *= 10; else ub[e.rxn] *= 10; const g = solve(lb, ub); if (g > g0 * 1.05 + 1e-6) console.log("  limiting:", nm(it.met), g.toFixed(5)); }
if (process.argv[3] === "scan") for (const [m, e] of ex) { if (med.some(i => i.met === m)) continue; const lb = Float64Array.from(base.lb), ub = Float64Array.from(base.ub);
  if (e.dir < 0) lb[e.rxn] = -0.05; else ub[e.rxn] = 0.05; const g = solve(lb, ub); if (g > g0 * 1.3 + 1e-5) console.log("  opening helps:", nm(m), g.toFixed(5)); }
{
  const lb = Float64Array.from(base.lb), ub = Float64Array.from(base.ub);
  for (const it of med) { const e = ex.get(it.met); if (e.dir < 0) lb[e.rxn] = -1000; else ub[e.rxn] = 1000; }
  const gAll = solve(lb, ub); console.log("all medium components unlimited:", gAll.toFixed(4));
  // which single component, when restored to its default cap, pulls growth down the most
  const rows = [];
  for (const it of med) { if (it.unlimited) continue; const e = ex.get(it.met); const l2 = Float64Array.from(lb), u2 = Float64Array.from(ub);
    if (e.dir < 0) l2[e.rxn] = base.lb[e.rxn]; else u2[e.rxn] = base.ub[e.rxn]; rows.push([solve(l2, u2), nm(it.met), e.dir < 0 ? -base.lb[e.rxn] : base.ub[e.rxn]]); }
  rows.sort((a, b) => a[0] - b[0]); console.log(rows.slice(0, 12).map(r => `${r[1]} cap=${r[2].toPrecision(2)} -> growth ${r[0].toFixed(5)}`).join("\n"));
}
