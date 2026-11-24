// Fit measured exchange rates to the network: are they consistent, and if not, which ones must give way?
//
// A set of measured uptake and secretion rates is rarely consistent with a stoichiometric network: the
// carbon or the redox does not balance, a nutrient is missing from the medium, or one rate is simply
// wrong. The application's normal behaviour is to relax every measured flux at once when the problem
// becomes infeasible, which answers "it does not fit" but not "what does not fit".
//
// This solves instead a least-absolute-deviation fit. Every measurement i (the exchanges and, treated the
// same way, the growth rate) gets a pair of non-negative slacks, and the fit minimises the deviations
// weighted by each measurement's own uncertainty:
//
//     min  Σᵢ (sᵢ⁺ + sᵢ⁻)/σᵢ
//     s.t. S·v = 0                      mass balance
//          dirᵢ·vᵢ − sᵢ⁺ + sᵢ⁻ = qᵢ     each measurement, in its own units
//          lb ≤ v ≤ ub                  the model's bounds and the medium
//
// Treating growth as one more measurement matters: with only S·v = 0 the fit would always succeed by
// letting the cell not grow, and "your rates are consistent" would be meaningless. Here a solution that
// drops the growth pays |µ_obs|/σ_µ for it, so the fit has to reconcile the rates WITH the observed growth.
//
// The L1 norm (rather than least squares) is deliberate: it concentrates the blame on few measurements,
// which is what a diagnosis needs — "relax the glutamine uptake by 0.4 and everything else fits" instead
// of a small smear over twenty rates.
//
// Degenerate optima: many flux vectors reach the same total deviation, and each would blame the
// measurements differently. A second stage therefore fixes the optimal deviation and minimises the total
// flux, exactly as the application's pFBA does, so the reported residuals are reproducible.
//
// Reactions are split into a forward and a reverse part (v = f − r, both ≥ 0) as in js/core/fba.js, so the
// total flux of the second stage stays linear.

import { TRACE_SECRETION, FREE_SECRETION } from "./measured.js";

const INF = 1e30;
const INF_CAP = 1000; // the models' own convention for "unbounded"

/**
 * Bounds for the fit. Two traps that any caller would otherwise fall into:
 *
 *  · The medium's uptake ceilings are generic. medium.js turns a concentration into Vmax·C/(Km+C) with
 *    order-of-magnitude kinetics: in the standard medium glucose is capped at 0.471 mmol/gDW/h, which is
 *    BELOW rates that real cells reach (the HEK293 set measures 0.528). Leaving that ceiling in place
 *    makes the fit blame the user's measurement for exceeding an assumption of ours, not for breaking a
 *    mass balance. Every measured exchange is therefore freed: the measurement itself is the constraint.
 *  · Unmeasured organic secretions must stay shut, as sim.js does with TRACE_SECRETION. Otherwise surplus
 *    carbon leaves as whatever is cheapest (sorbitol, succinate…) and the fit reports a perfect agreement
 *    while the carbon balance does not close. Comparing the fit with `trace` and with `trace: Infinity`
 *    is in itself the diagnostic for "an unmeasured product would explain this".
 *
 * @param model, exchanges (findExchanges), lb/ub already through applyMedium
 * @param p { measuredMets: Set|Map of metabolite indices, presentMets: Set of those the medium contains
 *            (uptake is freed only for these), trace = TRACE_SECRETION, openRxns = [] (e.g. the growth
 *            reaction, closed in the published model), freeSecretion = (name) => bool }
 * By default the inorganic metabolites of FREE_SECRETION (CO2, H2O, H+, NH4+, Pi, the ions…) are exempt from
 * the trace cap, exactly as in sim.js: capping CO2 at a trace would make respiration impossible and the
 * diagnosis meaningless.
 */
export function fitBounds(model, exchanges, lb, ub, p = {}) {
  const trace = p.trace ?? TRACE_SECRETION;
  const free = p.freeSecretion ?? ((n) => FREE_SECRETION.has(n));
  const present = p.presentMets ?? null; // null: every measured metabolite may be taken up (the old default)
  const measured = p.measuredMets ?? new Set();
  const lo = Float64Array.from(lb), hi = Float64Array.from(ub);
  for (const [met, e] of exchanges) {
    const r = model.rxns[e.rxn];
    if (r.removed) continue;
    if (measured.has(met)) {
      // The measurement decides, not our kinetics. Secretion is always freed; uptake only if the medium
      // contains the metabolite, so that a conflict cannot be resolved by inventing the uptake of
      // something that was not there (lactate starts at 0 and is measured as a product only).
      const canTakeUp = !present || present.has(met);
      if (e.dir < 0) { hi[e.rxn] = INF_CAP; lo[e.rxn] = canTakeUp ? -INF_CAP : Math.min(0, lo[e.rxn]); }
      else { lo[e.rxn] = -INF_CAP; hi[e.rxn] = canTakeUp ? INF_CAP : Math.max(0, hi[e.rxn]); }
      continue;
    }
    if (!Number.isFinite(trace)) continue; // trace: Infinity -> unmeasured secretion left free (the control run)
    const name = model.bases[model.mets[met].b].n;
    if (free(name)) continue;
    // Secretion of an unmeasured organic metabolite: traces only. uptake = dir·v, so secretion is dir·v < 0:
    // with dir = −1 that is v > 0 (cap the upper bound) and with dir = +1 it is v < 0 (cap the lower one).
    // The same two lines as in sim.js _applyMeasured; swapping them lets the surplus carbon leave as
    // fructose or gluconate and the fit then reports a perfect agreement.
    if (e.dir < 0) hi[e.rxn] = Math.min(hi[e.rxn], trace); else lo[e.rxn] = Math.max(lo[e.rxn], -trace);
  }
  for (const j of p.openRxns || []) if (j >= 0) hi[j] = Math.max(hi[j], INF_CAP);
  return { lb: lo, ub: hi };
}

const ATOMS = (f) => { // "C6H12O6" -> { C: 6, H: 12, O: 6 }; a formula with an R group returns null
  if (!f || /R/.test(f)) return null;
  const o = {};
  for (const m of String(f).matchAll(/([A-Z][a-z]?)(\d*)/g)) if (m[1]) o[m[1]] = (o[m[1]] || 0) + (m[2] ? +m[2] : 1);
  return o;
};

/**
 * Atom budget of a flux solution over its exchanges, and the respiratory quotient.
 *
 * Why this is not optional: the weighted deviation of the fit says how well the measured rates are
 * reproduced, and nothing else. A solution can satisfy every rate exactly and still be absurd — in the
 * HEK293 set, a glucose uptake reported five times too high is matched exactly, with the surplus carbon
 * leaving as CO2 at 34 times the oxygen consumed. No measured rate is violated, so the deviation does not
 * move; the respiratory quotient does. Always read the two together.
 *
 * What makes that possible is a defect of Human-GEM 2.1.1 (verified, see tools/upstream/): MAR03167
 * (urate -> urate radical + H+) and MAR03265 (monodehydroascorbate -> dehydroascorbic acid + H+) are
 * half-reactions with no electron acceptor. They balance in C, H, N and O — a hydrogen ATOM becomes a
 * PROTON and the electron simply disappears — so an elemental check cannot see them, but with
 * MAR06606 and MAR06396 they close a cycle whose net reaction is NAD(P)H -> NAD(P)+ + H+. The model can
 * then oxidise NAD(P)H without any acceptor and run glucose + 6 H2O -> 6 CO2 + 24 H+ with no oxygen.
 * Hence the two checks here that an element balance would miss: the electron budget (where a proton is
 * counted as carrying NO electrons, unlike its formula "H") and the net proton flux.
 *
 * @returns { in: {el: flux}, out: {el: flux}, closure: {el: out/in}, rq, o2, co2, unknown: [names] }
 *          Fluxes are mmol of atoms per gDW per h; `co2` adds CO2 and HCO3- together. Metabolites whose
 *          formula has an R group (the pools of Human-GEM) cannot be counted and are listed in `unknown`.
 */
export function exchangeBalance(model, exchanges, v, tol = 1e-7) {
  const inn = {}, out = {}, unknown = [];
  let o2 = 0, co2 = 0, hplus = 0, eIn = 0, eOut = 0;
  for (const [met, e] of exchanges) {
    const flux = e.dir * v[e.rxn]; // > 0 uptake, < 0 secretion
    if (!(Math.abs(flux) > tol)) continue;
    const base = model.bases[model.mets[met].b], a = ATOMS(base.f);
    if (base.n === "O2") o2 = flux;
    // dissolved inorganic carbon leaves as either, and at pH 7.4 mostly as bicarbonate: for the
    // respiratory quotient the two are the same carbon
    if (base.n === "CO2" || base.n === "HCO3-") co2 -= flux;
    if (base.n === "H+") { hplus = flux; continue; } // a proton is not an atom of hydrogen: see below
    if (!a) { unknown.push(base.n); continue; }
    const side = flux > 0 ? inn : out;
    for (const [el, n] of Object.entries(a)) side[el] = (side[el] || 0) + Math.abs(flux) * n;
    // degree of reduction (electrons available against CO2, H2O, NH3): O2 comes out at −4, as it must
    const g = 4 * (a.C || 0) + (a.H || 0) - 2 * (a.O || 0) - 3 * (a.N || 0) + 6 * (a.S || 0) + 5 * (a.P || 0);
    if (flux > 0) eIn += flux * g; else eOut += -flux * g;
  }
  const closure = {};
  for (const el of new Set([...Object.keys(inn), ...Object.keys(out)])) closure[el] = inn[el] > 0 ? (out[el] || 0) / inn[el] : Infinity;
  const rq = o2 > tol ? co2 / o2 : Infinity;
  const warnings = [];
  if (Number.isFinite(rq) && (rq < 0.4 || rq > 1.6)) warnings.push(`respiratory quotient ${rq.toFixed(2)}: a cell oxidising sugars and amino acids stays near 0.7–1.3`);
  // A large proton efflux is the fingerprint of a charge-unbalanced half-reaction in the model (see the
  // note on Human-GEM above). A real cell exports roughly one proton per organic acid it secretes.
  if (inn.C > 0 && -hplus > 2 * inn.C) warnings.push(`${(-hplus).toFixed(1)} mmol/gDW/h of H+ leave the cell against ${inn.C.toFixed(1)} of carbon taken up: the solution is probably using a charge-unbalanced reaction`);
  return { in: inn, out, closure, rq, o2, co2, hplus,
    electrons: { in: eIn, out: eOut, gap: eIn - eOut }, unknown: [...new Set(unknown)], warnings };
}

export class ExchangeFit {
  /**
   * @param highs loaded highs-js runtime
   * @param net   packNetwork(model) — { nMets, nRxns, rxnMets, rxnCoefs }
   */
  constructor(highs, net) {
    this.highs = highs;
    this.net = net;
  }

  /**
   * @param p { lb, ub: Float64Array(nRxns) — the model's bounds with the medium already applied,
   *            measurements: [{ rxn, dir, rate, sigma, met? }] — rate in mmol/gDW/h, + uptake / − secretion,
   *                           uptake = dir·v (dir ±1); for growth use dir = 1 and rate = µ,
   *            minSigma? } default floor for sigma (a measurement with σ = 0 would be infinitely stiff)
   * @returns { status, deviation, v, residuals: [{ rxn, met, observed, fitted, residual, weighted, share }] }
   *          residual = fitted − observed in the measurement's own sign convention; share = fraction of the
   *          total weighted deviation this measurement accounts for. Sorted worst first.
   */
  fit(p) {
    const { nMets, nRxns, rxnMets, rxnCoefs } = this.net;
    const H = this.highs;
    const meas = p.measurements.filter((m) => m.rxn >= 0 && Number.isFinite(m.rate));
    const nM = meas.length;
    if (!nM) return { status: "no measurements", deviation: 0, v: new Float64Array(nRxns), residuals: [] };
    const minSigma = p.minSigma ?? 1e-6;
    const sig = meas.map((m) => Math.max(minSigma, Math.abs(m.sigma) || minSigma));

    // columns: f (nRxns) | r (nRxns) | s+ (nM) | s− (nM);  rows: mass balance (nMets) | one per measurement
    const n2 = 2 * nRxns, numCols = n2 + 2 * nM, numRows = nMets + nM;
    const cols = [];
    for (let half = 0; half < 2; half++) {
      const sign = half ? -1 : 1;
      for (let j = 0; j < nRxns; j++) {
        const idx = [], val = [], ms = rxnMets[j], cs = rxnCoefs[j];
        for (let q = 0; q < ms.length; q++) { idx.push(ms[q]); val.push(sign * cs[q]); }
        cols.push({ idx, val });
      }
    }
    meas.forEach((m, i) => { // each measurement row touches that reaction's two columns
      const row = nMets + i;
      cols[m.rxn].idx.push(row); cols[m.rxn].val.push(m.dir);
      cols[nRxns + m.rxn].idx.push(row); cols[nRxns + m.rxn].val.push(-m.dir);
    });
    for (let i = 0; i < nM; i++) cols.push({ idx: [nMets + i], val: [-1] }); // s+
    for (let i = 0; i < nM; i++) cols.push({ idx: [nMets + i], val: [1] });  // s−

    let nnz = 0; for (const c of cols) nnz += c.idx.length;
    const starts = new Int32Array(numCols + 1), indices = new Int32Array(nnz), values = new Float64Array(nnz);
    let k = 0;
    for (let c = 0; c < numCols; c++) {
      starts[c] = k;
      const { idx, val } = cols[c];
      for (let q = 0; q < idx.length; q++) { indices[k] = idx[q]; values[k] = val[q]; k++; }
    }
    starts[numCols] = k;

    const colLower = new Float64Array(numCols), colUpper = new Float64Array(numCols);
    for (let j = 0; j < nRxns; j++) {
      const lo = p.lb[j], hi = p.ub[j];
      colLower[j] = Math.max(lo, 0); colUpper[j] = Math.max(hi, 0);
      colLower[nRxns + j] = Math.max(-hi, 0); colUpper[nRxns + j] = Math.max(-lo, 0);
    }
    for (let i = n2; i < numCols; i++) colUpper[i] = INF;

    const rowLower = new Float64Array(numRows), rowUpper = new Float64Array(numRows);
    meas.forEach((m, i) => { rowLower[nMets + i] = m.rate; rowUpper[nMets + i] = m.rate; });

    const cost = new Float64Array(numCols);
    for (let i = 0; i < nM; i++) { cost[n2 + i] = 1 / sig[i]; cost[n2 + nM + i] = 1 / sig[i]; }

    const M = H.createModel({
      numCols, numRows, sense: H.constants.objectiveSense.minimize,
      colCost: cost, colLower, colUpper, rowLower, rowUpper,
      matrix: { format: "csc", numRows, numCols, starts, indices, values },
    });
    try {
      M.options.set({ output_flag: false, presolve: "on" });
      M.run();
      if (M.getModelStatus() !== H.constants.modelStatus.optimal)
        return { status: this._status(M.getModelStatus()), deviation: NaN, v: new Float64Array(nRxns), residuals: [] };
      const deviation = M.getObjectiveValue();
      const x1 = M.getSolution().colValue.slice(); // kept: the fallback if stage 2 does not solve

      // stage 2: hold that deviation and minimise the total flux, so one representative v is reported.
      // The tolerance cannot be a relative epsilon: with σ as small as minSigma the row's coefficients
      // reach 1/minSigma, so the solver's own primal noise is amplified by the same factor and a tight
      // bound would make stage 2 infeasible.
      const tol = Math.max(1e-5, Math.abs(deviation) * 1e-5);
      M.addRow(-INF, deviation + tol, {
        indices: Int32Array.from({ length: 2 * nM }, (_, i) => n2 + i),
        values: Float64Array.from({ length: 2 * nM }, (_, i) => cost[n2 + i]),
      });
      const cost2 = new Float64Array(numCols);
      for (let i = 0; i < n2; i++) cost2[i] = 1;
      M.changeColsCost({ kind: "range", from: 0, to: numCols - 1 }, cost2);
      M.clearSolver(); M.run();
      const ok = M.getModelStatus() === H.constants.modelStatus.optimal;
      const x = ok ? M.getSolution().colValue : x1; // stage 2 only picks among equally good optima
      const v = new Float64Array(nRxns);
      for (let j = 0; j < nRxns; j++) { const d = x[j] - x[nRxns + j]; v[j] = Math.abs(d) < 1e-9 ? 0 : d; }
      const residuals = meas.map((m, i) => {
        const fitted = m.dir * v[m.rxn], res = fitted - m.rate;
        return { rxn: m.rxn, met: m.met, observed: m.rate, fitted, residual: Math.abs(res) < 1e-9 ? 0 : res,
          weighted: Math.abs(res) / sig[i], sigma: sig[i] };
      });
      const tot = residuals.reduce((s, r) => s + r.weighted, 0);
      for (const r of residuals) r.share = tot > 0 ? r.weighted / tot : 0;
      residuals.sort((a, b) => b.weighted - a.weighted);
      return { status: ok ? "optimal" : "stage2 " + this._status(M.getModelStatus()), deviation, v, residuals };
    } finally { M.dispose(); }
  }

  _status(code) {
    const C = this.highs.constants.modelStatus;
    for (const k of Object.keys(C)) if (C[k] === code) return k;
    return "status " + code;
  }
}
