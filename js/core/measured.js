// Measured exchange fluxes: constraints that pin uptake and secretion to experimental values.
//
// NCI-60: median over the 59 cell lines of the consumption and release rates measured by Jain et al.,
// Science 336:1040 (2012), as published per line in Table Q of S1 of Aurich, Fleming & Thiele,
// PLoS Comput Biol 13:e1005698 (2017) (lb = 0.8·x, ub = 1.2·x; x recovered as their mean).
// Cells were grown in RPMI-1640 with 5 % FBS. Rates are fmol/cell/h; they are converted to
// mmol/gDW/h with a dry mass of 0.3 ng per cell, the approximate NCI-60 average used by
// Zielinski et al., Sci Rep 7:41241 (2017).
// Only exchanges with a clear sign across the panel are kept (aspartate, proline, glycine, ornithine and
// glycerol change sign between lines and are left out).

export const CELL_MASS_PG = 300;
export const DEFAULT_TOL = 0.2;
// With a measured set, organic metabolites that were not measured may only be secreted in traces: the
// measured exometabolome accounts for practically all carbon exchange (>99 % in the NCI-60 data, Zielinski
// et al. 2017), and otherwise FBA dumps surplus carbon as whatever is cheapest (sorbitol, succinate…).
export const TRACE_SECRETION = 0.001; // mmol/gDW/h
// Non-growth-associated ATP maintenance, 1.07 mmol/gDW/h: measured by Kilburn, Lilly & Webb, J Cell Sci 4:645
// (1969) in mouse LS cells and used for the NCI-60 by Zielinski et al. 2017. Applied as the lower bound of the
// cytosolic ATP hydrolysis reaction (Human-GEM leaves it at 0).
export const NGAM = 1.07;
// Free to leave in any amount: inorganic and end products of complete oxidation and nitrogen disposal.
export const FREE_SECRETION = new Set(["CO2", "HCO3-", "H2O", "H+", "NH3", "NH4+", "urea", "Pi", "PPi", "sulfate", "H2S", "O2", "chloride", "Na+", "K+", "Ca2+", "Mg2+", "Fe2+", "Fe3+", "zinc", "Cu2+", "formate", "biomass"]);

// [name in Human-GEM / Mouse-GEM, median fmol/cell/h (+ uptake, - secretion), first quartile, third quartile]
const NCI60 = [
  ["glucose", 278.4, 170.5, 398.8], ["L-lactate", -353.4, -240.6, -567.6], ["glutamine", 71.0, 37.5, 98.8],
  ["serine", 8.90, 6.48, 14.15], ["alanine", -12.84, -4.39, -23.48], ["glutamate", -8.12, -3.38, -15.09],
  ["leucine", 5.66, 3.91, 8.59], ["lysine", 5.41, 4.27, 8.50], ["isoleucine", 4.74, 3.05, 6.57],
  ["valine", 4.04, 3.09, 6.21], ["threonine", 3.78, 2.69, 6.04], ["arginine", 3.68, 2.09, 5.83],
  ["tyrosine", 2.57, 2.04, 4.20], ["phenylalanine", 1.90, 1.54, 3.18], ["methionine", 1.70, 1.30, 2.53],
  ["asparagine", 1.67, 0.88, 2.13], ["tryptophan", 0.45, 0.36, 0.89], ["choline", 0.66, 0.40, 1.02],
];

/** Built-in sets. Names and notes are in js/i18n.js under measured.name.<id> / measured.note.<id>. */
export const MEASURED_SETS = [
  { id: "nci60", rows: NCI60, ngam: NGAM },
  { id: "none", rows: [] },
];

const toGDW = (fmolPerCell) => fmolPerCell / CELL_MASS_PG; // fmol/cell/h / (pg/cell) = mmol/gDW/h

/**
 * Rows of a built-in set for a model.
 * @returns [{ met, rate }] with rate in mmol/gDW/h, positive = uptake, negative = secretion
 */
export function measuredPreset(model, exchanges, id) {
  const set = MEASURED_SETS.find((s) => s.id === id);
  if (!set) return [];
  const byName = new Map();
  for (const [mi] of exchanges) byName.set(model.bases[model.mets[mi].b].n.toLowerCase(), mi);
  const out = [];
  for (const [name, x] of set.rows) {
    const met = byName.get(name.toLowerCase());
    if (met !== undefined) out.push({ met, rate: +toGDW(x).toPrecision(3) });
  }
  return out;
}

export const measuredNgam = (id) => MEASURED_SETS.find((s) => s.id === id)?.ngam || 0;

/** The cytosolic ATP hydrolysis reaction (ATP + H2O -> ADP + Pi + H+), used for ATP maintenance. */
export function atpMaintenanceRxn(model) {
  const want = "ADP,ATP,H+,H2O,Pi", cyt = Object.keys(model.compartments).find((c) => /cytosol/i.test(model.compartments[c]));
  return model.rxns.findIndex((r) => r.m.every((m) => model.mets[m].c === cyt) && r.m.map((m) => model.bases[model.mets[m].b].n).sort().join(",") === want && r.c[r.m.findIndex((m) => model.bases[model.mets[m].b].n === "ATP")] < 0);
}

/** The data behind a set, for the documentation and the exports. */
export function measuredTable(id) {
  const set = MEASURED_SETS.find((s) => s.id === id);
  return set ? set.rows.map(([name, x, q1, q3]) => ({ name, fmol: x, q1, q3, mmol: toGDW(x) })) : [];
}
