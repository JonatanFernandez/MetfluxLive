// Isotopologue sampler against known patterns and against the positional tracer
// (the mean number of labelled atoms per molecule must agree between the two).
import fs from "node:fs";
import loadHighs from "../vendor/highs/highs.mjs";
import { FbaProblem, packNetwork } from "../js/core/fba.js";
import { presetMedium, findExchanges, applyMedium } from "../js/core/medium.js";
import { Tracer } from "../js/core/tracer.js";
import { IsotopologueSampler } from "../js/core/isotopologues.js";
import { ModelIndex } from "../js/modelindex.js";
const slug = process.argv[2] || "human-gem";
const rd = (f) => JSON.parse(fs.readFileSync(new URL(`../data/${slug}/${f}`, import.meta.url)));
const model = rd("model.json"), structures = rd("structures.json"), maps = rd("atommaps.json"), layout = rd("layout.json");
const highs = await loadHighs({ print: () => {}, printErr: () => {} });
const P = new FbaProblem(highs, packNetwork(model));
const ex = findExchanges(model), med = presetMedium(model, process.argv[3] || "default");
const { lb, ub } = applyMedium(model, ex, med, model.rxns.map((r) => r.lb), model.rxns.map((r) => r.ub));
const sol = P.solve({ lb, ub, objective: model.rxns.findIndex((r) => r.obj), maximize: true, parsimonious: true });
const T = new Tracer(model, structures, maps), index = new ModelIndex(model, layout);
const metByName = (name, c) => model.mets.findIndex((m) => m.c === c && model.bases[m.b].n === name);
function run(title, tracerName, element, pick, fraction = 1) {
  const tm = metByName(tracerName, "e"), st = structures[model.bases[model.mets[tm].b].id];
  const label = Float64Array.from(st.e, (el, i) => (pick(el, i, st) ? fraction : 0));
  const inputs = [];
  for (const [mi, e] of ex) { const up = sol.v[e.rxn] * e.dir; if (up > 1e-9) inputs.push({ met: mi, flux: up, label: mi === tm ? label : null }); }
  const prog = T.compile(sol.v, inputs), s = T.advance(prog, null, Infinity);
  const S = new IsotopologueSampler(T, index, sol.v, inputs, s.e, new Set([element]));
  console.log(`\n${title}`);
  let worst = 0, t0 = Date.now(), k = 0;
  for (const [n, c] of [["glucose-6-phosphate", "c"], ["glyceraldehyde 3-phosphate", "c"], ["pyruvate", "c"], ["L-lactate", "c"], ["alanine", "c"], ["acetyl-CoA", "m"], ["citrate", "m"], ["AKG", "m"], ["succinate", "m"], ["malate", "m"], ["OAA", "m"], ["glutamate", "c"], ["aspartate", "c"], ["serine", "c"], ["glycine", "c"], ["ribose-5-phosphate", "c"], ["palmitate", "c"], ["ATP", "c"]]) {
    const m = metByName(n, c);
    if (m < 0) { console.log("  ", n, "not found"); continue; }
    const r = S.mid(m, 4000, 1500); k++;
    if (!r) { console.log(`   ${(n + "[" + c + "]").padEnd(24)} —`); continue; }
    const dev = Math.abs(r.mean - r.positional);
    if (r.steps < 1000) worst = Math.max(worst, dev / Math.max(0.05, r.atoms * 0.02));
    console.log(`   ${(n + "[" + c + "]").padEnd(24)} ${r.dist.map((p, i) => (p > 0.004 ? `M+${i}:${(100 * p).toFixed(1)}` : null)).filter(Boolean).join(" ")}  | mean ${r.mean.toFixed(3)} vs positional ${r.positional.toFixed(3)}${r.approx > 0.001 ? ` approx ${(100 * r.approx).toFixed(0)}%` : ""} steps ${r.steps.toFixed(0)} n ${r.n}`);
  }
  console.log(`   ${k} metabolites in ${Date.now() - t0} ms; worst deviation ${worst.toFixed(2)} (should be < 1)`);
  return worst;
}
let bad = 0;
bad = Math.max(bad, run("[U-13C]glucose", "glucose", "C", (el) => el === "C"));
bad = Math.max(bad, run("50 % [U-13C]glucose", "glucose", "C", (el) => el === "C", 0.5));
bad = Math.max(bad, run("[1-13C]glucose", "glucose", "C", (el, i, st) => i === st.e.indexOf("C")));
bad = Math.max(bad, run("[U-13C]glutamine", "glutamine", "C", (el) => el === "C"));
bad = Math.max(bad, run("[U-15N]glutamine", "glutamine", "N", (el) => el === "N"));
console.log(bad < 1 ? "\nOK" : "\nFAILED: sampler and positional tracer disagree");
process.exit(bad < 1 ? 0 : 1);
