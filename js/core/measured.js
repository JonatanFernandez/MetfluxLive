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

// Human liver tissue ex vivo: Grankvist et al., Nat Metab 6:1963 (2024), Supplementary Data 3 and Source Data
// Fig. 1i, 4a and Extended Data Fig. 4i. Precision-cut slices from 5 donors (fasted, serum-free Williams E, 24 h).
// Rates are µmol per g liver (wet weight) per day; median over the donors (urea: all 15 replicate slices), with
// the range. Converted with a wet/dry weight ratio of 3.3 (Wimmer, Wilmering & Sasse, Histochemistry 83:571, 1985,
// measured in rat liver): mmol/gDW/h = x · 3.3 / 24 / 1000. Only exchanges with the same direction in at least
// 4 of the 5 donors are kept (alanine, glycine, serine, valine and histidine change sign and are left out).
const LIVER = [
  ["glucose", -30.36, 5.622, -75.34], ["L-lactate", -115.8, -61.85, -159.7], ["urea", -87.46, -40.87, -202.3],
  ["glutamine", 42.48, 13.87, 47.04], ["glutamate", -22.65, -18.01, -31.59], ["arginine", 12.49, 8.083, 22.95],
  ["threonine", 5.811, 0.8633, 15.98], ["aspartate", 5.128, 1.936, 9.011], ["leucine", 4.374, 1.929, 24.29],
  ["lysine", 4.194, -7.669, 15.01], ["asparagine", 2.689, 1.026, 4.904], ["tyrosine", 2.705, -0.7798, 7.025],
  ["phenylalanine", 2.57, 2.026, 5.44], ["methionine", 2.174, 1.336, 3.338], ["proline", 1.695, -2.399, 4.559],
  ["isoleucine", 1.446, -0.3108, 10.9], ["tryptophan", 0.7751, 0.5314, 1.539],
];
const LIVER_WET_DRY = 3.3;

// Primary human dermal fibroblasts (newborn foreskin): Lemons et al., PLoS Biol 8:e1000514 (2010), Fig. S1A,
// measured in DMEM (25 mM glucose, 4 mM glutamine, 7.5 % dialysed FBS). Rates are nmol per µg protein per hour,
// read from the bar chart (reading uncertainty about ±0.05; the published error bars are standard errors).
// Proliferating cells and cells made quiescent by 14 days of contact inhibition (CI14).
// Converted with 0.59 g protein per gDW, the protein content implied by the Human-GEM biomass reaction
// (5.34 mmol of amino acid residues per gDW, mean residue mass 111 g/mol): mmol/gDW/h = x · 0.59.
const FIBRO_P = [["glucose", 2.92, 2.77, 3.07], ["L-lactate", -1.85, -1.81, -1.89], ["glutamine", 0.59, 0.56, 0.62], ["glutamate", -0.08, -0.07, -0.09]];
const FIBRO_Q = [["glucose", 1.41, 1.35, 1.47], ["L-lactate", -1.40, -1.35, -1.45], ["glutamine", 0.21, 0.19, 0.23], ["glutamate", -0.05, -0.04, -0.06]];
const PROTEIN_PER_GDW = 0.59;

// HEK293 (parental, non-producing line) in exponential growth: Dietmair et al., PLoS ONE 7:e43394 (2012), Table 2.
// FreeStyle 293 medium (0.5 mM glutamine + 3 mM GlutaMAX). Rates are µmol per gDW per hour (their cell dry mass,
// 514 pg/cell, Table S1), mean ± standard error of 3 cultures. Alanine (11 ± 17) has no clear direction and is left
// out. Oxygen uptake was measured too (OUR).
const HEK293 = [
  ["glucose", 528, 465, 591], ["L-lactate", -695, -603, -787], ["O2", 335, 306, 364], ["NH4+", -17, -14, -20],
  ["glutamine", 29, 12, 46], ["serine", 37, 31, 43], ["leucine", 19, 15, 23], ["arginine", 16, 13, 19],
  ["valine", 14, 11, 17], ["isoleucine", 13, 10, 16], ["lysine", 12, 10, 14], ["threonine", 8.4, 6.8, 10],
  ["aspartate", 6.3, 4.7, 7.9], ["phenylalanine", 5.8, 4.8, 6.8], ["methionine", 4.9, 3.8, 6.0], ["tyrosine", 4.6, 3.9, 5.3],
  ["asparagine", 4.1, 3.1, 5.1], ["histidine", 3.2, 2.7, 3.7], ["tryptophan", 1.5, 1.2, 1.8],
  ["glutamate", -9.6, -8.2, -11], ["ornithine", -9.0, -7.5, -10.5], ["glycine", -6.2, -5.1, -7.3], ["proline", -3.8, -3.4, -4.2],
];

/**
 * Built-in sets. Names and notes are in js/i18n.js under meas.name.<id> / meas.note.<id>.
 * rows: [name, value in the source unit (+ uptake, − secretion), low, high]; toGDW converts to mmol/gDW/h.
 * ngam: ATP maintenance applied with the set (only where it is part of the source's own setting).
 */
export const MEASURED_SETS = [
  { id: "nci60", rows: NCI60, ngam: NGAM, unit: "fmol/cell/h", spread: "IQR", toGDW: (x) => x / CELL_MASS_PG },
  { id: "hek293", rows: HEK293, ngam: 0, unit: "µmol/gDW/h", spread: "± SE", toGDW: (x) => x / 1000 },
  { id: "fibroP", rows: FIBRO_P, ngam: NGAM, unit: "nmol/µg protein/h", spread: "± SE", toGDW: (x) => x * PROTEIN_PER_GDW },
  { id: "fibroQ", rows: FIBRO_Q, ngam: NGAM, unit: "nmol/µg protein/h", spread: "± SE", toGDW: (x) => x * PROTEIN_PER_GDW },
  { id: "liver", rows: LIVER, ngam: 0, unit: "µmol/g liver/day", spread: "range", toGDW: (x) => (x * LIVER_WET_DRY) / 24 / 1000 },
  { id: "none", rows: [] },
];

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
    if (met !== undefined) out.push({ met, rate: +set.toGDW(x).toPrecision(3) });
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
  return set ? set.rows.map(([name, x, lo, hi]) => ({ name, value: x, lo, hi, unit: set.unit, mmol: set.toGDW(x) })) : [];
}
