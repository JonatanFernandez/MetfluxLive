import fs from "node:fs";
import loadHighs from "../vendor/highs/highs.mjs";
import { FbaProblem, packNetwork } from "../js/core/fba.js";
import { defaultMedium, findExchanges, applyMedium, DEFAULT_MEDIUM } from "../js/core/medium.js";
const slug = process.argv[2] || "human-gem";
const model = JSON.parse(fs.readFileSync(new URL(`../data/${slug}/model.json`, import.meta.url)));
const highs = await loadHighs();
const net = packNetwork(model);
const P = new FbaProblem(highs, net);
const ex = findExchanges(model), med = defaultMedium(model);
console.log("exchanges", ex.size, "medium", med.length, "of", DEFAULT_MEDIUM.length,
  "missing:", DEFAULT_MEDIUM.filter(d => !med.some(i => model.bases[model.mets[i.met].b].n.toLowerCase() === d[0].toLowerCase())).map(d => d[0]).join(","));
const { lb, ub } = applyMedium(model, ex, med, model.rxns.map(r => r.lb), model.rxns.map(r => r.ub));
const obj = model.rxns.findIndex(r => r.obj);
for (const pars of [false, true, true]) {
  const t = Date.now();
  const r = P.solve({ lb, ub, objective: obj, maximize: true, parsimonious: pars });
  let nz = 0, sum = 0; for (const x of r.v) { if (x) nz++; sum += Math.abs(x); }
  console.log(pars, r.status, r.objective.toFixed(5), "active", nz, "sum", sum.toFixed(1), Date.now() - t, "ms");
  if (pars) for (const [mi, e] of ex) { const f = r.v[e.rxn] * e.dir; if (Math.abs(f) > 0.02) console.log("   ", model.bases[model.mets[mi].b].n, f.toFixed(3)); }
}
