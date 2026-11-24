// Exometabolomics: measured concentrations in the spent medium -> exchange fluxes (mmol/gDW/h).
//
// The specific rate of a metabolite is the amount the cells took up (or released) divided by the biomass
// that did it, integrated over the interval:
//
//     q = (amount consumed) / ∫X dt        X: biomass in the well (gDW)
//
// Four details decide whether q is right, and all four are wrong in the obvious implementation:
//
//  1. ∫X dt, not X̄·Δt. While the cells divide, the biomass present is not its arithmetic mean. Over an
//     interval of exponential growth the integral is exact with the LOGARITHMIC mean,
//     ∫X dt = (X₂ − X₁)/µ = (X₂ − X₁)·Δt / ln(X₂/X₁). The arithmetic mean overestimates ∫X dt, and so
//     underestimates q, by 4 % after one doubling, 15 % after two and 34 % after three.
//     The logarithmic mean is applied PER SUB-INTERVAL, not only when there are two time points: plain
//     trapezoids over an exponential curve carry the same +4 % per doubling, so an intermediate sample
//     would make the answer worse instead of better. Per sub-interval it is exact for exponential growth
//     and still converges on a culture that stops growing (confluence) or shrinks.
//
//  2. The cell-free control is not a constant to subtract. Glutamine (and glutathione, pyruvate…) decay
//     spontaneously as a first-order reaction, dC/dt = −kC, so the abiotic loss is proportional to the
//     concentration that is actually there. Subtracting the control's own loss over-corrects, because the
//     well with cells has less of the metabolite left and therefore loses less of it in absolute terms.
//     Here k is fitted on the control and the abiotic loss of each well is k·∫n dt over its own course.
//
//  3. The decay acts on the AMOUNT, not the concentration: dn/dt = −k·n = −k·C·V. With a volume that
//     changes (evaporation) the abiotic loss is k·∫C·V dt, and k itself must be fitted on ln(C·V) of the
//     control — fitting ln C underestimates k, because evaporation concentrates the metabolite while it
//     decays and the two effects partly cancel.
//
//  4. Replicates are not averaged before the rate. Two wells seeded 20 % apart consume 20 % more between
//     them and have the SAME specific rate; dividing both by a shared mean biomass turns a seeding
//     difference into a spread. The rate is therefore computed per replicate, each with its own biomass,
//     volume and time points, and only then averaged — which also means replicates sampled at different
//     times are all used instead of discarded.
//
// Units: concentrations in mM, volume in mL, biomass in gDW, time in hours. A positive q is uptake and a
// negative one is secretion, the convention of js/core/measured.js and of the measured-flux panel.
//
// This module is pure arithmetic: no solver, no DOM. Fitting the rates to the network is in
// js/core/fitexchange.js.

// ---------------------------------------------------------------- input format ----
// One table, long format, tab- or comma-separated, one row per (condition, replicate, time, metabolite):
//
//   condition  replicate  time_h  metabolite  conc_mM  [volume_mL]  [cells | protein_ug | gdw]
//   control    1          0       glucose     5.5      2            1.0e6
//   control    1          24      glucose     3.1      2            4.2e6
//   blank      1          0       glutamine   2.0      2            0
//   ...
//
// Rules the parser enforces, rather than guessing:
//   · A row whose condition is "blank" (or whose biomass is 0) is a cell-free control and is used only to
//     fit the abiotic decay of that metabolite. Every blank replicate contributes to that fit.
//   · The biomass column may be cells, protein (µg or mg) or gDW; the column name decides which, and the
//     same column must be used throughout. The conversion to gDW is configurable (`opts`), because
//     g per cell differs by orders of magnitude between a mammalian cell, yeast and E. coli.
//   · Concentrations are mM; a `conc_uM` column is accepted and divided by 1000.
//   · Every (condition, replicate, metabolite) needs at least two distinct time points, and the biomass
//     must be given for the same times. Rows that repeat a time point are averaged, with a warning.
// Unknown columns are ignored, so an export with extra columns can be loaded unchanged.

/** Dry mass of a cultured mammalian cell, 0.3 ng (measured.js, Zielinski et al. 2017). */
export const CELL_MASS_PG = 300;
/** Protein per gram dry weight implied by the Human-GEM biomass reaction (measured.js). */
export const PROTEIN_PER_GDW = 0.59;

/** Biomass of a well in gDW, from cell counts, total protein or a dry weight already in gDW. */
export function toGdw(value, unit, { gdwPerCell = CELL_MASS_PG * 1e-12, proteinPerGdw = PROTEIN_PER_GDW } = {}) {
  switch (unit) {
    case "cells": return value * gdwPerCell;
    case "ugProtein": return (value * 1e-6) / proteinPerGdw;
    case "mgProtein": return (value * 1e-3) / proteinPerGdw;
    case "gdw": return value;
    default: return NaN;
  }
}

const COLUMNS = { // accepted header names -> field; everything else is ignored
  condition: "condition", group: "condition", sample: "condition",
  replicate: "replicate", rep: "replicate",
  time_h: "time", time: "time", hours: "time", h: "time",
  metabolite: "metabolite", compound: "metabolite", name: "metabolite", analyte: "metabolite",
  conc_mm: "conc_mM", conc: "conc_mM", mm: "conc_mM", concentration_mm: "conc_mM",
  conc_um: "conc_uM", um: "conc_uM", concentration_um: "conc_uM",
  volume_ml: "volume", volume: "volume", vol_ml: "volume",
  cells: "cells", cell_count: "cells", n_cells: "cells",
  protein_ug: "ugProtein", protein: "ugProtein", ug_protein: "ugProtein",
  protein_mg: "mgProtein", mg_protein: "mgProtein",
  gdw: "gdw", dry_weight_g: "gdw",
};
const BIOMASS_UNITS = ["cells", "ugProtein", "mgProtein", "gdw"];
const norm = (h) => h.trim().toLowerCase().replace(/[\s.\-/]+/g, "_").replace(/[^\w]/g, "");
const mean = (a) => a.reduce((s, x) => s + x, 0) / a.length;
const sd = (a) => (a.length < 2 ? 0 : Math.sqrt(a.reduce((s, x) => s + (x - mean(a)) ** 2, 0) / (a.length - 1)));

/**
 * Parse the long-format table described above.
 * @param opts { gdwPerCell, proteinPerGdw } — the conversion to gDW (see toGdw)
 * @returns { series: [{ condition, replicate, metabolite, times, conc, biomass, volume, isBlank }],
 *            biomassUnit, errors: [string], warnings: [string] }
 * Cell-free controls come back as series with isBlank = true; `groupForRates` pairs them with the samples.
 */
export function parseExoTable(text, opts = {}) {
  const errors = [], warnings = [];
  const lines = String(text).split(/\r?\n/).filter((l) => l.trim() !== "");
  if (lines.length < 2) return { series: [], biomassUnit: null, errors: ["the table has no data rows"], warnings };
  const sep = (lines[0].match(/\t/g) || []).length >= (lines[0].match(/,/g) || []).length ? "\t" : ",";
  const head = lines[0].split(sep).map((h) => COLUMNS[norm(h)] || null);
  for (const f of ["time", "metabolite"]) if (!head.includes(f)) errors.push(`a column for "${f}" is missing`);
  if (!head.includes("conc_mM") && !head.includes("conc_uM")) errors.push('a column for the concentration ("conc_mM" or "conc_uM") is missing');
  const bioCols = BIOMASS_UNITS.filter((u) => head.includes(u));
  if (bioCols.length > 1) errors.push(`more than one biomass column (${bioCols.join(", ")}): keep only one`);
  if (!bioCols.length) errors.push('a biomass column is missing ("cells", "protein_ug" or "gdw")');
  if (errors.length) return { series: [], biomassUnit: null, errors, warnings };
  const biomassUnit = bioCols[0];

  const rows = [];
  for (let i = 1; i < lines.length; i++) {
    const cells = lines[i].split(sep);
    const r = { condition: "", replicate: "1", metabolite: "", volume: NaN };
    head.forEach((f, c) => { if (f) r[f] = (cells[c] ?? "").trim(); });
    const num = (x) => (x === "" || x === undefined || x === null ? NaN : Number(x));
    const conc = head.includes("conc_mM") ? num(r.conc_mM) : num(r.conc_uM) / 1000;
    const t = num(r.time), bio = num(r[biomassUnit]);
    if (!r.metabolite) { warnings.push(`row ${i + 1}: no metabolite name, row skipped`); continue; }
    if (!Number.isFinite(t) || !Number.isFinite(conc)) { warnings.push(`row ${i + 1}: time or concentration is not a number, row skipped`); continue; }
    if (conc < 0) { warnings.push(`row ${i + 1}: negative concentration (${conc}), row skipped`); continue; }
    rows.push({ condition: r.condition || "sample", replicate: String(r.replicate || "1"), metabolite: r.metabolite,
      time: t, conc, volume: num(r.volume), biomass: Number.isFinite(bio) ? toGdw(bio, biomassUnit, opts) : NaN });
  }

  const byKey = new Map();
  for (const r of rows) {
    const key = `${r.condition}\u0000${r.replicate}\u0000${r.metabolite}`;
    (byKey.get(key) || byKey.set(key, []).get(key)).push(r);
  }
  const series = [];
  for (const [key, g0] of byKey) {
    const [condition, replicate, metabolite] = key.split("\u0000");
    g0.sort((a, b) => a.time - b.time);
    // rows that repeat a time point: averaged, so that a duplicate injection does not give Δt = 0
    const g = [];
    for (const r of g0) {
      const prev = g[g.length - 1];
      if (prev && prev.time === r.time) {
        prev._n = (prev._n || 1) + 1;
        prev.conc += (r.conc - prev.conc) / prev._n;
        if (Number.isFinite(r.biomass)) prev.biomass = Number.isFinite(prev.biomass) ? prev.biomass + (r.biomass - prev.biomass) / prev._n : r.biomass;
        if (Number.isFinite(r.volume)) prev.volume = Number.isFinite(prev.volume) ? prev.volume + (r.volume - prev.volume) / prev._n : r.volume;
        warnings.push(`${condition}/${replicate}/${metabolite}: two rows at t = ${r.time} h, averaged`);
      } else g.push({ ...r });
    }
    const isBlank = /^(blank|cell[-_ ]?free|no[-_ ]?cells?|control[-_ ]?blank)$/i.test(condition) || g.every((r) => r.biomass === 0);
    if (g.length < 2) { warnings.push(`${condition}/${replicate}/${metabolite}: only one time point, left out`); continue; }
    if (!isBlank && g.some((r) => !(r.biomass > 0))) { warnings.push(`${condition}/${replicate}/${metabolite}: a time point has no biomass, left out`); continue; }
    const vols = g.map((r) => r.volume).filter(Number.isFinite);
    if (!vols.length) warnings.push(`${condition}/${replicate}/${metabolite}: no volume given, 1 mL assumed`);
    series.push({ condition, replicate, metabolite, isBlank,
      times: g.map((r) => r.time), conc: g.map((r) => r.conc), biomass: g.map((r) => r.biomass),
      volume: vols.length === g.length ? vols : (vols[0] ?? 1) });
  }
  return { series, biomassUnit, errors, warnings: [...new Set(warnings)] };
}

/**
 * Group the parsed series by (condition, metabolite), keeping each replicate whole, and attach every
 * cell-free control of that metabolite.
 * @returns [{ condition, metabolite, replicates: [series], blanks: [series] }] for `ratesFromReplicates`
 */
export function groupForRates(parsed) {
  const blanks = new Map();
  for (const s of parsed.series) if (s.isBlank) (blanks.get(s.metabolite) || blanks.set(s.metabolite, []).get(s.metabolite)).push(s);
  const out = new Map();
  for (const s of parsed.series) {
    if (s.isBlank) continue;
    const key = `${s.condition}\u0000${s.metabolite}`;
    const e = out.get(key) || out.set(key, { condition: s.condition, metabolite: s.metabolite, replicates: [] }).get(key);
    e.replicates.push(s);
  }
  return [...out.values()].map((e) => ({ ...e, blanks: blanks.get(e.metabolite) || [] }));
}

const volAt = (s, i) => (Array.isArray(s.volume) ? s.volume[i] : s.volume) ?? 1;

/**
 * ∫X dt over a series, by the logarithmic mean of every sub-interval: exact while the growth is
 * exponential, and with no jump between two time points and more (see note 1 at the top).
 */
export function biomassIntegral(times, X) {
  if (times.length !== X.length || times.length < 2) return NaN;
  let s = 0;
  for (let i = 1; i < times.length; i++) {
    const dt = times[i] - times[i - 1], x1 = X[i - 1], x2 = X[i];
    if (!(dt > 0) || !(x1 > 0) || !(x2 > 0)) return NaN;
    const g = x2 / x1;
    s += (Math.abs(g - 1) < 1e-9 ? x1 : (x2 - x1) / Math.log(g)) * dt;
  }
  return s;
}

/** ∫n dt by trapezoids, n = C·V in mmol (C in mM, V in mL, so the result is mmol·h/1000). */
const amountIntegral = (s) => {
  let acc = 0;
  for (let i = 1; i < s.times.length; i++) {
    const n1 = s.conc[i - 1] * volAt(s, i - 1), n2 = s.conc[i] * volAt(s, i);
    acc += ((n1 + n2) / 2) * (s.times[i] - s.times[i - 1]);
  }
  return acc / 1000;
};

/**
 * First-order decay constant k (1/h) of the cell-free controls, by least squares on ln(C·V) — the amount
 * in the well, so that a volume lost to evaporation does not hide the decay. All replicates are pooled.
 * @param blanks [series]  @returns { k, r2, n } — a negative slope means no measurable decay, k is 0
 */
export function decayConstant(blanks) {
  const list = Array.isArray(blanks) ? blanks : [blanks];
  const x = [], y = [];
  for (const s of list) {
    if (!s || !s.times) continue;
    for (let i = 0; i < s.times.length; i++) {
      const n = s.conc[i] * volAt(s, i);
      if (n > 0) { x.push(s.times[i]); y.push(Math.log(n)); }
    }
  }
  if (x.length < 2) return { k: 0, r2: 0, n: x.length };
  const mx = mean(x), my = mean(y);
  let sxy = 0, sxx = 0, syy = 0;
  for (let i = 0; i < x.length; i++) { sxy += (x[i] - mx) * (y[i] - my); sxx += (x[i] - mx) ** 2; syy += (y[i] - my) ** 2; }
  const slope = sxx > 0 ? sxy / sxx : 0;
  return { k: Math.max(0, -slope), r2: syy > 0 && sxx > 0 ? (sxy * sxy) / (sxx * syy) : 0, n: x.length };
}

/**
 * Specific exchange rate of ONE replicate.
 * @param s { times: [h], conc: [mM], biomass: [gDW], volume: mL | [mL per time point] }
 * @param k first-order decay constant of this metabolite (1/h), 0 if there is no control
 * @returns { rate, consumed, integral, flags }  rate in mmol/gDW/h, + uptake / − secretion
 */
export function rateFromCourse(s, k = 0) {
  const flags = [], n = s.times.length;
  if (n === 2) flags.push("twoPoints");
  if (s.conc[n - 1] <= 0.02 * s.conc[0] && s.conc[0] > 0) flags.push("depleted");
  const integral = biomassIntegral(s.times, s.biomass);
  // amount lost from the well (mmol): C·V in mM·mL, so ÷1000
  const lost = (s.conc[0] * volAt(s, 0) - s.conc[n - 1] * volAt(s, n - 1)) / 1000;
  const abiotic = k * amountIntegral(s);
  if (k > 0 && Math.abs(lost) > 0 && Math.abs(abiotic) > 0.5 * Math.abs(lost)) flags.push("blankDominates");
  const consumed = lost - abiotic;
  return { rate: consumed / integral, consumed, integral, flags };
}

/**
 * Specific rate of one (condition, metabolite): the rate of every replicate on its own data, then their
 * mean and spread. A difference in seeding density or in volume between wells therefore cancels instead of
 * becoming variance.
 * @param group { replicates: [series], blanks: [series] } from groupForRates
 * @returns { rate, sd, n, perReplicate, k, decayR2, flags }
 */
export function ratesFromReplicates(group, opts = {}) {
  const fit = group.blanks?.length ? decayConstant(group.blanks) : { k: 0, r2: 0, n: 0 };
  const flags = [];
  if (!group.blanks?.length) flags.push("noBlank");
  else if (fit.k > 0 && fit.r2 < 0.5) flags.push("noDecayFit");
  const per = [];
  for (const s of group.replicates) {
    const r = rateFromCourse(s, opts.k ?? fit.k);
    if (!Number.isFinite(r.rate)) { flags.push("badReplicate"); continue; }
    per.push(r.rate); flags.push(...r.flags);
  }
  return { rate: per.length ? mean(per) : NaN, sd: sd(per), n: per.length, perReplicate: per,
    k: opts.k ?? fit.k, decayR2: fit.r2, flags: [...new Set(flags)] };
}

/**
 * Specific growth rate µ (1/h) from a biomass series: the slope of ln X against time by least squares
 * (with two points, ln(X₂/X₁)/Δt). r2 well below 1 means the culture is not growing exponentially over
 * the interval and a single rate does not describe it.
 */
export function growthRate(times, X) {
  const pts = times.map((t, i) => [t, X[i]]).filter(([, x]) => x > 0);
  if (pts.length < 2) return { mu: NaN, r2: 0, n: pts.length };
  const x = pts.map((p) => p[0]), y = pts.map((p) => Math.log(p[1]));
  const mx = mean(x), my = mean(y);
  let sxy = 0, sxx = 0, syy = 0;
  for (let i = 0; i < x.length; i++) { sxy += (x[i] - mx) * (y[i] - my); sxx += (x[i] - mx) ** 2; syy += (y[i] - my) ** 2; }
  return { mu: sxx > 0 ? sxy / sxx : NaN, r2: sxx > 0 && syy > 0 ? (sxy * sxy) / (sxx * syy) : 1, n: pts.length };
}
