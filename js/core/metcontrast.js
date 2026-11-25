// Interpreting a metabolomics contrast on the network: what changed, and which reaction could explain it.
//
// Everything here works on FOLD CHANGES between two conditions, never on a concentration. That is not a
// limitation to apologise for, it is what makes relative data usable: each metabolite is compared only with
// itself across the two conditions, so the response factor of the instrument cancels. The corollary is
// strict — a ratio BETWEEN two different metabolites (lactate over pyruvate, ATP over AMP) has no meaning
// in relative units, and only the CHANGE of such a ratio does, because there the factors cancel again:
//     Δlog2(A/B) = log2FC(A) − log2FC(B)
// `ratioChanges` computes exactly that and nothing else.
//
// Three things this deliberately reports instead of hiding:
//   · the median fold change of the whole panel. If a class of metabolites moves by about as much as the
//     whole panel, that is the normalisation moving, not biology (total ion current, cell number, protein).
//   · which reactions the panel can actually see. A hypothesis about a reaction whose substrate or product
//     was never measured is not a finding, it is an extrapolation.
//   · that the metabolites are not independent of each other. They share pathways and a normalisation, so a
//     p-value from a test that assumes independence is optimistic. `permutationNull` is the honest check.
//
// No solver and no DOM. The flux direction and the free energies are passed in when they are available; the
// detectors work without them but say so, because a reaction near equilibrium that simply ran backwards
// looks exactly like a blocked one (substrate up, product down) in the other direction.
//
// What the validation decided (tools/validation/metcontrast_validate.mjs, three published experiments whose
// cause the authors established by other means):
//   · `bottlenecks` earns its place. Methionine restriction: the methionine cycle ranks 3rd of 74. The
//     HEK293 producer line, whose oxidative phosphorylation genes are down by the authors' transcriptomics:
//     an adenylate step ranks 1st of 20.
//   · `pathwayShifts` does not locate a cause and must not be presented as if it did (see its own note).
//   · `permutationNull` discriminates: it never reached the real score on methionine restriction (0 of 60
//     rounds, p = 0.016) but reached it 4 times out of 60 on the HEK293 contrast (p = 0.08), which is the
//     right answer there — that top candidate is suggestive and no more.
//   · normalising is conditional on the panel median and never silent. Above about 0.3 in log2 the whole
//     panel has moved and the statistics are worthless without it; below, normalising destroys real signal
//     (on the HEK293 contrast it takes the significant metabolites from 18 to 2 and every candidate with
//     them). The threshold is a measurement, not a convention.

// ---------------------------------------------------------------- the table ----
/**
 * Read the shape metabolomics tables actually come in: metabolites down the rows, samples across the
 * columns. (The exometabolomics importer takes a long table instead, because there a row is a time point.)
 *
 *   metabolite   ctrl_1  ctrl_2  treat_1  treat_2
 *   Methionine   1.2e5   1.1e5   3.0e4    2.8e4
 *
 * A second header row naming the group of each sample is used when it is there; otherwise the caller gives
 * two patterns and the sample names decide. Empty cells and non-numeric values become NaN and are dropped
 * per metabolite, not per row, so one missing value does not lose the metabolite.
 *
 * @returns { samples: [name], groups: [name|null], rows: [{ label, values: [number] }], errors, warnings }
 */
export function parseWideTable(text) {
  const errors = [], warnings = [];
  const lines = String(text).replace(/^\uFEFF/, "").split(/\r?\n/).filter((l) => l.trim() !== "");
  if (lines.length < 2) return { samples: [], groups: [], rows: [], errors: ["the table has no data rows"], warnings };
  const sep = (lines[0].match(/\t/g) || []).length >= (lines[0].match(/,/g) || []).length ? "\t" : ",";
  const cut = (l) => l.split(sep).map((x) => x.trim().replace(/^"(.*)"$/, "$1"));
  const head = cut(lines[0]);
  const samples = head.slice(1);
  if (samples.length < 2) return { samples: [], groups: [], rows: [], errors: ["the first row must name the samples, one column each"], warnings };
  // a second row whose own first cell is empty or says "group"/"factor" names the groups
  let groups = samples.map(() => null), first = 1;
  const second = cut(lines[1]);
  if (second.length && (!second[0] || /^(group|factor|condition|class)s?$/i.test(second[0]))) {
    groups = second.slice(1); first = 2;
  }
  const rows = [];
  const seen = new Map();
  for (let i = first; i < lines.length; i++) {
    const c = cut(lines[i]);
    const label = c[0];
    if (!label) { warnings.push(`row ${i + 1}: no metabolite name, row skipped`); continue; }
    const values = samples.map((_, k) => { const v = c[k + 1]; return v === "" || v === undefined ? NaN : Number(v); });
    if (values.every((v) => !Number.isFinite(v))) { warnings.push(`${label}: no numeric value, row skipped`); continue; }
    if (seen.has(label.toLowerCase())) { warnings.push(`${label}: named twice, the first row is kept`); continue; }
    seen.set(label.toLowerCase(), true);
    rows.push({ label, values });
  }
  if (!rows.length) errors.push("no row carried a numeric value");
  return { samples, groups, rows, errors, warnings: [...new Set(warnings)] };
}

/**
 * Split a wide table into the two sides of a contrast. A sample belongs to a side when its group (if the
 * table named one) or its own name contains that side's pattern, ignoring case.
 * @returns { rows: [{ label, a, b }], nA, nB, namesA, namesB }
 */
export function splitByPattern(table, patternA, patternB) {
  const pa = String(patternA || "").trim().toLowerCase(), pb = String(patternB || "").trim().toLowerCase();
  const pick = (p) => table.samples.map((s, i) => [s, table.groups[i], i])
    .filter(([s, g]) => p && `${g || ""} ${s}`.toLowerCase().includes(p)).map(([, , i]) => i);
  const ia = pick(pa), ib = pick(pb);
  const both = ia.filter((i) => ib.includes(i));
  const rows = table.rows.map((r) => ({ label: r.label, a: ia.map((i) => r.values[i]), b: ib.map((i) => r.values[i]) }));
  return { rows, nA: ia.length, nB: ib.length, overlap: both.length,
    namesA: ia.map((i) => table.samples[i]), namesB: ib.map((i) => table.samples[i]) };
}

// ---------------------------------------------------------------- statistics ----
const mean = (a) => a.reduce((s, x) => s + x, 0) / a.length;
const variance = (a) => (a.length < 2 ? 0 : a.reduce((s, x) => s + (x - mean(a)) ** 2, 0) / (a.length - 1));
const median = (a) => { const s = [...a].sort((x, y) => x - y); const h = s.length >> 1; return s.length % 2 ? s[h] : (s[h - 1] + s[h]) / 2; };

// Abramowitz & Stegun 7.1.26 (used for Mann-Whitney and large-df Student-t fallback)
const erf = (x) => {
  const t = 1 / (1 + 0.3275911 * Math.abs(x));
  const y = 1 - ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-x * x);
  return x >= 0 ? y : -y;
};
const normP = (z) => 1 - erf(Math.abs(z) / Math.SQRT2);

// Lanczos log-gamma and regularised incomplete beta I_x(a, b) (Lentz's continued fraction) for exact
// two-sided Student's t p-values: normP(t) underestimates p by 7x–85x at n = 3–4 replicates per group.
const logGamma = (z) => {
  const c = [76.18009172947146, -86.50532032941677, 24.01409824083091, -1.231739572450155, 1.208650973866179e-3, -5.395239384953e-6];
  let x = z, y = z, tmp = x + 5.5;
  tmp -= (x + 0.5) * Math.log(tmp);
  let ser = 1.000000000190015;
  for (let j = 0; j < 6; j++) ser += c[j] / ++y;
  return -tmp + Math.log((2.5066282746310005 * ser) / x);
};
const betacf = (x, a, b) => {
  const EPS = 3e-10, FPMIN = 1e-30;
  const qab = a + b, qap = a + 1, qam = a - 1;
  let c = 1, d = 1 - (qab * x) / qap;
  if (Math.abs(d) < FPMIN) d = FPMIN;
  d = 1 / d;
  let h = d;
  for (let m = 1; m <= 200; m++) {
    const m2 = 2 * m;
    let aa = (m * (b - m) * x) / ((qam + m2) * (a + m2));
    d = 1 + aa * d; if (Math.abs(d) < FPMIN) d = FPMIN;
    c = 1 + aa / c; if (Math.abs(c) < FPMIN) c = FPMIN;
    d = 1 / d; h *= d * c;
    aa = (-(a + m) * (qab + m) * x) / ((a + m2) * (qap + m2));
    d = 1 + aa * d; if (Math.abs(d) < FPMIN) d = FPMIN;
    c = 1 + aa / c; if (Math.abs(c) < FPMIN) c = FPMIN;
    d = 1 / d;
    const del = d * c;
    h *= del;
    if (Math.abs(del - 1) < EPS) break;
  }
  return h;
};
const betainc = (x, a, b) => {
  if (x <= 0) return 0;
  if (x >= 1) return 1;
  const bt = Math.exp(logGamma(a + b) - logGamma(a) - logGamma(b) + a * Math.log(x) + b * Math.log(1 - x));
  return x < (a + 1) / (a + b + 2) ? (bt * betacf(x, a, b)) / a : 1 - (bt * betacf(1 - x, b, a)) / b;
};
export const studentTP = (t, df) => {
  if (!Number.isFinite(t) || !(df > 0)) return 1;
  if (df > 1e4) return normP(t);
  return Math.max(0, Math.min(1, betainc(df / (df + t * t), df / 2, 0.5)));
};

/** Benjamini-Hochberg, in place: adds q to each row of `rows` from its p. */
export function fdr(rows) {
  const by = [...rows].sort((a, b) => a.p - b.p);
  by.forEach((x, i) => { x.q = Math.min(1, (x.p * by.length) / (i + 1)); });
  for (let i = by.length - 2; i >= 0; i--) by[i].q = Math.min(by[i].q, by[i + 1].q);
  return rows;
}

/**
 * Median normalisation across samples, which has to happen before any test when the whole panel has moved.
 *
 * Measured on ST004848 (methionine restriction): without it the panel median fold change is −0.94, a
 * two-fold shift of EVERYTHING, every one of the 71 metabolites comes out significant and no pathway can
 * stand out, because each one moves exactly like the panel. That shift is the amount of material that went
 * into the measurement, not biology.
 *
 * Each sample is scaled so that its median across metabolites equals the median of all samples. The scale
 * factor of every sample is returned, because this is a real assumption and not a formality: if the total
 * metabolite content genuinely fell, this removes a real effect along with the artefact. A factor far from 1
 * is worth showing to whoever reads the result.
 *
 * @returns { rows, factors: [{ side, i, factor }], panelMedianBefore }
 */
export function normaliseByMedian(rows) {
  const sides = ["a", "b"];
  const sampleMedians = [];
  for (const side of sides) {
    const n = Math.max(0, ...rows.map((r) => r[side].length));
    for (let i = 0; i < n; i++) {
      const col = rows.map((r) => r[side][i]).filter((x) => Number.isFinite(x) && x > 0);
      sampleMedians.push({ side, i, m: col.length ? median(col) : NaN });
    }
  }
  const good = sampleMedians.filter((x) => Number.isFinite(x.m) && x.m > 0);
  if (good.length < 2) return { rows, factors: [], panelMedianBefore: NaN };
  const target = median(good.map((x) => x.m));
  const factors = good.map((x) => ({ side: x.side, i: x.i, factor: target / x.m }));
  const out = rows.map((r) => {
    const o = { ...r };
    for (const side of sides) o[side] = r[side].map((v, i) => {
      const f = factors.find((x) => x.side === side && x.i === i);
      return f ? v * f.factor : v;
    });
    return o;
  });
  return { rows: out, factors, target };
}

/**
 * The contrast between two conditions, per metabolite.
 * Runs Welch's t-test with Welch-Satterthwaite degrees of freedom and exact Student-t p-values on log2
 * intensities (matching multiplicative MS variance; falls back to linear scale if any replicate is zero).
 * @param rows [{ label, bases: [base index], a: [values], b: [values] }] — a and b are the replicates of
 *        each condition in the quantity as measured (absolute or relative, it does not matter)
 * @returns { rows: [{ label, bases, log2fc, t, df, p, q, n }], panelMedian, nSignificant }
 *          panelMedian is the median log2 fold change of the whole panel: the baseline a class has to beat
 *          before it can be called biology rather than normalisation.
 */
export function contrast(rows, { alpha = 0.05 } = {}) {
  const out = [];
  for (const r of rows) {
    const a = r.a.filter(Number.isFinite), b = r.b.filter(Number.isFinite);
    if (!a.length || !b.length) continue;
    const ma = mean(a), mb = mean(b);
    if (!(ma > 0) || !(mb > 0)) continue; // a fold change needs both sides positive
    const allPos = a.every((x) => x > 0) && b.every((x) => x > 0);
    const xa = allPos ? a.map(Math.log2) : a, xb = allPos ? b.map(Math.log2) : b;
    const va = xa.length > 1 ? variance(xa) / xa.length : 0;
    const vb = xb.length > 1 ? variance(xb) / xb.length : 0;
    const se = Math.sqrt(va + vb);
    const t = se > 0 ? (mean(xa) - mean(xb)) / se : 0;
    const denom = (xa.length > 1 ? (va * va) / (xa.length - 1) : 0) + (xb.length > 1 ? (vb * vb) / (xb.length - 1) : 0);
    const df = denom > 0 ? ((va + vb) ** 2) / denom : Math.max(1, xa.length + xb.length - 2);
    const log2fc = allPos ? mean(xa) - mean(xb) : Math.log2(ma / mb);
    out.push({ label: r.label, bases: r.bases || [], log2fc, t, df, p: se > 0 ? studentTP(t, df) : 1, n: a.length + b.length });
  }
  fdr(out);
  return { rows: out, panelMedian: out.length ? median(out.map((x) => x.log2fc)) : 0,
    nSignificant: out.filter((x) => x.q < alpha).length };
}

/**
 * The change of a ratio between two metabolites, which is the only form a relative measurement supports.
 * @param pairs [[labelA, labelB, what]]  @param byLabel Map(label -> log2fc)
 */
export function ratioChanges(pairs, byLabel) {
  const out = [];
  for (const [a, b, what] of pairs) {
    if (!byLabel.has(a) || !byLabel.has(b)) continue;
    const d = byLabel.get(a) - byLabel.get(b);
    out.push({ a, b, what, dlog2: d, fold: 2 ** d });
  }
  return out;
}

// ---------------------------------------------------------------- the network ----
/**
 * The metabolite-level network the detectors run on: one entry per metabolic reaction, with its substrate
 * and product metabolites as model bases.
 *
 * Currency metabolites and the most connected hubs are left out of the GRAPH, because through ATP or water
 * everything is two steps from everything. They are not left out of the DATA: a measured hub still counts
 * in the reactions it takes part in (`inReaction`), it just does not act as a stepping stone.
 *
 * Transport reactions are dropped: with the compartments collapsed to one metabolite per compound, a
 * transport step has the same metabolite on both sides and cannot show a substrate/product pattern.
 */
export function metaboliteNetwork(model, layout, { hubs = 40 } = {}) {
  const B = (i) => model.mets[i].b;
  const currency = new Set((layout?.currency || []).map(B));
  const degree = new Map();
  for (const r of model.rxns) { if (r.removed) continue; for (const i of new Set(r.m.map(B))) degree.set(i, (degree.get(i) || 0) + 1); }
  for (const [b] of [...degree].sort((x, y) => y[1] - x[1]).slice(0, hubs)) currency.add(b);
  const reactions = [];
  model.rxns.forEach((r, j) => {
    if (r.removed || r.m.length < 2) return;
    const ss = model.subsystems[r.ss] || "";
    if (/transport|exchange|pool|biomass|artificial/i.test(ss) || /pool|biomass/i.test(r.n)) return;
    const sub = new Set(), prod = new Set(), all = new Set();
    r.m.forEach((i, k) => { const b = B(i); all.add(b); if (currency.has(b)) return; (r.c[k] < 0 ? sub : prod).add(b); });
    for (const b of [...sub]) if (prod.has(b)) { sub.delete(b); prod.delete(b); } // same compound both sides
    if (!sub.size || !prod.size) return;
    reactions.push({ rxn: j, id: r.id, name: r.n, ss, sub: [...sub], prod: [...prod], all: [...all],
      reversible: r.lb < 0 && r.ub > 0 });
  });
  const adj = new Map();
  const link = (a, b) => { if (a !== b) (adj.get(a) || adj.set(a, new Set()).get(a)).add(b); };
  for (const r of reactions) for (const a of r.sub) for (const b of r.prod) { link(a, b); link(b, a); }
  return { reactions, adj, degree, currency };
}

/**
 * What the panel can see: the reactions with a measured metabolite on both sides are the only ones a
 * substrate/product argument can be made about.
 */
export function observability(net, measuredBases) {
  const m = measuredBases instanceof Set ? measuredBases : new Set(measuredBases);
  const bothSides = net.reactions.filter((r) => r.sub.some((b) => m.has(b)) && r.prod.some((b) => m.has(b)));
  const oneSide = net.reactions.filter((r) => !bothSides.includes(r) && r.all.some((b) => m.has(b)));
  const pathways = new Map();
  for (const r of bothSides) pathways.set(r.ss, (pathways.get(r.ss) || 0) + 1);
  return { bothSides, nBothSides: bothSides.length, nOneSide: oneSide.length, pathways };
}

// ---------------------------------------------------------------- detectors ----
/**
 * Reactions whose measured substrates rose while their measured products fell: the pattern of a step that
 * stopped carrying flux.
 *
 * Direction handling: when a flux vector is supplied, each active reaction is oriented along its actual flux
 * direction (so a reversible reaction running backwards in the model is evaluated as P → S); without flux,
 * reversible reactions are tested in both directions so a block is not missed just because of how the model
 * wrote the equation.
 *
 * Three guards, each of which removes a whole class of false positive:
 *   · near equilibrium. A reversible reaction that simply ran the other way shows substrate up and product
 *     down in the reversed direction, which is indistinguishable from a block. When a free energy is given
 *     (thermo as [dG, uncertainty]) a reaction whose |dG| does not exceed its own uncertainty is reported
 *     with `couldBeReversal`, and reversibility in the model alone also raises it.
 *   · hubs. If pyruvate rises and one of its many products falls, the cause may be a competing branch, not
 *     this step. The score is damped by the connectivity of the metabolites involved.
 *   · isomers that the measurement cannot separate. A label standing for two metabolites (citrate|isocitrate)
 *     must not be used to argue about a reaction between them: `groups` marks those, and a reaction whose
 *     substrate and product fall in the same group is dropped.
 *
 * @param fcByBase Map(base -> log2fc), `qByBase` Map(base -> q)
 * @param opts { thermo: {id: [dG, sd]}, flux: Float64Array, groups: [Set of bases], minSupport = 1 }
 * @returns [{ rxn, id, name, ss, score, raw, subUp, prodDown, oppositeSigns, direction, support, couldBeReversal, carriesFlux }] best first
 */
export function bottlenecks(net, fcByBase, qByBase, opts = {}) {
  const { thermo = null, flux = null, groups = [], minSupport = 1, alpha = 0.05 } = opts;
  const sameGroup = (a, b) => groups.some((g) => g.has(a) && g.has(b));
  const out = [];
  for (const r of net.reactions) {
    let S = r.sub.filter((b) => fcByBase.has(b)), P = r.prod.filter((b) => fcByBase.has(b));
    if (!S.length || !P.length) continue;
    if (S.some((a) => P.some((b) => sameGroup(a, b)))) continue;
    const v = flux ? flux[r.rxn] : 0;
    const carriesFlux = flux ? Math.abs(v) > 1e-9 : null;
    let direction = 1;
    if (flux && v < -1e-9) { [S, P] = [P, S]; direction = -1; }
    let up = median(S.map((b) => fcByBase.get(b))), down = median(P.map((b) => fcByBase.get(b)));
    let raw = up - down;
    // when no flux direction fixes orientation, a reversible reaction written backwards can still be blocked
    if (!(raw > 0) && !carriesFlux && r.reversible && down - up > 0) {
      [S, P] = [P, S]; [up, down] = [down, up]; raw = up - down; direction = -1;
    }
    if (!(raw > 0)) continue; // not the pattern of a block
    const support = [...S, ...P].filter((b) => (qByBase.get(b) ?? 1) < alpha).length;
    if (support < minSupport) continue;
    // damp by how connected the metabolites are: a step between two hubs explains less
    const conn = mean([...S, ...P].map((b) => Math.log2(1 + (net.degree.get(b) || 1))));
    const score = raw / (1 + conn / 4);
    const dg = thermo?.[r.id];
    const nearEquilibrium = Array.isArray(dg) ? Math.abs(dg[0]) <= (dg[1] || 0) : null;
    out.push({ rxn: r.rxn, id: r.id, name: r.name, ss: r.ss, score, raw, subUp: up, prodDown: down,
      oppositeSigns: up > 0 && down < 0, direction, support,
      couldBeReversal: nearEquilibrium === true || (nearEquilibrium === null && r.reversible),
      nearEquilibrium, carriesFlux, measured: { sub: S, prod: P } });
  }
  out.sort((a, b) => b.score - a.score);
  return out;
}

/**
 * Pathways whose measured metabolites move together, against the rest of the panel (Mann-Whitney).
 *
 * What this is for, and what it is NOT for. It answers "has a whole class shifted?", which is the
 * global-against-local question: all the amino acids rising at once points at something general (less
 * protein synthesis, autophagy, uptake) and not at one enzyme. It does NOT locate an affected route, and
 * the validation says so plainly: on the methionine-restriction experiment, where the cause is known, the
 * methionine pathway ranks 9th of 13 here while the bottleneck detector puts the methionine cycle 3rd of
 * 74 (tools/validation/metcontrast_validate.mjs).
 *
 * The reason is structural, not a matter of tuning: in a blocked route the substrates rise and the products
 * fall, so the median of the route is near zero and a test built on that median is blind to exactly the
 * pattern worth finding. Use it for the global-or-local verdict, and the bottleneck detector to locate.
 *
 * The median of the pathway is reported next to the median of the whole panel, because a pathway that moves
 * by as much as everything else has not moved.
 */
export function pathwayShifts(net, contrastRows, { panelMedian = 0, minMetabolites = 4 } = {}) {
  const byBase = new Map();
  for (const r of contrastRows) for (const b of r.bases) byBase.set(b, r.log2fc);
  const inPathway = new Map();
  for (const r of net.reactions) for (const b of [...r.sub, ...r.prod]) {
    if (!byBase.has(b)) continue;
    (inPathway.get(r.ss) || inPathway.set(r.ss, new Set()).get(r.ss)).add(b);
  }
  const out = [];
  for (const [ss, set] of inPathway) {
    const inside = [...set].map((b) => byBase.get(b));
    if (inside.length < minMetabolites) continue;
    const outside = contrastRows.filter((r) => !r.bases.some((b) => set.has(b))).map((r) => r.log2fc);
    if (outside.length < minMetabolites) continue;
    out.push({ ss, n: inside.length, median: median(inside), vsPanel: median(inside) - panelMedian,
      p: mannWhitney(inside, outside) });
  }
  fdr(out);
  out.sort((a, b) => a.p - b.p);
  return out;
}

/** Mann-Whitney U with average ranks on ties and standard tie variance correction. */
export function mannWhitney(a, b) {
  const n1 = a.length, n2 = b.length, N = n1 + n2;
  if (!n1 || !n2) return 1;
  const all = [...a.map((v) => [v, 0]), ...b.map((v) => [v, 1])].sort((x, y) => x[0] - y[0]);
  let ra = 0, tieSum = 0;
  for (let i = 0; i < N; ) {
    let j = i + 1;
    while (j < N && all[j][0] === all[i][0]) j++;
    const avgRank = (i + 1 + j) / 2, t = j - i;
    if (t > 1) tieSum += t * t * t - t;
    for (let k = i; k < j; k++) if (all[k][1] === 0) ra += avgRank;
    i = j;
  }
  const u = ra - (n1 * (n1 + 1)) / 2;
  const mu = (n1 * n2) / 2;
  const varU = (n1 * n2 / 12) * (N + 1 - (N > 1 ? tieSum / (N * (N - 1)) : 0));
  return varU > 0 ? normP((u - mu) / Math.sqrt(varU)) : 1;
}

/**
 * The honest null: shuffle which replicate (whole sample) belongs to which condition, redo everything, and
 * see how often noise produces a hypothesis as good as the real one.
 *
 * One sample-index permutation is drawn per round and applied identically to EVERY metabolite row, so all
 * metabolites measured in the same sample move together. That preserves inter-metabolite correlations and
 * sample-wide normalisation shifts, which permuting each row independently would destroy.
 * @param make (rowsWithSwappedLabels) -> topScore
 * @returns { p, better, rounds, real } — p is the share of rounds whose best score reached the real one
 */
export function permutationNull(rows, make, { rounds = 200, seed = 12345 } = {}) {
  const real = make(rows);
  if (!rows.length) return { p: 1, better: 0, rounds: 0, real };
  const nA = rows[0].a.length, nB = rows[0].b.length, N = nA + nB;
  const uniform = rows.every((r) => r.a.length === nA && r.b.length === nB);
  let s = seed >>> 0;
  const rnd = () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
  let better = 0;
  for (let k = 0; k < rounds; k++) {
    let shuffled;
    if (uniform) {
      const idx = Array.from({ length: N }, (_, i) => i);
      for (let i = N - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [idx[i], idx[j]] = [idx[j], idx[i]]; }
      const ia = idx.slice(0, nA), ib = idx.slice(nA);
      shuffled = rows.map((r) => {
        const pool = [...r.a, ...r.b];
        return { ...r, a: ia.map((p) => pool[p]), b: ib.map((p) => pool[p]) };
      });
    } else {
      // ragged rows (fallback): permute using a shared deterministic order per row length
      shuffled = rows.map((r) => {
        const pool = [...r.a, ...r.b];
        for (let i = pool.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [pool[i], pool[j]] = [pool[j], pool[i]]; }
        return { ...r, a: pool.slice(0, r.a.length), b: pool.slice(r.a.length) };
      });
    }
    if (make(shuffled) >= real) better++;
  }
  return { p: (better + 1) / (rounds + 1), better, rounds, real };
}

const R_KJ = 8.314462618e-3; // kJ / (mol K)
const FIXED_ACTIVITY = /^(h2o|water|h\+|proton)$/i;

/**
 * Shift in reaction free energy from measured metabolite fold changes:
 *   Δ(ΔG') = direction · R T ln(2) Σ ν_k log2(FC_k)
 * Water and protons are excluded (fixed-activity aqueous convention) and net stoichiometry is summed per
 * base compound so compartment transfers cancel. Returns null when fewer than two reactants are measured.
 * A negative value means the driving force became stronger in the evaluated direction (substrates rose
 * relative to products — expected upstream of a blocked enzyme). Always marked `partial` if unmeasured
 * cofactors or reactants remain.
 * @param opts { T = 310.15, direction = 1 }
 * @returns { ddg, measured, total, partial } | null
 */
export function deltaDeltaG(model, rxnIdx, fcByBase, { T = 310.15, direction = 1 } = {}) {
  const r = model?.rxns?.[rxnIdx];
  if (!r || !r.m || r.m.length < 2) return null;
  const net = new Map();
  for (let k = 0; k < r.m.length; k++) {
    const b = model.mets[r.m[k]].b;
    const nm = (model.bases[b]?.n || "").trim();
    const fm = (model.bases[b]?.f || "").trim();
    if (FIXED_ACTIVITY.test(nm) || FIXED_ACTIVITY.test(fm)) continue;
    net.set(b, (net.get(b) || 0) + r.c[k]);
  }
  let total = 0, measured = 0, sum = 0;
  for (const [b, nu] of net) {
    if (Math.abs(nu) < 1e-12) continue;
    total++;
    const fc = fcByBase.get(b);
    if (Number.isFinite(fc)) {
      measured++;
      sum += nu * fc;
    }
  }
  if (measured < 2) return null;
  const ddg = (direction < 0 ? -1 : 1) * R_KJ * T * Math.LN2 * sum;
  return { ddg, measured, total, partial: measured < total };
}

