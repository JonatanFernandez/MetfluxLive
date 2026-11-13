// Sanity checks of atom mappings on central carbon metabolism using known label fates.
import fs from "node:fs";
import loadHighs from "../vendor/highs/highs.mjs";
import { FbaProblem, packNetwork } from "../js/core/fba.js";
import { defaultMedium, findExchanges, applyMedium } from "../js/core/medium.js";
import { Tracer } from "../js/core/tracer.js";
const slug = process.argv[2] || "human-gem";
const rd = (f) => JSON.parse(fs.readFileSync(new URL(`../data/${slug}/${f}`, import.meta.url)));
const model = rd("model.json"), structures = rd("structures.json"), maps = rd("atommaps.json");
const highs = await loadHighs({ print: () => {}, printErr: () => {} });
const P = new FbaProblem(highs, packNetwork(model));
const ex = findExchanges(model), med = defaultMedium(model);
const { lb, ub } = applyMedium(model, ex, med, model.rxns.map(r => r.lb), model.rxns.map(r => r.ub));
const obj = model.rxns.findIndex(r => r.obj);
const sol = P.solve({ lb, ub, objective: obj, maximize: true });
console.log("growth", sol.objective.toFixed(4));
const T = new Tracer(model, structures, maps);
const metByName = (name, c) => model.mets.findIndex(m => m.c === c && model.bases[m.b].n === name);
const show = (name, c, s) => { const m = metByName(name, c); if (m < 0) return console.log(name, "not found");
  const st = structures[model.bases[model.mets[m].b].id]; const e = T.atomsEnrichment(s, m);
  console.log(`  ${name}[${c}]`.padEnd(28), st ? st.e.map((el, i) => el === "C" ? `C${i}:${e[i].toFixed(2)}` : null).filter(Boolean).join(" ") : `pseudo:${e[0].toFixed(3)}`); };
function run(title, tracerName, pick) {
  const tm = metByName(tracerName, "e"), st = structures[model.bases[model.mets[tm].b].id];
  const label = new Float64Array(st.e.length); pick(st, label);
  const inputs = [];
  for (const [mi, e] of ex) { const up = sol.v[e.rxn] * e.dir; if (up > 1e-9) inputs.push({ met: mi, flux: up, label: mi === tm ? label : null }); }
  const t0 = Date.now(); const prog = T.compile(sol.v, inputs); const s = T.advance(prog, null, Infinity);
  const sum = T.summarize(prog, s, new Set(["C"]));
  let nl = 0, nu = 0; for (const m of s.order) { if (sum.metE[m] > 1e-4) nl++; if (sum.uncertain[m]) nu++; }
  console.log(`\n${title}: ${Date.now() - t0} ms, largest SCC ${s.largest} conv ${s.converged}, reachable ${s.order.length}, labelled ${nl}, uncertain ${nu}`);
  console.log("  tracer atoms:", st.e.map((el, i) => `${el}${i}${label[i] ? "*" : ""}`).join(" "));
  for (const [n, c] of [["glucose-6-phosphate", "c"], ["fructose-1,6-bisphosphate", "c"], ["DHAP", "c"], ["GAP", "c"], ["pyruvate", "c"], ["pyruvate", "m"], ["L-lactate", "c"], ["acetyl-CoA", "m"], ["citrate", "m"], ["AKG", "m"], ["succinate", "m"], ["malate", "m"], ["OAA", "m"], ["CO2", "m"], ["ribose-5-phosphate", "c"], ["glutamate", "c"], ["alanine", "c"], ["serine", "c"], ["biomass", "c"]]) show(n, c, s);
  return s;
}
const s0 = structures[model.bases[model.mets[metByName("glucose", "e")].b].id];
console.log("glucose bonds", s0.e.join(""), JSON.stringify(s0.b.filter((_, i) => i % 4 < 2)));
run("[U-13C]glucose", "glucose", (st, l) => st.e.forEach((el, i) => { if (el === "C") l[i] = 1; }));
run("[1-13C]glucose (first C in canonical order)", "glucose", (st, l) => { l[st.e.indexOf("C")] = 1; });
run("[U-13C]glutamine", "glutamine", (st, l) => st.e.forEach((el, i) => { if (el === "C") l[i] = 1; }));
if (process.env.DUMP) fs.writeFileSync(process.env.DUMP, JSON.stringify(Array.from(sol.v)));
// dynamic consistency: repeated implicit steps must approach the isotopic steady state
{
  const tm = metByName("glucose", "e"), st = structures[model.bases[model.mets[tm].b].id];
  const label = Float64Array.from(st.e, (el) => (el === "C" ? 1 : 0));
  const inputs = [];
  for (const [mi, e] of ex) { const up = sol.v[e.rxn] * e.dir; if (up > 1e-9) inputs.push({ met: mi, flux: up, label: mi === tm ? label : null }); }
  const prog = T.compile(sol.v, inputs), steady = T.advance(prog, null, Infinity);
  const cit = metByName("citrate", "m"), pyr = metByName("pyruvate", "c");
  let e = null, t = 0; const out = [];
  for (const dt of [0.01, 0.02, 0.05, 0.1, 0.3, 1, 3, 10, 30, 100, 1000]) { const s = T.advance(prog, e, dt, (m) => (model.mets[m].c === "e" ? 0 : 0.002)); e = s.e; t += dt;
    out.push(`t=${t.toFixed(2)}h pyr=${T.atomsEnrichment(s, pyr)[0].toFixed(3)} cit=${T.atomsEnrichment(s, cit)[6].toFixed(3)}`); }
  console.log("\ndynamic:", out.join(" | "), "| steady pyr", T.atomsEnrichment(steady, pyr)[0].toFixed(3), "cit", T.atomsEnrichment(steady, cit)[6].toFixed(3));
}
