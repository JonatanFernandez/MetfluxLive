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
    if (r.m.length !== 1) return;
    const met = model.mets[r.m[0]];
    if (met.c !== "e" && met.c !== "s") return;
    if (!ex.has(r.m[0])) ex.set(r.m[0], { rxn: j, dir: r.c[0] < 0 ? -1 : 1 });
  });
  return ex;
}

/** Build the editable medium state from the defaults for a given model. */
export function defaultMedium(model) {
  const ex = findExchanges(model);
  const byName = new Map();
  for (const [mi] of ex) byName.set(model.bases[model.mets[mi].b].n.toLowerCase(), mi);
  const items = [];
  for (const [name, conc, vmax, km, flag] of DEFAULT_MEDIUM) {
    const mi = byName.get(name.toLowerCase());
    if (mi === undefined) continue;
    if (conc === null && vmax === 0) continue; // listed but closed by default
    items.push({ met: mi, conc: conc ?? 1, conc0: conc ?? 1, vmax: vmax ?? UNLIMITED, km: km ?? 0.1, unlimited: conc === null, hold: flag === "hold" });
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
