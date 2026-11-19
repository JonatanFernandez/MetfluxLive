// Default culture medium and the concentration -> uptake-capacity rule.
//
// A stoichiometric model has no concentrations: availability enters as an upper
// bound on uptake. We use a saturable (Michaelis-Menten) rule
//     maxUptake = Vmax * C / (Km + C)
// so that editing a concentration (mM) behaves intuitively.

// name (as in the GEM), concentration mM, Vmax mmol/gDW/h, Km mM
// Composition loosely follows Ham's F-12 / DMEM; Vmax values are order-of-magnitude
// figures for proliferating mammalian cells.
export const DEFAULT_MEDIUM = [
  ["glucose", 5.5, 0.6, 1.5],
  ["glutamine", 2, 0.12, 0.5],
  ["O2", 0.2, 2.5, 0.005, "hold"], // replenished by gas exchange: not depleted in dynamic runs
  ["arginine", 0.4, 0.03, 0.1], ["histidine", 0.2, 0.01, 0.1], ["lysine", 0.8, 0.03, 0.1],
  ["methionine", 0.2, 0.01, 0.1], ["phenylalanine", 0.4, 0.012, 0.1], ["tryptophan", 0.08, 0.004, 0.05],
  ["tyrosine", 0.4, 0.012, 0.1], ["alanine", 0.1, 0.02, 0.1], ["glycine", 0.4, 0.02, 0.1],
  ["serine", 0.4, 0.04, 0.1], ["threonine", 0.8, 0.02, 0.1], ["aspartate", 0.1, 0.01, 0.1],
  ["glutamate", 0.1, 0.01, 0.1], ["asparagine", 0.1, 0.01, 0.1], ["isoleucine", 0.8, 0.03, 0.1],
  ["leucine", 0.8, 0.03, 0.1], ["proline", 0.3, 0.01, 0.1], ["valine", 0.8, 0.03, 0.1],
  ["cysteine", 0.2, 0.01, 0.1], ["cystine", 0.2, 0.005, 0.1],
  ["choline", 0.03, 0.01, 0.01], ["inositol", 0.04, 0.005, 0.01], ["thiamin", 0.01, 0.001, 0.005],
  ["folate", 0.01, 0.001, 0.005], ["biotin", 0.001, 0.001, 0.0005], ["pantothenate", 0.01, 0.001, 0.005],
  ["nicotinamide", 0.03, 0.002, 0.01], ["pyridoxine", 0.02, 0.001, 0.01], ["riboflavin", 0.001, 0.001, 0.0005],
  ["hypoxanthine", 0.03, 0.002, 0.01], ["thymidine", 0.003, 0.001, 0.001],
  ["aquacob(III)alamin", 0.001, 0.0005, 0.0005], ["lipoic acid", 0.001, 0.0005, 0.0005],
  ["linoleate", 0.05, 0.004, 0.02], ["linolenate", 0.05, 0.004, 0.02],
  ["retinoate", 0.001, 0.0005, 0.0005], ["alpha-tocopherol", 0.001, 0.0005, 0.0005],
  ["gamma-tocopherol", 0.001, 0.0005, 0.0005],
  // unlimited inorganic components
  ["H2O", null], ["H+", null], ["Pi", null], ["sulfate", null], ["Fe2+", null], ["Na+", null],
  ["K+", null], ["Ca2+", null], ["Mg2+", null], ["chloride", null], ["HCO3-", null], ["NH4+", null, 0],
];

// ---------------------------------------------------------------- physiological media ----
// Plasmax and HPLM, concentrations in µM exactly as listed in Table S1 of
// Vande Voorde et al., Sci. Adv. 5:eaau7314 (2019), PMID 30613774 (HPLM column: Cantor et al., Cell 169:258, 2017).
// null = not in that formulation. Names are the ones used by Human-GEM / Mouse-GEM.
// Not represented in the models and therefore left out: methyl acetoacetate, phenol red, p-aminobenzoate,
// selenite, manganese, vanadate, nitrate.
//   [name, Plasmax, HPLM]
const PLASMA_LIKE = [
  ["glucose", 5560, 5000], ["glutamine", 650, 550],
  ["alanine", 510, 430], ["arginine", 64, 110], ["asparagine", 41, 50], ["aspartate", 6, 20],
  ["cysteine", 33, 40], ["glutamate", 98, 80], ["glycine", 330, 300], ["histidine", 120, 110],
  ["isoleucine", 140, 70], ["leucine", 170, 160], ["lysine", 220, 200], ["methionine", 30, 30],
  ["phenylalanine", 68, 80], ["proline", 360, 200], ["serine", 140, 150], ["threonine", 240, 140],
  ["tryptophan", 78, 60], ["tyrosine", 74, 80], ["valine", 230, 220],
  ["4-aminobutyrate", 41, 20], ["citrulline", 55, 40], ["cystine", 65, 100], ["homocysteine", 9, null],
  ["trans-4-hydroxy-L-proline", 13, 20], ["ornithine", 80, 70], ["5-oxoproline", 20, null],
  ["Acetyl-Glycine", 70, 90], ["carnosine", 6, null], ["GSH", 37, 25], ["taurine", 130, 90], ["betaine", 72, 70],
  ["acetate", 42, 40], ["acetone", 55, 60], ["O-acetylcarnitine", 5, null], ["citrate", 114, 130],
  ["L-carnitine", 46, 40], ["creatine", 37, 40], ["creatinine", 74, 75], ["formate", 33, 50],
  ["fructose", null, 40], ["galactose", null, 60], ["glycerol", 82, 120], ["2-hydroxybutyrate", 31, 50],
  ["(R)-3-hydroxybutanoate", 77, 50], ["3-hydroxyisobutyrate", 20, null], ["hypoxanthine", 5, 10],
  ["L-lactate", 500, 1600], ["malonate", null, 10], ["pyruvate", 100, 50], ["succinate", 23, 20],
  ["uracil", 2, null], ["urate", 270, 350], ["urea", 3000, 5000], ["uridine", 3, null],
  ["NH4+", 50, 40],
  ["ascorbate", 62, null], ["biotin", 4.1, 0.8], ["choline", 7.1, 21.5], ["folate", 2.3, 2.3],
  ["inositol", 11.1, 194.3], ["nicotinamide", 8.2, 8.2], ["pantothenate", 4.2, 1.05], ["pyridoxine", 4.9, 4.9],
  ["riboflavin", 0.3, 0.5], ["thiamin", 3, 3], ["aquacob(III)alamin", 0.005, 0.0037],
];
// Not in Table S1 but needed by the biomass reaction; in the real media they come with the serum
// (2.5 % FBS in Plasmax, 10 % dialysed FBS in HPLM). Concentrations are those of the standard medium above.
const SERUM = ["linoleate", "linolenate", "retinoate", "alpha-tocopherol", "gamma-tocopherol", "lipoic acid"];
// bulk salts and trace metals are never limiting here
const INORGANIC = ["H2O", "H+", "Pi", "sulfate", "Na+", "K+", "Ca2+", "Mg2+", "chloride", "HCO3-", "Fe2+", "Fe3+", "zinc", "Cu2+"];

// Vmax (mmol/gDW/h), Km (mM) for components that the standard medium does not list. Orders of magnitude.
const KINETICS = {
  "L-lactate": [0.2, 2], pyruvate: [0.1, 0.3], acetate: [0.05, 0.2], glycerol: [0.02, 0.2],
  "(R)-3-hydroxybutanoate": [0.03, 0.5], citrate: [0.01, 0.2], succinate: [0.01, 0.2],
  fructose: [0.05, 5], galactose: [0.05, 1], "NH4+": [0.02, 0.1], urea: [0.005, 1], urate: [0.002, 0.2],
  ascorbate: [0.002, 0.05], uridine: [0.002, 0.01], uracil: [0.002, 0.01],
};
const KIN_FALLBACK = [0.005, 0.05];
/** Uptake kinetics [Vmax, Km] used for a metabolite added by hand: the built-in value when there is one. */
export const kineticsFor = (name) => KINETICS[name] || [0.5, 1];
for (const [name, conc, vmax, km] of DEFAULT_MEDIUM) if (conc !== null) KINETICS[name] = [vmax, km];

function plasmaLike(col) {
  const std = new Map(DEFAULT_MEDIUM.map((d) => [d[0], d]));
  const rows = [];
  for (const d of PLASMA_LIKE) if (d[col] !== null) rows.push([d[0], d[col] / 1000, ...(KINETICS[d[0]] || KIN_FALLBACK)]);
  rows.splice(2, 0, std.get("O2"));
  for (const n of SERUM) rows.push(std.get(n));
  for (const n of INORGANIC) rows.push([n, null]);
  return rows;
}

// Williams E as made by Grankvist et al., Nat Metab 6:1963 (2024), Supplementary Table 2 (fasted, serum-free),
// for their human liver slices. Concentrations in mM. Not represented in the models and left out: menadione,
// manganese, nitrate (ferric nitrate enters as Fe3+). Ergocalciferol is "vitamin D2", cobalamin "aquacob(III)alamin".
const WILLIAMS_E = [
  ["glucose", 5.5], ["glutamine", 2.0], ["alanine", 1.01], ["glycine", 0.667], ["leucine", 0.573], ["cysteine", 0.4966],
  ["lysine", 0.478], ["valine", 0.427], ["isoleucine", 0.382], ["glutamate", 0.3398], ["threonine", 0.336],
  ["arginine", 0.287], ["proline", 0.261], ["pyruvate", 0.227], ["aspartate", 0.226], ["tyrosine", 0.194],
  ["phenylalanine", 0.152], ["asparagine", 0.1332], ["methionine", 0.101], ["histidine", 0.0968], ["serine", 0.0952],
  ["tryptophan", 0.049], ["inositol", 0.0111], ["ascorbate", 0.01136], ["choline", 0.01074], ["nicotinamide", 0.0082],
  ["pyridoxine", 0.0049], ["pantothenate", 0.0042], ["thiamin", 0.00297], ["folate", 0.00227], ["biotin", 0.00205],
  ["retinol", 0.000305], ["riboflavin", 0.000266], ["vitamin D2", 0.000252], ["GSH", 0.000163],
  ["aquacob(III)alamin", 0.00015], ["linoleate", 0.000102], ["alpha-tocopherol", 0.000018],
];
function williamsE() {
  const std = new Map(DEFAULT_MEDIUM.map((d) => [d[0], d]));
  const rows = WILLIAMS_E.map(([n, c]) => [n, c, ...(KINETICS[n] || KIN_FALLBACK)]);
  rows.splice(2, 0, std.get("O2"));
  for (const n of INORGANIC) rows.push([n, null]);
  return rows;
}

// Schneider's Drosophila Medium as sold by Gibco (cat. 21720), the medium of Drosophila S2 cells, in mM exactly as in
// the manufacturer's formulation table (thermofisher.com, media formulation 230; Schneider 1964, J Exp Zool 156:91;
// S2 cells: Schneider 1972, J Embryol Exp Morphol 27:353). Its 2 g/L yeastolate (a yeast extract of undefined composition) and the 10 % FBS used with S2 cells are
// what bring vitamins, nucleobases and lipids: those are taken from the standard medium (SCHNEIDER_EXTRA), as for the
// serum of Plasmax and HPLM. Salts are listed as ions (INORGANIC).
const SCHNEIDER = [
  ["glucose", 11.111111], ["trehalose", 5.8479533], ["glutamine", 12.328767],
  ["glycine", 3.3333333], ["arginine", 2.2988505], ["aspartate", 3.0075188], ["cysteine", 0.49586776],
  ["cystine", 0.41666666], ["glutamate", 5.442177], ["histidine", 2.580645], ["isoleucine", 1.1450381],
  ["leucine", 1.1450381], ["lysine", 9.016394], ["methionine", 5.3691278], ["phenylalanine", 0.90909094],
  ["proline", 14.782609], ["serine", 2.3809524], ["threonine", 2.9411764], ["tryptophan", 0.49019608],
  ["tyrosine", 2.762431], ["valine", 2.5641026], ["beta-alanine", 5.6179776],
  ["AKG", 1.369863], ["fumarate", 0.86206895], ["malate", 0.74626863], ["succinate", 0.84745765],
];
const SCHNEIDER_EXTRA = ["choline", "inositol", "thiamin", "folate", "biotin", "pantothenate", "nicotinamide", "pyridoxine",
  "riboflavin", "hypoxanthine", "thymidine", "aquacob(III)alamin", "lipoic acid", "linoleate", "linolenate", "retinoate",
  "alpha-tocopherol", "gamma-tocopherol"];
function schneider() {
  const std = new Map(DEFAULT_MEDIUM.map((d) => [d[0], d]));
  // amino acids and sugars keep the uptake kinetics of the standard medium; the rest the fallback
  const rows = SCHNEIDER.map(([n, c]) => [n, c, ...(std.get(n)?.slice(2, 4) || KINETICS[n] || KIN_FALLBACK)]);
  rows.splice(3, 0, std.get("O2"));
  for (const n of SCHNEIDER_EXTRA) rows.push(std.get(n));
  for (const n of INORGANIC) rows.push([n, null]);
  return rows;
}

// ---------------------------------------------------------------- microbial media ----
// Concentrations in mM from the published recipes (sources in docs, "Media"). Uptake kinetics are the microbes' own
// orders of magnitude, not the mammalian ones above: a glucose uptake of about 10 mmol/gDW/h for E. coli (Castaño-Cerezo
// et al. 2009 measured 10.6) and 22 for S. cerevisiae in batch, an oxygen uptake capacity of 15 for E. coli (the value of
// Varma & Palsson, Appl Environ Microbiol 60:3724, 1994, with which FBA reproduces acetate overflow) and
// 8 mmol/gDW/h (S. cerevisiae, whose respiration saturates: above it the excess glucose is fermented, the Crabtree
// effect). Salts, trace metals and the nitrogen source are not limiting (null). Both models' names for trace metals
// are listed; a name that a model lacks is simply skipped.
const MICRO_TRACE = ["H2O", "H+", "Pi", "sulfate", "NH4+", "K+", "Na+", "Mg2+", "Ca2+", "chloride", "Fe2+", "Fe3+", "zinc", "Cu2+",
  "Manganese", "Mn(2+)", "Co2+", "Molybdate", "Nickel", "selenate", "selenite", "Tungstate", "CO2"];
const microRows = (list, o2) => [...list, ...(o2 ? [["O2", 0.2, o2, 0.001, "hold"]] : []), ...MICRO_TRACE.map((n) => [n, null])];
// M9 minimal medium (Sambrook & Russell, Molecular Cloning, 2001) with 0.4 % (w/v) of one carbon source
const M9 = (name, mM, vmax, km, o2 = 15) => microRows([[name, mM, vmax, km]], o2);
// Verduyn et al., Yeast 8:501 (1992) mineral medium: vitamins at the published concentrations (biotin 0.05, Ca-pantothenate 1,
// nicotinic acid 1, myo-inositol 25, thiamine-HCl 1, pyridoxine-HCl 1, p-aminobenzoate 0.2 mg/L) and 20 g/L glucose (batch)
const VITS_VERDUYN = [["biotin", 0.000205], ["pantothenate", 0.0021], ["nicotinate", 0.0081], ["inositol", 0.139], ["thiamin", 0.003],
  ["pyridoxine", 0.0049], ["4-aminobenzoate", 0.00146]];
// Difco Yeast Nitrogen Base without amino acids (Difco & BBL Manual): vitamins and 2 % glucose
const VITS_YNB = [["biotin", 0.0000082], ["pantothenate", 0.00084], ["folate", 0.0000045], ["inositol", 0.0111], ["nicotinate", 0.00325],
  ["4-aminobenzoate", 0.00146], ["pyridoxine", 0.00195], ["riboflavin", 0.00053], ["thiamin", 0.00119]];
// Complete Supplement Mixture (CSM, MP Biomedicals 4500-012) added to YNB: synthetic complete (SC) medium
const CSM = [["adenine", 0.074], ["arginine", 0.287], ["aspartate", 0.601], ["histidine", 0.129], ["isoleucine", 0.381], ["leucine", 0.762],
  ["lysine", 0.342], ["methionine", 0.134], ["phenylalanine", 0.303], ["threonine", 0.84], ["tryptophan", 0.245], ["tyrosine", 0.276],
  ["uracil", 0.178], ["valine", 1.195]];
// vitamins are needed in µmol/gDW amounts: a low uptake capacity keeps the model from using them as nutrients. Nicotinate
// is the exception: without O2 yeast cannot make NAD de novo (kynurenine pathway) and takes all of it from nicotinate.
const yvit = (list) => list.map(([n, c]) => [n, c, n === "nicotinate" ? 0.01 : 0.001, 0.0005]);
const yglc = (mM) => ["glucose", mM, 22, 1];
const YEAST_O2 = 8;
// anaerobic yeast cultures need sterols and unsaturated fatty acids, which they cannot make without O2: ergosterol 10 mg/L
// and Tween 80 0.42 g/L (oleate). yeast-GEM's biomass also needs palmitoleate (16:1) chains, which its anaerobic setting
// lets in as well; it is added at the same molar amount as oleate. Heme synthesis needs O2 too, and that setting takes
// heme a (1e-6 mmol/gDW of biomass) out of the cofactor pool: here a trace of it is let in instead.
const ANAER = [["ergosterol", 0.025, 0.01, 0.001], ["oleate", 0.32, 0.2, 0.01], ["palmitolate", 0.32, 0.2, 0.01], ["heme a", 0.0001, 0.0001, 0.00001]];

/** Built-in media. Display names and notes are in js/i18n.js under medium.name.<id> / medium.note.<id>. */
export const MEDIA = [
  { id: "default", rows: DEFAULT_MEDIUM },
  { id: "plasmax", rows: plasmaLike(1) },
  { id: "hplm", rows: plasmaLike(2) },
  { id: "williamsE", rows: williamsE() },
  { id: "schneider", rows: schneider() },
  // E. coli
  { id: "m9glc", org: "ecoli-gem", rows: M9("glucose", 22.2, 10.5, 0.01) },
  { id: "m9glcAnaer", org: "ecoli-gem", rows: M9("glucose", 22.2, 26, 0.01, 0) },
  { id: "m9glyc", org: "ecoli-gem", rows: M9("glycerol", 43.4, 8, 0.05) },
  { id: "m9ace", org: "ecoli-gem", rows: M9("acetate", 48.8, 25, 0.5) },
  { id: "m9succ", org: "ecoli-gem", rows: M9("succinate", 33.9, 10, 0.5) },
  // S. cerevisiae
  { id: "verduyn", org: "yeast-gem", rows: microRows([yglc(111), ...yvit(VITS_VERDUYN)], YEAST_O2) },
  { id: "verduynAnaer", org: "yeast-gem", rows: microRows([yglc(111), ...yvit(VITS_VERDUYN), ...ANAER], 0) },
  { id: "ynb", org: "yeast-gem", rows: microRows([yglc(111), ...yvit(VITS_YNB)], YEAST_O2) },
  { id: "sc", org: "yeast-gem", rows: microRows([yglc(111), ...yvit(VITS_YNB), ...CSM.map(([n, c]) => [n, c, 0.5, 0.05])], YEAST_O2) },
];

export const UNLIMITED = 1000;

export function uptakeCapacity(conc, vmax, km) {
  if (conc <= 0) return 0;
  return (vmax * conc) / (km + conc);
}

/**
 * Locate exchange reactions (single metabolite, extracellular).
 * @returns Map metIndex -> { rxn, dir } where uptake flux = dir * v  (dir is -1 or +1)
 */
export function findExchanges(model) {
  const ex = new Map();
  model.rxns.forEach((r, j) => {
    if (r.m.length !== 1 || r.removed) return;
    const met = model.mets[r.m[0]];
    if (met.c !== "e" && met.c !== "s") return;
    if (!ex.has(r.m[0])) ex.set(r.m[0], { rxn: j, dir: r.c[0] < 0 ? -1 : 1 });
  });
  return ex;
}

/** Build the editable medium state of a built-in medium for a given model. */
export function presetMedium(model, id = "default") {
  const rows = (MEDIA.find((m) => m.id === id) || MEDIA[0]).rows;
  const ex = findExchanges(model);
  const byName = new Map();
  for (const [mi] of ex) byName.set(model.bases[model.mets[mi].b].n.toLowerCase(), mi);
  const items = [];
  for (const [name, conc, vmax, km, flag] of rows) {
    const mi = byName.get(name.toLowerCase());
    if (mi === undefined) continue;
    if (conc === null && vmax === 0) continue; // listed but closed by default
    items.push({ met: mi, conc: conc ?? 1, conc0: conc ?? 1, vmax: vmax ?? UNLIMITED, km: km ?? 0.1, unlimited: conc === null, hold: flag === "hold" });
  }
  return items;
}
export const defaultMedium = (model) => presetMedium(model, "default");

/** Medium state -> plain data that does not depend on metabolite indices (shared by Human-GEM and Mouse-GEM). */
export function exportMedium(model, items) {
  return items.map((it) => {
    const met = model.mets[it.met];
    return { b: model.bases[met.b].id, c: met.c, conc: it.conc, vmax: it.vmax, km: it.km, unlimited: !!it.unlimited, hold: !!it.hold };
  });
}

/** Inverse of exportMedium; entries whose metabolite is not in this model are dropped. */
export function importMedium(model, saved) {
  const at = new Map();
  model.mets.forEach((m, i) => at.set(model.bases[m.b].id + "|" + m.c, i));
  const items = [];
  for (const s of saved || []) {
    const mi = at.get(s.b + "|" + s.c);
    const conc = +s.conc, vmax = +s.vmax, km = +s.km;
    if (mi === undefined || !(conc >= 0) || !(vmax >= 0) || !(km > 0)) continue;
    items.push({ met: mi, conc, conc0: conc, vmax, km, unlimited: !!s.unlimited, hold: !!s.hold });
  }
  return items;
}

/**
 * Translate medium + injections into reaction bounds.
 * Uptake is closed for every exchange not present in the medium; secretion stays open.
 */
export function applyMedium(model, exchanges, medium, baseLb, baseUb) {
  const lb = Float64Array.from(baseLb), ub = Float64Array.from(baseUb);
  for (const [, e] of exchanges) {
    if (e.dir < 0) lb[e.rxn] = 0; else ub[e.rxn] = 0;
  }
  for (const it of medium) {
    const e = exchanges.get(it.met);
    if (!e) continue;
    const cap = it.unlimited ? UNLIMITED : uptakeCapacity(it.conc, it.vmax, it.km);
    if (e.dir < 0) lb[e.rxn] = -cap; else ub[e.rxn] = cap;
  }
  return { lb, ub };
}
