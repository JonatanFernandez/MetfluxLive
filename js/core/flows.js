// What the lines between groups carry: atoms (carbon, nitrogen), redox cofactors, ATP; and the free
// energy dissipated by every group.
//
// Atoms are counted only where they really move. A carrier-bound intermediate (acetyl-CoA, UDP-glucose,
// a thiamine-diphosphate adduct...) also contains the atoms of its carrier, which are recycled and never
// pass from one pathway to another. They are found by tracing: the atoms of every carrier are given
// "label" 1, the nutrients 0, and the tracer propagates that label through the atom maps of the current
// flux solution. The carrier share of an atom is its label; the transferable atoms of a metabolite are its
// atoms of the element times (1 - carrier share). Closed cycles that take in no atoms from outside (a loop
// of two reactions in different pathways, say) count as carriers too: their atoms only go round.

import { parseFormula } from "./chem.js";

export const QUANTITIES = ["carbon", "nitrogen", "redox", "nadh", "nadph", "qh2", "atp", "dg"];
export const ATOM_Q = { carbon: "C", nitrogen: "N" };
// cofactor flows: the base names of the pool(s) followed
export const COFACTOR_Q = { nadh: ["NADH"], nadph: ["NADPH"], qh2: ["ubiquinol"], atp: ["ATP", "GTP", "UTP", "CTP"] };
// All redox carriers together, in electron pairs (2 e-, one hydride) per molecule of the reduced form. Each pool is
// still paired producer -> consumer on its own (groupFlows works pool by pool), so NADH made in one pathway is never
// matched with NADPH used in another; the lines add up the reducing equivalents of every carrier. One-electron
// carriers count half. Glutathione is left out: GSH is also made and used as a molecule (synthesis, conjugation,
// biomass), which would be counted as redox traffic.
export const REDOX_PAIRS = {
  NADH: 1, NADPH: 1, ubiquinol: 1, FADH2: 1, "reduced vitamin K": 1,
  "ferrocytochrome C": 0.5, "ferrocytochrome B5": 0.5, "reduced ferredoxin": 0.5, "reduced adrenal ferredoxin": 0.5,
};

// inorganic currency: their atoms are real transfers (CO2 fixed by a carboxylase, NH4+ by glutamine synthetase)
const INORGANIC = new Set(["H+", "H2O", "O2", "H2O2", "CO2", "HCO3-", "NH4+", "Pi", "PPi", "Na+", "K+", "Ca2+", "chloride", "Fe2+", "Fe3+"]);
// carriers that are not in the currency list
const CARRIER_RX = /^(thiamin-PP|lipoamide|dihydrolipoamide|\[ACP\]|apo-\[ACP\]|\[protein\]-N6-\((dihydro)?lipoyl\)lysine|L-carnitine|THF|GSH|tRNA\(.*\))$/;

/** Bases whose atoms are carrier atoms: organic currency metabolites (nucleotides, CoA, NAD...) and the carriers above. */
export function carrierBases(model, currency) {
  return Uint8Array.from(model.bases, (b, i) => {
    if (CARRIER_RX.test(b.n)) return 1;
    if (!currency[i] || INORGANIC.has(b.n)) return 0;
    const f = parseFormula(b.f);
    return f && f.C ? 1 : 0;
  });
}

/** Bases left out as pools of an atom quantity (their atoms are not drawn as lines). */
export function excludedPools(model, currency, carriers, element) {
  return Uint8Array.from(model.bases, (b, i) => {
    if (carriers[i]) return 1;
    if (!currency[i]) return 0;
    // the inorganic carrier of the element itself stays: NH4+ for nitrogen, CO2 and HCO3- for carbon
    if (element === "N" && b.n === "NH4+") return 0;
    if (element === "C" && (b.n === "CO2" || b.n === "HCO3-")) return 0;
    return 1;
  });
}

/**
 * Carrier share of every atom for a flux distribution (1 = belongs to a recycled carrier).
 * @returns Float64Array over the tracer's atoms
 */
export function carrierShare(tracer, v, inputs, carriers) {
  const mets = tracer.model.mets;
  const fixed = Uint8Array.from(mets, (m) => carriers[m.b]);
  const prog = tracer.compile(v, inputs.map((i) => ({ met: i.met, flux: i.flux, label: null })), 1e-9, fixed);
  // Starting every atom at 1 only matters where the steady state does not overwrite it: the carriers
  // (fixed) and closed cycles that receive no atoms from outside, whose atoms are recycled as well.
  const e0 = new Float64Array(tracer.nAtoms).fill(1);
  return tracer.advance(prog, e0, Infinity).e;
}

/** Transferable atoms of `element` per metabolite (carrier atoms removed). */
export function transferableAtoms(tracer, share, element) {
  const { model, off } = tracer, mets = model.mets;
  const code = { C: 1, N: 2 }[element];
  const out = new Float32Array(mets.length);
  for (let m = 0; m < mets.length; m++) {
    const b = mets[m].b, el = tracer.baseEl[b];
    let s = 0;
    if (tracer.basePseudo[b]) { // no structure: the formula count, with the share of the single pseudo-atom
      const f = parseFormula(model.bases[b].f);
      s = (f?.[element] || 0) * (1 - (share ? share[off[m]] : 0));
    } else for (let a = 0; a < el.length; a++) if (el[a] === code) s += 1 - (share ? share[off[m] + a] : 0);
    out[m] = s > 1e-6 ? s : 0;
  }
  return out;
}

/** Per-metabolite weights of a cofactor quantity: 1 for each followed pool (electron pairs for "redox"), 0 elsewhere. */
export function cofactorWeights(model, kind) {
  if (kind === "redox") return Float32Array.from(model.mets, (m) => REDOX_PAIRS[model.bases[m.b].n] || 0);
  const names = new Set(COFACTOR_Q[kind]);
  return Float32Array.from(model.mets, (m) => (names.has(model.bases[m.b].n) ? 1 : 0));
}

/**
 * Free energy per group for a flux vector.
 * dG: Float32Array of dG'm per reaction (kJ/mol, forward direction; NaN = unknown).
 * Returns per group: diss (J/gDW/h dissipated by reactions running downhill), up (J/gDW/h of reactions
 * running uphill at 1 mM), cover (share of the group's flux with a known dG), g in [-1, 1] (downhill
 * vs uphill balance, for colour).
 */
export function groupEnergy(model, v, dG, G) {
  const n = G.n, diss = new Float32Array(n), up = new Float32Array(n), known = new Float32Array(n), tot = new Float32Array(n);
  model.rxns.forEach((r, j) => {
    const g = G.groupOf[j];
    if (g < 0 || !v[j]) return;
    const f = Math.abs(v[j]);
    tot[g] += f;
    const d = dG[j];
    if (!Number.isFinite(d)) return;
    known[g] += f;
    const w = v[j] * d; // mmol/gDW/h x kJ/mol = J/gDW/h; negative = dissipated
    if (w < 0) diss[g] -= w; else up[g] += w;
  });
  const cover = Float32Array.from(tot, (x, g) => (x ? known[g] / x : 0));
  const gcol = Float32Array.from(diss, (x, g) => (x + up[g] > 0 ? (x - up[g]) / (x + up[g]) : tot[g] && !known[g] ? NaN : 0)); // NaN: active, no estimate
  return { diss, up, cover, g: gcol };
}

/** dG of a reaction in the direction it runs: negative = downhill. NaN when unknown or inactive. */
export function dgRunning(dG, v, j) {
  const d = dG[j];
  return Number.isFinite(d) && v[j] ? Math.sign(v[j]) * d : NaN;
}
