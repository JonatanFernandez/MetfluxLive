// Regulatory network hypothesis inference: connect signed TF -> enzyme regulons (CollecTRI / RegulonDB)
// to intracellular metabolomics and (optionally) differential RNA-seq.
//
// Two deliberately distinct modes, with explicit honesty about what each one can support:
//   · Mode A (metabolomics only): projects signed substrate/product patterns from observable reactions onto
//     their GPR genes, then runs a signed Univariate Linear Model (ULM, decoupleR-style) restricted strictly
//     to the observable metabolic gene universe. Weak/hypothesis-generating by nature because a metabolomics
//     panel covers only a fraction of enzymes and many metabolic shifts are non-transcriptional.
//   · Mode B (metabolomics + differential RNA-seq A vs B): estimates TF activity across the full genome from
//     RNA-seq via ULM, then checks causal 3-step concordance (TF -> enzyme mRNA -> observable reaction
//     substrate/product pattern) and separates transcriptional bottlenecks from post-transcriptional ones
//     (allosteric, PTM, mutation or substrate limitation).
//
// Pure ES module, zero DOM, zero solver dependencies.
import { fdr, studentTP } from "./metcontrast.js";
import { REDOX_PAIRS } from "./flows.js";
import { gprActivity } from "./gpr.js";

const mean = (a) => a.reduce((s, x) => s + x, 0) / a.length;
const median = (a) => { const s = [...a].sort((x, y) => x - y); const h = s.length >> 1; return s.length % 2 ? s[h] : (s[h - 1] + s[h]) / 2; };

// ---------------------------------------------------------------- GPR parsing ----
/**
 * Split a GPR string into top-level `or`-separated isoenzyme clauses and their `and`-subunit genes.
 * Returns Map<geneSymbol, weight> where:
 *   - redundant isoenzymes (`or`) split weight as 1 / nActiveBranches
 *   - complex subunits (`and`) share weight as 1 / sqrt(nSubunits) per active branch
 * When `offGenes` (Set of lowercase gene symbols/ids) is supplied, branches containing an off gene are
 * dropped if at least one active branch remains.
 */
export function gprGeneWeights(gpr, offGenes = null) {
  const weights = new Map();
  if (!gpr || !String(gpr).trim()) return weights;
  const s = String(gpr).trim();
  // Split on top-level `or` (outside parentheses)
  const branches = [];
  let depth = 0, cur = "";
  const tokens = s.match(/\(|\)|\band\b|\bor\b|[^\s()]+/gi) || [];
  for (const tok of tokens) {
    if (tok === "(") { depth++; cur += " ( "; }
    else if (tok === ")") { depth = Math.max(0, depth - 1); cur += " ) "; }
    else if (depth === 0 && tok.toLowerCase() === "or") {
      if (cur.trim()) branches.push(cur.trim());
      cur = "";
    } else cur += " " + tok;
  }
  if (cur.trim()) branches.push(cur.trim());

  const parsed = branches.map((br) => {
    const genes = [...new Set((br.match(/[^\s()]+/g) || []).filter((t) => !/^(and|or)$/i.test(t)))];
    const hasOff = offGenes ? genes.some((g) => offGenes.has(g.toLowerCase())) : false;
    return { genes, hasOff };
  }).filter((b) => b.genes.length > 0);
  if (!parsed.length) return weights;

  const active = parsed.some((b) => !b.hasOff) ? parsed.filter((b) => !b.hasOff) : parsed;
  const invB = 1 / active.length;
  for (const br of active) {
    const subW = invB / Math.sqrt(br.genes.length);
    for (const g of br.genes) weights.set(g, (weights.get(g) || 0) + subW);
  }
  return weights;
}

// ------------------------------------------------ metabolomics -> gene evidence ----
/**
 * Project signed substrate/product patterns of observable reactions onto their GPR genes.
 *
 * Sign convention (activity of the enzyme in condition A relative to condition B, matching `contrast()`):
 *   - substrates rose while products fell (up - down > 0): pattern of a blocked / reduced step -> NEGATIVE
 *   - substrates fell while products rose (up - down < 0): pattern of an activated step -> POSITIVE
 *
 * Only reactions with at least one measured substrate AND one measured product are included; genes whose
 * reactions are not observable on both sides are excluded from the background universe.
 */
export function reactionToGeneEvidence(model, net, fcByBase, qByBase, opts = {}) {
  const { thermo = null, flux = null, groups = [], offGenes = null, nearEqDamp = 0.35 } = opts;
  const sameGroup = (a, b) => groups.some((g) => g.has(a) && g.has(b));
  const rxnScore = new Map();
  const geneAccum = new Map(); // geneSym -> { num, den, rxns: [] }

  for (const r of net.reactions) {
    const mr = model.rxns[r.rxn];
    if (!mr || !mr.g) continue;
    let S = r.sub.filter((b) => fcByBase.has(b)), P = r.prod.filter((b) => fcByBase.has(b));
    if (!S.length || !P.length) continue;
    if (S.some((a) => P.some((b) => sameGroup(a, b)))) continue;

    const fluxVec = flux && typeof flux.length === "number" ? flux : flux?.v || null;
    const v = fluxVec ? fluxVec[r.rxn] : 0;
    let direction = 1;
    if (fluxVec && v < -1e-9) { [S, P] = [P, S]; direction = -1; }

    const up = median(S.map((b) => fcByBase.get(b)));
    const down = median(P.map((b) => fcByBase.get(b)));
    const diff = up - down; // > 0 means substrate accumulated relative to product (blocked/reduced)
    const conn = mean([...S, ...P].map((b) => Math.log2(1 + (net.degree.get(b) || 1))));
    const dg = thermo?.[r.id];
    const nearEquilibrium = Array.isArray(dg) ? Math.abs(dg[0]) <= (dg[1] || 0) : null;
    const couldBeReversal = nearEquilibrium === true || (nearEquilibrium === null && r.reversible);
    const damp = couldBeReversal ? nearEqDamp : 1;
    // Negative = reduced/blocked step; Positive = activated step
    const activity = (-diff / (1 + conn / 4)) * damp;

    const entry = {
      rxn: r.rxn, id: r.id, name: r.name, ss: r.ss, activity, diff, subFc: up, prodFc: down,
      direction, couldBeReversal, measured: { sub: S, prod: P },
    };
    rxnScore.set(r.rxn, entry);

    const gw = gprGeneWeights(mr.g, offGenes);
    for (const [g, w] of gw) {
      let acc = geneAccum.get(g);
      if (!acc) geneAccum.set(g, (acc = { num: 0, den: 0, rxns: [] }));
      acc.num += w * activity;
      acc.den += w;
      acc.rxns.push({ ...entry, weight: w });
    }
  }

  const geneScore = new Map(), geneRxns = new Map();
  for (const [g, acc] of geneAccum) {
    geneScore.set(g, acc.den > 0 ? acc.num / acc.den : 0);
    acc.rxns.sort((a, b) => Math.abs(b.activity * b.weight) - Math.abs(a.activity * a.weight));
    geneRxns.set(g, acc.rxns);
  }
  return { geneScore, geneRxns, observableGenes: new Set(geneScore.keys()), rxnScore };
}

// ------------------------------------------------ Univariate Linear Model (ULM) ----
/**
 * Fast exact Univariate Linear Model (decoupleR ULM) for signed TF activity estimation.
 *
 * For each TF t, forms the signed target vector x ∈ {-1, 0, +1}^N over the measured/observable gene
 * universe U (size N), regresses the gene-level statistic y onto x, and computes the exact OLS slope
 * t-statistic and two-sided Student-t p-value with df = N - 2, followed by BH FDR.
 * Runs in O(|T ∩ U|) per TF using sparse sufficient statistics.
 *
 * @param regulons parsed data/<slug>/regulons.json ({ nMet, genes, tfs })
 * @param valueByGene Map<geneSymbol, number> (matched case-insensitively)
 * @param opts { minTargets = 3, metabolicOnly = false }
 * @returns sorted array of { tf, score, r, p, q, nObs, nTotal, coverage, dir, targets }
 */
export function ulm(regulons, valueByGene, { minTargets = 3, metabolicOnly = false } = {}) {
  if (!regulons?.tfs?.length || !valueByGene?.size) return [];
  const limit = metabolicOnly ? regulons.nMet : regulons.genes.length;
  // Build case-insensitive lookup of supplied gene values
  const valLow = new Map();
  for (const [g, v] of valueByGene) {
    if (Number.isFinite(v)) valLow.set(String(g).trim().toLowerCase(), v);
  }
  // Map regulon gene index -> y value (only for genes present in valueByGene)
  const yByIdx = new Map();
  let sumY = 0, sumY2 = 0;
  for (let i = 0; i < limit; i++) {
    const v = valLow.get(regulons.genes[i].toLowerCase());
    if (v !== undefined) {
      yByIdx.set(i, v);
      sumY += v;
      sumY2 += v * v;
    }
  }
  const N = yByIdx.size;
  if (N < minTargets + 3) return [];
  const meanY = sumY / N;
  const syy = sumY2 - N * meanY * meanY;
  if (!(syy > 1e-18)) return [];

  const df = N - 2;
  const out = [];
  for (const [tf, flat] of regulons.tfs) {
    let nTotal = 0, nObs = 0, sumX = 0, sumXY = 0;
    const targets = [];
    for (let k = 0; k < flat.length; k += 2) {
      const gi = flat[k], w = flat[k + 1];
      if (gi >= limit) continue;
      nTotal++;
      const y = yByIdx.get(gi);
      if (y === undefined) continue;
      nObs++;
      sumX += w;
      sumXY += w * y;
      targets.push({ gene: regulons.genes[gi], sign: w, value: y });
    }
    if (nObs < minTargets || nObs >= N - 2) continue;
    const meanX = sumX / N;
    const sxx = nObs - N * meanX * meanX; // w^2 = 1 for all observed targets
    if (!(sxx > 1e-15)) continue;
    const sxy = sumXY - N * meanX * meanY;
    const r = Math.max(-1, Math.min(1, sxy / Math.sqrt(sxx * syy)));
    const denom = Math.max(1e-15, 1 - r * r);
    const t = r * Math.sqrt(df / denom);
    const p = studentTP(t, df);
    targets.sort((a, b) => Math.abs(b.value) - Math.abs(a.value));
    out.push({
      tf, score: t, r, p, q: 1, nObs, nTotal,
      coverage: nTotal > 0 ? nObs / nTotal : 0,
      dir: t >= 0 ? 1 : -1,
      targets,
    });
  }
  fdr(out);
  out.sort((a, b) => Math.abs(b.score) - Math.abs(a.score));
  return out;
}

// ------------------------------------------------ Mode A: metabolomics only ----
/**
 * Infer candidate transcriptional regulators from intracellular metabolomics alone.
 * Restricted strictly to the observable metabolic gene universe.
 */
export function inferRegulatorsMetab(model, net, regulons, fcByBase, qByBase, opts = {}) {
  const { minTargets = 3 } = opts;
  const evidence = reactionToGeneEvidence(model, net, fcByBase, qByBase, opts);
  const tfs = ulm(regulons, evidence.geneScore, { minTargets, metabolicOnly: true });
  return {
    tfs,
    evidence,
    nObservableGenes: evidence.observableGenes.size,
    nObservableRxns: evidence.rxnScore.size,
  };
}

// ------------------------------------------ Mode B: metabolomics + RNA-seq ----
/**
 * Parse a differential RNA-seq table (TSV/CSV) with columns for gene, log2FC, and optional stat/padj.
 * @returns { map: Map<gene, { gene, log2fc, stat, q }>, warnings: string[] }
 */
export function parseRnaDiffTable(text) {
  const warnings = [];
  const lines = String(text || "").replace(/^\uFEFF/, "").split(/\r?\n/).filter((l) => l.trim());
  if (lines.length < 2) return { map: new Map(), warnings: ["RNA-seq table has no data rows"] };
  const sep = (lines[0].match(/\t/g) || []).length >= (lines[0].match(/,/g) || []).length ? "\t" : ",";
  const cut = (l) => l.split(sep).map((x) => x.trim().replace(/^"(.*)"$/, "$1"));
  const head = cut(lines[0]).map((h) => h.toLowerCase());

  const findCol = (re, fallback = -1) => {
    const i = head.findIndex((h) => re.test(h));
    return i >= 0 ? i : fallback;
  };
  const iGene = findCol(/^(gene|symbol|gene_?name|gene_?id|locus|id)$/, 0);
  const iFc = findCol(/^(log2?_?fc|log2foldchange|logfc|lfc|fc)$/, 1);
  const iStat = findCol(/^(stat|t|t_?stat|wald|z|score)$/);
  const iQ = findCol(/^(padj|fdr|adj\.?p|q_?val|q)$/);

  const map = new Map();
  for (let i = 1; i < lines.length; i++) {
    const c = cut(lines[i]);
    const gene = c[iGene];
    const log2fc = Number(c[iFc]);
    if (!gene || !Number.isFinite(log2fc)) continue;
    const stat = iStat >= 0 && Number.isFinite(Number(c[iStat])) ? Number(c[iStat]) : log2fc;
    const q = iQ >= 0 && Number.isFinite(Number(c[iQ])) ? Number(c[iQ]) : NaN;
    const key = gene.toLowerCase();
    if (!map.has(key)) map.set(key, { gene, log2fc, stat, q });
  }
  return { map, warnings };
}

/**
 * Multi-omic inference combining genome-wide differential RNA-seq (A vs B) with intracellular metabolomics.
 *
 * 1. Runs ULM on genome-wide RNA-seq -> strong TF activity estimate `zRna`.
 * 2. Projects metabolomics onto observable metabolic genes -> `zMet` and per-gene reaction evidence.
 * 3. Traces explicit 3-step causal chains: TF --(w)--> enzyme mRNA (log2FC) -> observable reaction (activity).
 *    Counts concordant vs discordant chains and computes a combined multi-omic score.
 * 4. Classifies each candidate metabolic bottleneck step as transcriptional vs post-transcriptional.
 *
 * 5. If a flux CHANGE is supplied, compares it with what the regulator predicts for each enzyme. This is the
 *    axis that answers "the transcriptome says this step should slow down, does the flux agree?", and it is
 *    the one place where the two omics can contradict each other at the level of the reaction itself.
 *
 * @param rnaByGene Map<geneLowerOrSym, { gene?, log2fc, stat?, q? }> | Map<gene, number>
 * @param opts.flux { v, vRef, source } two flux vectors to compare and where they come from:
 *        "fitted"    -- both ends constrained by measured exchange rates (exometabolomics). Independent of
 *                       the transcriptome, so a joint test is legitimate.
 *        "contrast"  -- an A/B the user built. Independent only insofar as its constraints are measured.
 *        "predicted" -- the model's own choice. NOT independent evidence: the agreement would largely be the
 *                       model agreeing with itself, so the joint test refuses to report a p-value.
 */
/**
 * The contiguous routes inside a set of reactions.
 *
 * Two reactions belong to the same route when they share a metabolite that is not a currency metabolite.
 * Without that exclusion everything joins to everything through ATP and the answer is always "one route",
 * which says nothing. With it, the question becomes worth asking: do a regulator's targets form a stretch of
 * metabolism, or are they scattered across it? A scattered regulon is a real finding, not a failure -- it
 * says the regulator acts broadly rather than on a pathway.
 *
 * @param rxns     iterable of reaction indices
 * @param model    the model
 * @param currency index.currency, truthy per metabolite BASE for the carriers to ignore
 * @param minSize  routes shorter than this are returned as "scattered" instead
 * @returns { routes: [[rxnIdx,...]], scattered: [rxnIdx,...], shared: Map<rxnIdx, Set<metIdx>> }
 */
export function regulonRoutes(rxns, model, currency, minSize = 2) {
  const set = [...rxns].filter((j) => model.rxns[j] && !model.rxns[j].removed);
  const byMet = new Map();
  for (const j of set) {
    for (const m of model.rxns[j].m) {
      if (currency && currency[model.mets[m].b]) continue;
      if (!byMet.has(m)) byMet.set(m, []);
      byMet.get(m).push(j);
    }
  }
  // union-find over the reactions, joined through the metabolites they share
  const parent = new Map(set.map((j) => [j, j]));
  const find = (x) => { while (parent.get(x) !== x) { parent.set(x, parent.get(parent.get(x))); x = parent.get(x); } return x; };
  const union = (a, b) => { const ra = find(a), rb = find(b); if (ra !== rb) parent.set(ra, rb); };
  const shared = new Map();
  for (const [m, js] of byMet) {
    if (js.length < 2) continue;                     // a metabolite only this reaction touches joins nothing
    for (let i = 1; i < js.length; i++) union(js[0], js[i]);
    for (const j of js) { if (!shared.has(j)) shared.set(j, new Set()); shared.get(j).add(m); }
  }
  const groups = new Map();
  for (const j of set) { const r = find(j); if (!groups.has(r)) groups.set(r, []); groups.get(r).push(j); }
  const routes = [], scattered = [];
  for (const g of groups.values()) (g.length >= minSize ? routes : scattered).push(...(g.length >= minSize ? [g] : g));
  routes.sort((a, b) => b.length - a.length);
  return { routes, scattered, shared };
}

/**
 * Is it surprising that THIS regulator's enzymes move in the transcriptome AND that their reactions move in
 * the flux the same way?
 *
 * The statistic is: among the regulon's enzymes whose mRNA moved AND whose reactions moved, how many move
 * the SAME way in both. The null draws sets of the same size from every gene that could have been asked the
 * same question -- mRNA moved, reactions moved -- so regulon size cannot help, and neither can a gene being
 * well annotated, because the pool is the observed genes rather than the regulon's.
 *
 * Both sides must be conditioned the same way. The first version of this test was not: the observed count
 * was already restricted to genes whose mRNA agreed with the regulator, while the null also had to get the
 * mRNA right by chance. That mismatch of denominators made random flux significant in 15 of 40 trials.
 *
 * It refuses to answer when the flux is the model's own prediction. There the flux change is produced by the
 * same network the regulon is drawn on, so agreement is largely the model agreeing with itself; multiplying
 * that by the transcriptome would manufacture significance. Only a flux fitted to measured exchange rates is
 * independent of the transcriptome.
 *
 * @returns { p, observed, n, reason } -- p is null when the question cannot be asked honestly.
 */
export function jointFluxTest(entry, result, rounds = 2000, rng = Math.random) {
  if (!result?.flux) return { p: null, reason: "noFlux" };
  if (!result.flux.independent) return { p: null, reason: "fluxNotIndependent", source: result.flux.source };

  // the regulon's testable enzymes: mRNA moved as the regulator predicts, and the reactions moved at all
  const testable = entry.metGenes.filter((g) => g.fluxAgree === 1 || g.fluxAgree === -1);
  const obs = testable.filter((g) => g.fluxAgree === 1).length;
  if (testable.length < 3) return { p: null, reason: "tooFew", n: testable.length };

  // the pool: every observed gene that could have been asked the same question
  const pool = result._jointPool || [];
  if (pool.length < testable.length * 3) return { p: null, reason: "poolTooSmall", n: pool.length };

  let ge = 0;
  for (let r = 0; r < rounds; r++) {
    let hit = 0;
    for (let k = 0; k < testable.length; k++) {
      const pick = pool[(rng() * pool.length) | 0];
      if (pick.agree) hit++;          // did that gene's flux move the way its own mRNA did?
    }
    if (hit >= obs) ge++;
  }
  return { p: (ge + 1) / (rounds + 1), observed: obs, n: testable.length, reason: null };
}

export function inferRegulatorsMultiOmic(model, net, regulons, fcByBase, qByBase, rnaByGene, opts = {}) {
  const {
    minTargetsRna = 5,
    minTargetsMet = 3,
    rnaFcMin = 0.35,
    metActMin = 0.15,
    bottleneckSteps = [],
    flux = null,
    fluxMin = 0.1,          // a reaction counts as changed when it moves this fraction of its larger end
  } = opts;

  // How much each reaction's throughput moved, and which way. Magnitudes, because "carries more or less"
  // is the question; a reaction that reverses is a different phenomenon and is reported separately.
  const fluxDelta = new Map();
  let nFluxChanged = 0, nReversed = 0;
  if (flux?.v && flux?.vRef) {
    for (let j = 0; j < flux.v.length; j++) {
      const a = flux.vRef[j] || 0, b = flux.v[j] || 0;
      const scale = Math.max(Math.abs(a), Math.abs(b));
      if (scale < 1e-9) continue;
      const rel = (Math.abs(b) - Math.abs(a)) / scale;
      const reversed = a * b < 0 && Math.min(Math.abs(a), Math.abs(b)) > 1e-9;
      if (reversed) nReversed++;
      if (Math.abs(rel) >= fluxMin) { fluxDelta.set(j, { rel, dir: Math.sign(rel), reversed }); nFluxChanged++; }
      else fluxDelta.set(j, { rel, dir: 0, reversed });
    }
  }
  /** Which way a gene's reactions moved, weighted by how much each one moved. */
  const geneFluxDir = (rxns) => {
    let w = 0, n = 0;
    for (const j of rxns) { const d = fluxDelta.get(j); if (!d) continue; w += d.rel; n++; }
    if (!n || Math.abs(w / n) < fluxMin) return 0;
    return Math.sign(w);
  };

  // Normalise RNA map to lowercase key -> { gene, log2fc, stat, q }
  const rnaNorm = new Map();
  const rnaStatMap = new Map();
  for (const [k, v] of rnaByGene) {
    const obj = typeof v === "number" ? { gene: k, log2fc: v, stat: v, q: NaN } : { gene: v.gene || k, log2fc: v.log2fc, stat: v.stat ?? v.log2fc, q: v.q ?? NaN };
    if (!Number.isFinite(obj.log2fc)) continue;
    rnaNorm.set(String(k).trim().toLowerCase(), obj);
    rnaStatMap.set(obj.gene, Number.isFinite(obj.stat) ? obj.stat : obj.log2fc);
  }

  // Build geneLower -> GEM reaction indices lookup from model GPRs
  const rxnsByGene = new Map();
  if (model?.rxns) {
    model.rxns.forEach((r, j) => {
      if (r.removed || !r.g) return;
      for (const g of gprGeneWeights(r.g, opts.offGenes).keys()) {
        const k = g.toLowerCase();
        (rxnsByGene.get(k) || rxnsByGene.set(k, []).get(k)).push(j);
      }
    });
  }

  // 1. Genome-wide RNA-seq TF activity via ULM
  const rnaTFs = ulm(regulons, rnaStatMap, { minTargets: minTargetsRna, metabolicOnly: false });
  // 2. Optional metabolomics-side gene evidence and metabolic ULM
  const hasMet = !!(fcByBase && fcByBase.size && net);
  const metFluxVec = opts.fluxVec || (flux && typeof flux.length === "number" ? flux : flux?.v || null);
  const evidence = hasMet
    ? reactionToGeneEvidence(model, net, fcByBase, qByBase || new Map(), { ...opts, flux: metFluxVec })
    : { geneScore: new Map(), geneRxns: new Map(), observableGenes: new Set(), rxnScore: new Map() };
  const metTFs = hasMet ? ulm(regulons, evidence.geneScore, { minTargets: minTargetsMet, metabolicOnly: true }) : [];
  const metByTf = new Map(metTFs.map((x) => [x.tf, x]));
  const metGeneLow = new Map([...evidence.geneScore].map(([g, v]) => [g.toLowerCase(), { gene: g, score: v, rxns: evidence.geneRxns.get(g) || [] }]));

  // Build lookup of metabolic targets per TF from regulons.json
  const metTargetsByTf = new Map();
  for (const [tf, flat] of regulons.tfs) {
    const arr = [];
    for (let k = 0; k < flat.length; k += 2) {
      if (flat[k] < regulons.nMet) arr.push({ gene: regulons.genes[flat[k]], sign: flat[k + 1] });
    }
    metTargetsByTf.set(tf, arr);
  }

  // 3. Combine RNA TF activity with metabolic targets, GEM reactions, and 3-step causal chains
  const combined = rnaTFs.map((rt) => {
    const mt = metByTf.get(rt.tf) || null;
    const tfDir = rt.score >= 0 ? 1 : -1;
    const concordant = [], rnaOnly = [], discordant = [], metGenes = [];
    const metRxns = new Set();
    // Which way each reaction is pushed, kept per reaction rather than collapsed into the set: a target's
    // enzyme is expected to move in direction tfDir*sign, so a reaction inherits that. A reaction catalysed
    // by targets that disagree (an activated and a repressed subunit) is marked 0 -- "regulated, direction
    // unclear" -- which is honest and is what the map draws differently.
    const metRxnDir = new Map();
    const rxnDrivers = new Map();   // rxn -> [{ gene, regSign, expected }], what the sidebar lists
    const allMetTargets = metTargetsByTf.get(rt.tf) || [];
    for (const { gene, sign } of allMetTargets) {
      const k = gene.toLowerCase();
      const rxns = rxnsByGene.get(k) || [];
      for (const j of rxns) {
        metRxns.add(j);
        const d = tfDir * sign;
        metRxnDir.set(j, metRxnDir.has(j) && metRxnDir.get(j) !== d ? 0 : d);
        if (!rxnDrivers.has(j)) rxnDrivers.set(j, []);
        rxnDrivers.get(j).push({ gene, regSign: sign, expected: d });
      }
      const rna = rnaNorm.get(k);
      const met = metGeneLow.get(k);
      const expected = tfDir * sign; // expected direction of enzyme mRNA & activity
      const rnaHit = rna && Math.abs(rna.log2fc) >= rnaFcMin ? Math.sign(rna.log2fc) : 0;
      if (rna && rnaHit === expected) {
        const fDir = fluxDelta.size ? geneFluxDir(rxns) : null;
        metGenes.push({
          gene, regSign: sign, expected, log2fc: rna.log2fc, q: rna.q, rxns,
          // null = no flux change supplied; 0 = the step did not move; otherwise agree / disagree
          fluxDir: fDir,
          fluxAgree: fDir === null ? null : fDir === 0 ? 0 : (fDir === expected ? 1 : -1),
        });
      }
      if (!met) continue;
      const metHit = Math.abs(met.score) >= metActMin ? Math.sign(met.score) : 0;
      const topRxn = met.rxns[0] || null;
      const chain = {
        gene, regSign: sign, expected,
        rnaLog2fc: rna ? rna.log2fc : NaN,
        metScore: met.score,
        rxn: topRxn ? { rxn: topRxn.rxn, id: topRxn.id, name: topRxn.name, ss: topRxn.ss } : null,
      };
      if (rnaHit === expected && metHit === expected) concordant.push(chain);
      else if (rnaHit === expected && metHit === -expected) discordant.push(chain);
      else if (rnaHit === expected) rnaOnly.push(chain);
    }
    metGenes.sort((a, b) => Math.abs(b.log2fc) - Math.abs(a.log2fc));
    // Same-sign Stouffer boost from metabolomics ULM when both omics agree
    const zRna = rt.score;
    const zMet = mt ? mt.score : 0;
    const sameSign = mt && Math.sign(zRna) === Math.sign(zMet);
    const combinedScore = sameSign
      ? Math.sign(zRna) * ((Math.abs(zRna) + Math.abs(zMet)) / Math.SQRT2)
      : zRna;
    return {
      tf: rt.tf,
      dir: tfDir,
      zRna, pRna: rt.p, qRna: rt.q, nObsRna: rt.nObs, nTotalRna: rt.nTotal,
      zMet: mt ? mt.score : NaN, pMet: mt ? mt.p : NaN, qMet: mt ? mt.q : NaN, nObsMet: mt ? mt.nObs : 0,
      combinedScore,
      nMetTargets: allMetTargets.length,
      metGenes,
      metRxns,
      metRxnDir,
      rxnDrivers,
      concordant,
      rnaOnly,
      discordant,
      // the flux axis, per TF: how many of its RNA-confirmed enzymes move the way it predicts
      fluxAgree: metGenes.filter((g) => g.fluxAgree === 1).length,
      fluxDisagree: metGenes.filter((g) => g.fluxAgree === -1).length,
      fluxIdle: metGenes.filter((g) => g.fluxAgree === 0).length,
    };
  });
  combined.sort((a, b) => Math.abs(b.combinedScore) - Math.abs(a.combinedScore));

  // 4. Classify candidate metabolic bottlenecks: transcriptional vs post-transcriptional
  const topTfByGene = new Map();
  for (const t of combined.slice(0, 30)) {
    if (!(t.qRna < 0.1 || Math.abs(t.zRna) >= 2)) continue;
    for (const mg of t.metGenes) {
      if (mg.expected >= 0) continue; // only TFs whose activity predicts enzyme downregulation explain a block
      const k = mg.gene.toLowerCase();
      (topTfByGene.get(k) || topTfByGene.set(k, []).get(k)).push({ tf: t.tf, dir: t.dir, regSign: mg.regSign, zRna: t.zRna });
    }
  }

  const classifiedSteps = bottleneckSteps.map((b) => {
    const mr = model.rxns[b.rxn];
    const gw = mr?.g ? gprGeneWeights(mr.g, opts.offGenes) : new Map();
    const genes = [];
    for (const [g, w] of gw) {
      const rna = rnaNorm.get(g.toLowerCase());
      if (rna) genes.push({ gene: g, weight: w, log2fc: rna.log2fc, q: rna.q, tfs: topTfByGene.get(g.toLowerCase()) || [] });
    }
    genes.sort((a, b2) => a.log2fc - b2.log2fc); // most downregulated first (explains a block)
    let mechanism = "unmeasuredRna";
    if (genes.length) {
      const anyDown = genes.some((g) => g.log2fc <= -rnaFcMin);
      mechanism = anyDown ? "transcriptional" : "postTranscriptional";
    }
    return { ...b, mechanism, rnaGenes: genes };
  });

  // Every gene the transcriptome saw move, whose reactions also moved: the population the regulon's
  // enzymes are a sample of. `agree` is the same question the statistic asks of the regulon.
  const jointPool = [];
  if (fluxDelta.size) {
    for (const [k, info] of rnaNorm) {
      if (!(Math.abs(info.log2fc) >= rnaFcMin)) continue;
      const rxns = rxnsByGene.get(k);
      if (!rxns?.length) continue;
      const fd = geneFluxDir(rxns);
      if (!fd) continue;
      jointPool.push({ agree: fd === Math.sign(info.log2fc) });
    }
  }

  return {
    flux: flux ? { source: flux.source || "predicted", nChanged: nFluxChanged, nReversed, independent: flux.source === "fitted" } : null,
    _jointPool: jointPool,           // for jointFluxTest's null; not part of the displayed result
    tfs: combined,
    metOnlyTFs: metTFs,
    evidence,
    classifiedSteps,
    hasMet,
    nRnaGenes: rnaNorm.size,
    nObservableGenes: evidence.observableGenes.size,
    nObservableRxns: evidence.rxnScore.size,
  };
}

/**
 * Project differential RNA-seq directly onto the GEM's reactions, GPR isoenzymes, and pathways.
 *
 * Gives the map and sidebar everything differential transcriptomics can say about metabolism beyond TF scores:
 *  - `fcByRxn`: reaction-level log2FC (GPR-weighted) for colouring reaction diamonds on the map,
 *  - `sigRxns`: reactions with significant transcriptional shift (q < 0.05, or |log2FC| >= 1 when q is absent),
 *  - `isoRxns` & `isoSwitches`: reactions where alternative OR-branch isoenzymes move in opposite directions
 *    (e.g. LDHA up while LDHB drops, HK2 up while HK1 drops) — a regulatory switch TF summaries often hide,
 *  - `pathways` & `pathwayBySs`: per-subsystem transcriptional shifts (median/mean log2FC, up/down counts),
 *  - `tfsByGene`: active TFs (|t| >= 2 or q < 0.05) regulating each metabolic gene, for reaction cards.
 */
export function summarizeRnaOnModel(model, rnaByGene, regResult = null, opts = {}) {
  const { offGenes = null, rnaFcMin = 0.35, isoMin = 0.5 } = opts;
  const rnaNorm = new Map();
  let anyQ = false;
  if (rnaByGene) {
    for (const [k, v] of rnaByGene) {
      const obj = typeof v === "number"
        ? { gene: k, log2fc: v, stat: v, q: NaN }
        : { gene: v.gene || k, log2fc: v.log2fc, stat: v.stat ?? v.log2fc, q: v.q ?? NaN };
      if (!Number.isFinite(obj.log2fc)) continue;
      if (Number.isFinite(obj.q)) anyQ = true;
      rnaNorm.set(String(k).trim().toLowerCase(), obj);
    }
  }

  const fcByRxn = new Map();
  const sigRxns = new Set();
  const isoRxns = new Set();
  const rxnInfo = new Map();
  const isoSwitches = [];
  const ssBucket = new Map(); // ss -> { fcs: [], nUp, nDown }

  if (model?.rxns && rnaNorm.size) {
    model.rxns.forEach((r, j) => {
      if (r.removed || !r.g) return;
      const gw = gprGeneWeights(r.g, offGenes);
      if (!gw.size) return;
      let num = 0, den = 0, minQ = Infinity;
      const genes = [];
      for (const [g, w] of gw) {
        const info = rnaNorm.get(g.toLowerCase());
        if (!info) continue;
        num += w * info.log2fc;
        den += w;
        if (Number.isFinite(info.q) && info.q < minQ) minQ = info.q;
        genes.push({ gene: g, log2fc: info.log2fc, stat: info.stat, q: info.q, weight: w });
      }
      if (!genes.length || !(den > 0)) return;
      genes.sort((a, b) => Math.abs(b.log2fc) - Math.abs(a.log2fc));
      const fc = num / den;
      const sig = Number.isFinite(minQ) ? minQ < 0.05 : (!anyQ && Math.abs(fc) >= 1.0);

      // Detect true OR-branch isoenzyme switches: one branch rises >= isoMin while another drops <= -isoMin
      const branches = r.g.split(/\bor\b/i).map((b) => [...new Set(b.replace(/[()]/g, " ").split(/\band\b/i).map((x) => x.trim()).filter(Boolean))]).filter((b) => b.length);
      let iso = null;
      if (branches.length >= 2) {
        let bestUp = null, bestDown = null;
        for (const br of branches) {
          const vals = br.map((g) => ({ g, info: rnaNorm.get(g.toLowerCase()) })).filter((x) => x.info);
          if (!vals.length) continue;
          const bFc = mean(vals.map((x) => x.info.log2fc));
          const lead = vals.slice().sort((a, b) => Math.abs(b.info.log2fc) - Math.abs(a.info.log2fc))[0];
          if (bFc >= isoMin && (!bestUp || bFc > bestUp.fc)) bestUp = { fc: bFc, gene: lead.g, q: lead.info.q };
          if (bFc <= -isoMin && (!bestDown || bFc < bestDown.fc)) bestDown = { fc: bFc, gene: lead.g, q: lead.info.q };
        }
        if (bestUp && bestDown && bestUp.gene.toLowerCase() !== bestDown.gene.toLowerCase()) {
          iso = { rxn: j, id: r.id, name: r.n || r.id, ss: r.ss, up: bestUp, down: bestDown, span: bestUp.fc - bestDown.fc };
          isoRxns.add(j);
          isoSwitches.push(iso);
        }
      }

      fcByRxn.set(j, fc);
      if (sig) sigRxns.add(j);
      rxnInfo.set(j, { fc, q: Number.isFinite(minQ) ? minQ : NaN, sig, genes, iso });

      if (r.ss >= 0) {
        let b = ssBucket.get(r.ss);
        if (!b) ssBucket.set(r.ss, (b = { fcs: [], nUp: 0, nDown: 0 }));
        b.fcs.push(fc);
        if (fc >= rnaFcMin) b.nUp++;
        else if (fc <= -rnaFcMin) b.nDown++;
      }
    });
  }

  isoSwitches.sort((a, b) => b.span - a.span);

  const pathways = [];
  const pathwayBySs = new Map();
  for (const [ss, b] of ssBucket) {
    const meanFc = mean(b.fcs);
    const medianFc = median(b.fcs);
    const entry = {
      ss,
      name: model.subsystems?.[ss] || "",
      nRxns: b.fcs.length,
      nUp: b.nUp,
      nDown: b.nDown,
      meanFc,
      medianFc,
      score: Math.abs(meanFc) * Math.sqrt(b.fcs.length),
    };
    pathwayBySs.set(ss, entry);
    if (b.fcs.length >= 3) pathways.push(entry);
  }
  pathways.sort((a, b) => b.score - a.score);

  // Active regulating TFs per metabolic gene (for reaction cards)
  const tfsByGene = new Map();
  if (regResult?.tfs?.length) {
    for (const tf of regResult.tfs.slice(0, 40)) {
      if (!(tf.qRna < 0.05 || Math.abs(tf.zRna) >= 2)) continue;
      for (const mg of tf.metGenes || []) {
        const k = mg.gene.toLowerCase();
        const arr = tfsByGene.get(k) || tfsByGene.set(k, []).get(k);
        if (!arr.some((x) => x.tf === tf.tf)) {
          arr.push({ tf: tf.tf, regSign: mg.regSign, expected: mg.expected, zRna: tf.zRna, qRna: tf.qRna });
        }
      }
    }
  }

  return {
    nMeasuredRxns: fcByRxn.size,
    fcByRxn,
    sigRxns,
    isoRxns,
    rxnInfo,
    isoSwitches,
    pathways,
    pathwayBySs,
    tfsByGene,
  };
}

/**
 * Summarise where differential RNA-seq converges with or contradicts FBA flux and intracellular metabolomics:
 *  - `inducedIdle`: strongly induced enzymes (log2FC >= 0.75) sitting on zero-flux reactions in the current model,
 *  - `postTx`: candidate metabolomics bottlenecks whose enzymes did not drop in mRNA (post-transcriptional/allosteric),
 *  - `concordant`: reactions where mRNA and either flux change or metabolomics activity agree in direction.
 */
export function computeMultiOmicDiscrepancies(model, rnaSummary, { v = null, vRef = null, regResult = null } = {}) {
  const inducedIdle = [];
  const concordant = [];
  if (rnaSummary?.rxnInfo?.size && model?.rxns) {
    const evRxn = regResult?.evidence?.rxnScore || null;
    for (const [j, info] of rnaSummary.rxnInfo) {
      const r = model.rxns[j];
      if (!r || r.removed) continue;
      const curV = v ? Math.abs(v[j] || 0) : 0;
      if (v && info.fc >= 0.75 && curV <= 1e-9) {
        inducedIdle.push({ rxn: j, name: r.n || r.id, ss: r.ss, fc: info.fc, q: info.q, gene: info.genes[0]?.gene || "" });
      }
      if (Math.abs(info.fc) >= 0.5) {
        let fluxDir = 0;
        if (v && vRef) {
          const a = Math.abs(vRef[j] || 0), b = Math.abs(v[j] || 0), sc = Math.max(a, b);
          if (sc > 1e-9 && Math.abs(b - a) / sc >= 0.1) fluxDir = Math.sign(b - a);
        }
        const metAct = evRxn?.get(j)?.activity || 0;
        const metDir = Math.abs(metAct) >= 0.15 ? Math.sign(metAct) : 0;
        const rnaDir = Math.sign(info.fc);
        if ((fluxDir && fluxDir === rnaDir) || (metDir && metDir === rnaDir)) {
          concordant.push({
            rxn: j, name: r.n || r.id, ss: r.ss, fc: info.fc,
            viaFlux: fluxDir === rnaDir, viaMet: metDir === rnaDir,
            gene: info.genes[0]?.gene || "",
          });
        }
      }
    }
  }
  inducedIdle.sort((a, b) => b.fc - a.fc);
  concordant.sort((a, b) => (Number(b.viaMet) + Number(b.viaFlux)) - (Number(a.viaMet) + Number(a.viaFlux)) || Math.abs(b.fc) - Math.abs(a.fc));
  const postTx = (regResult?.classifiedSteps || []).filter((s) => s.mechanism === "postTranscriptional");
  return { inducedIdle, postTx, concordant };
}

// ------------------------------------------------ process-level leverage & counterfactual FBA ----
export const PROCESS_KEYS = ["atp", "nadph", "redox", "protein", "obj"];

const CATABOLIC_REDOX = (() => {
  const m = { ...REDOX_PAIRS, "menaquinol-8": 1, "2-demethylmenaquinol 8": 1 };
  delete m.NADPH;
  return m;
})();

const PROTEIN_AA_RE = /^(?:l-)?(alanine|arginine|asparagine|aspartate|cysteine|glutamate|glutamine|glycine|histidine|isoleucine|leucine|lysine|methionine|phenylalanine|proline|serine|threonine|tryptophan|tyrosine|valine)(?:\s*\([^)]*\))?$/i;
const INORGANIC_SKIP = new Set(["H+", "H2O", "O2", "H2O2", "CO2", "HCO3-", "NH4+", "Pi", "PPi", "OH-"]);

/**
 * Per-reaction physical flux weights for a metabolic process or a specific metabolite on flux vector `v`.
 * Summing stoichiometry across compartments automatically cancels pure inter-compartment transports so
 * turnover reflects genuine biochemical synthesis (`prod`) and consumption (`cons`), avoiding serial double-counting.
 *
 * @param processSpec "atp" | "nadph" | "redox" | "protein" | "obj" | { kind: "met", met?: number, base?: number }
 * @returns { prod: Map<number, number>, cons: Map<number, number>, totalProd: number, totalCons: number, scope: string }
 */
export function processRxnWeights(model, v, processSpec, opts = {}) {
  const prod = new Map(), cons = new Map();
  let totalProd = 0, totalCons = 0, scope = typeof processSpec === "string" ? processSpec : "met";
  if (!model?.rxns || !v) return { prod, cons, totalProd, totalCons, scope };

  const add = (j, net) => {
    if (Math.abs(net) < 1e-9) return;
    if (net > 0) { prod.set(j, (prod.get(j) || 0) + net); totalProd += net; }
    else { cons.set(j, (cons.get(j) || 0) - net); totalCons -= net; }
  };

  if (processSpec === "atp" || processSpec === "nadph" || processSpec === "redox") {
    const weights = processSpec === "atp" ? { ATP: 1 } : processSpec === "nadph" ? { NADPH: 1 } : CATABOLIC_REDOX;
    model.rxns.forEach((r, j) => {
      const vj = v[j];
      if (!vj || r.removed) return;
      let net = 0;
      for (let k = 0; k < r.m.length; k++) {
        const w = weights[model.bases[model.mets[r.m[k]].b].n];
        if (w) net += w * r.c[k] * vj;
      }
      add(j, net);
    });
  } else if (processSpec === "protein") {
    const aaBases = new Set();
    model.bases.forEach((b, bi) => { if (PROTEIN_AA_RE.test(b.n || "")) aaBases.add(bi); });
    const bioRxn = opts.biomassRxn ?? -1;
    model.rxns.forEach((r, j) => {
      const vj = v[j];
      if (!vj || r.removed || r.m.length < 2) return; // skip exchanges (uptake is supply, not synthesis)
      // Sum stoichiometry per AA base across compartments so pure AA transports cancel out
      const byAa = new Map();
      for (let k = 0; k < r.m.length; k++) {
        const b = model.mets[r.m[k]].b;
        if (aaBases.has(b)) byAa.set(b, (byAa.get(b) || 0) + r.c[k] * vj);
      }
      let pSum = 0, cSum = 0;
      for (const net of byAa.values()) {
        if (net > 1e-9 && j !== bioRxn) pSum += net;
        else if (net < -1e-9) cSum -= net;
      }
      if (pSum > 1e-9) { prod.set(j, pSum); totalProd += pSum; }
      if (cSum > 1e-9) { cons.set(j, cSum); totalCons += cSum; }
    });
  } else if (processSpec === "obj") {
    const objIdx = opts.objective ?? opts.biomassRxn ?? -1;
    const objR = objIdx >= 0 ? model.rxns[objIdx] : null;
    if (objR && !objR.removed && Math.abs(v[objIdx] || 0) > 1e-9) {
      const dir = v[objIdx] >= 0 ? 1 : -1;
      const reqBases = new Map(); // baseIdx -> stoichiometric demand weight (normalized)
      let reqSum = 0;
      for (let k = 0; k < objR.m.length; k++) {
        const c = objR.c[k] * dir;
        if (c >= 0) continue;
        const b = model.mets[objR.m[k]].b;
        const bn = model.bases[b].n || "";
        if (INORGANIC_SKIP.has(bn)) continue;
        reqBases.set(b, (reqBases.get(b) || 0) + Math.abs(c));
        reqSum += Math.abs(c);
      }
      if (reqBases.size && reqSum > 0) {
        // Normalize each precursor by its total production so scarce macromolecular precursors (nucleotides,
        // lipids, amino acids) aren't drowned out by high-flux currency cofactors like ATP.
        const baseTotProd = new Map();
        model.rxns.forEach((r, j) => {
          const vj = v[j];
          if (!vj || r.removed || j === objIdx || r.m.length < 2) return;
          const byB = new Map();
          for (let k = 0; k < r.m.length; k++) {
            const b = model.mets[r.m[k]].b;
            if (reqBases.has(b)) byB.set(b, (byB.get(b) || 0) + r.c[k] * vj);
          }
          for (const [b, net] of byB) if (net > 1e-9) baseTotProd.set(b, (baseTotProd.get(b) || 0) + net);
        });
        model.rxns.forEach((r, j) => {
          const vj = v[j];
          if (!vj || r.removed || j === objIdx || r.m.length < 2) return;
          const byB = new Map();
          for (let k = 0; k < r.m.length; k++) {
            const b = model.mets[r.m[k]].b;
            if (reqBases.has(b)) byB.set(b, (byB.get(b) || 0) + r.c[k] * vj);
          }
          let score = 0;
          for (const [b, net] of byB) {
            if (net > 1e-9) {
              const tot = baseTotProd.get(b) || 1;
              score += (net / tot) * (reqBases.get(b) / reqSum);
            }
          }
          if (score > 1e-9) { prod.set(j, score); totalProd += score; }
        });
      }
    }
    // Fallback if objective has no precursor producers (e.g. an exchange or single-step demand)
    if (totalProd <= 1e-9) {
      model.rxns.forEach((r, j) => {
        const vj = Math.abs(v[j] || 0);
        if (vj > 1e-9 && !r.removed && r.m.length >= 2) { prod.set(j, vj); totalProd += vj; }
      });
    }
  } else if (processSpec && typeof processSpec === "object" && processSpec.kind === "met") {
    const useComp = Number.isInteger(processSpec.met) && processSpec.met >= 0;
    const baseIdx = Number.isInteger(processSpec.base) ? processSpec.base : (useComp ? model.mets[processSpec.met]?.b : -1);
    const fillComp = () => {
      scope = "comp";
      model.rxns.forEach((r, j) => {
        const vj = v[j];
        if (!vj || r.removed) return;
        let net = 0;
        for (let k = 0; k < r.m.length; k++) if (r.m[k] === processSpec.met) net += r.c[k] * vj;
        add(j, net);
      });
    };
    const fillBase = () => {
      scope = "base";
      model.rxns.forEach((r, j) => {
        const vj = v[j];
        if (!vj || r.removed) return;
        let net = 0;
        for (let k = 0; k < r.m.length; k++) if (model.mets[r.m[k]].b === baseIdx) net += r.c[k] * vj;
        add(j, net);
      });
    };
    if (useComp) {
      fillComp();
      if (totalProd + totalCons <= 1e-9 && baseIdx >= 0) fillBase();
    } else if (baseIdx >= 0) {
      fillBase();
    }
  }

  return { prod, cons, totalProd, totalCons, scope };
}

/**
 * Concordant transcriptional evidence weight for a reaction `j` regulated in expected direction `dir` by a TF.
 * Returns a scalar in [0, 1]:
 *   - measured enzyme concordant with `dir`: min(1, |log2FC| / 2)
 *   - measured enzyme contradicting `dir`: 0
 *   - enzyme not measured in the RNA-seq table: small prior 0.2 (so measured concordant enzymes dominate)
 */
function rxnEvidenceWeight(rnaSummary, j, dir) {
  if (!dir) return 0;
  const info = rnaSummary?.rxnInfo?.get(j);
  if (!info) return 0.2;
  return Math.sign(info.fc) === dir ? Math.min(1, Math.abs(info.fc) / 2) : 0;
}

/**
 * Level 1 — Rank transcriptionally active TFs by their metabolic leverage over a specific process or metabolite.
 * Reports both exact physical turnover coverage (`prodShare`, `consShare`, `totalShare` in [0, 1]) and
 * concordant mRNA-weighted directional push (`prodPush`, `consPush`, `netPush` in [-1, 1]), plus co-regulation
 * overlap warnings (`sharedWith`) whenever another ranked TF covers >= 50 % of the same active reactions.
 */
export function rankRegulatorsByProcess(model, regResult, rnaSummary, v, processSpec, opts = {}) {
  const weights = processRxnWeights(model, v, processSpec, opts);
  const { prod, cons, totalProd, totalCons, scope } = weights;
  if (!regResult?.tfs?.length || totalProd + totalCons <= 1e-9) {
    return { process: processSpec, scope, totalProd, totalCons, items: [] };
  }

  const sigOnly = regResult.tfs.filter((e) => e.qRna < 0.05 || Math.abs(e.zRna) >= 2);
  const pool = sigOnly.length >= 3 ? sigOnly : regResult.tfs.slice(0, 25);

  const items = [];
  for (const e of pool) {
    if (!e.metRxns?.size) continue;
    let pCov = 0, cCov = 0, pPush = 0, cPush = 0;
    const activeSet = new Set();
    const drivers = [];
    for (const j of e.metRxns) {
      const pw = prod.get(j) || 0;
      const cw = cons.get(j) || 0;
      if (pw <= 1e-9 && cw <= 1e-9) continue;
      activeSet.add(j);
      const d = e.metRxnDir?.get(j) || 0;
      const c = rxnEvidenceWeight(rnaSummary, j, d);
      if (pw > 1e-9) {
        pCov += pw;
        pPush += d * c * pw;
        drivers.push({ rxn: j, name: model.rxns[j].n || model.rxns[j].id, w: pw, share: totalProd > 0 ? pw / totalProd : 0, dir: d, fc: rnaSummary?.rxnInfo?.get(j)?.fc ?? NaN, side: "prod" });
      }
      if (cw > 1e-9) {
        cCov += cw;
        cPush += d * c * cw;
        drivers.push({ rxn: j, name: model.rxns[j].n || model.rxns[j].id, w: cw, share: totalCons > 0 ? cw / totalCons : 0, dir: d, fc: rnaSummary?.rxnInfo?.get(j)?.fc ?? NaN, side: "cons" });
      }
    }
    if (!activeSet.size) continue;
    const prodShare = totalProd > 0 ? Math.min(1, pCov / totalProd) : 0;
    const consShare = totalCons > 0 ? Math.min(1, cCov / totalCons) : 0;
    const totalShare = Math.min(1, (pCov + cCov) / (totalProd + totalCons));
    const prodPush = totalProd > 0 ? pPush / totalProd : 0;
    const consPush = totalCons > 0 ? cPush / totalCons : 0;
    // For processes (ATP, NADPH, redox, protein, obj), pushing either side up accelerates pathway turnover.
    // For a specific metabolite pool, production up (+) and consumption down (-) raise the pool, while both
    // sides moving together accelerates its turnover (falls back to turnover push if balanced).
    const turnoverPush = (pPush + cPush) / (totalProd + totalCons);
    const isMet = typeof processSpec === "object" && processSpec?.kind === "met";
    const poolPush = (totalProd > 0 ? prodPush : 0) - (totalCons > 0 ? consPush : 0);
    const netPush = isMet && Math.abs(poolPush) > 0.05 ? Math.max(-1, Math.min(1, poolPush)) : turnoverPush;
    drivers.sort((a, b) => b.w - a.w);
    items.push({
      tf: e.tf,
      entry: e,
      zRna: e.zRna,
      qRna: e.qRna,
      prodShare,
      consShare,
      totalShare,
      prodPush,
      consPush,
      netPush,
      nActiveRxns: activeSet.size,
      activeRxns: activeSet,
      drivers: drivers.slice(0, 4),
      sharedWith: [],
    });
  }

  items.sort((a, b) => (Math.abs(b.netPush) - Math.abs(a.netPush)) || (b.totalShare - a.totalShare) || (Math.abs(b.zRna) - Math.abs(a.zRna)));

  // Co-regulation overlap check among the top 15 TFs in this process
  const topN = items.slice(0, 15);
  for (let i = 0; i < topN.length; i++) {
    const a = topN[i];
    const peers = [];
    for (let k = 0; k < topN.length; k++) {
      if (i === k) continue;
      const b = topN[k];
      let inter = 0;
      for (const j of a.activeRxns) if (b.activeRxns.has(j)) inter++;
      const pct = Math.round((100 * inter) / a.activeRxns.size);
      if (pct >= 50) peers.push({ tf: b.tf, pct });
    }
    peers.sort((x, y) => y.pct - x.pct);
    a.sharedWith = peers.slice(0, 2);
  }

  return { process: processSpec, scope, totalProd, totalCons, items };
}

/**
 * Compact profile of which core metabolic processes (`atp`, `nadph`, `redox`, `protein`, `obj`) a given TF
 * controls on the current flux solution `v`. Returns processes with >= 2 % turnover coverage.
 */
export function tfProcessProfile(model, regResult, rnaSummary, v, tfEntry, opts = {}) {
  if (!tfEntry?.metRxns?.size || !v) return [];
  const out = [];
  for (const key of PROCESS_KEYS) {
    const { prod, cons, totalProd, totalCons } = processRxnWeights(model, v, key, opts);
    if (totalProd + totalCons <= 1e-9) continue;
    let pCov = 0, cCov = 0, pPush = 0, cPush = 0, nAct = 0;
    for (const j of tfEntry.metRxns) {
      const pw = prod.get(j) || 0, cw = cons.get(j) || 0;
      if (pw <= 1e-9 && cw <= 1e-9) continue;
      nAct++;
      const d = tfEntry.metRxnDir?.get(j) || 0;
      const c = rxnEvidenceWeight(rnaSummary, j, d);
      if (pw > 1e-9) { pCov += pw; pPush += d * c * pw; }
      if (cw > 1e-9) { cCov += cw; cPush += d * c * cw; }
    }
    const prodShare = totalProd > 0 ? Math.min(1, pCov / totalProd) : 0;
    const consShare = totalCons > 0 ? Math.min(1, cCov / totalCons) : 0;
    const totalShare = Math.min(1, (pCov + cCov) / (totalProd + totalCons));
    if (totalShare < 0.02 && prodShare < 0.02) continue;
    const prodPush = totalProd > 0 ? pPush / totalProd : 0;
    const consPush = totalCons > 0 ? cPush / totalCons : 0;
    const netPush = (pPush + cPush) / (totalProd + totalCons);
    out.push({ key, prodShare, consShare, totalShare, prodPush, consPush, netPush, nActiveRxns: nAct });
  }
  out.sort((a, b) => (Math.max(Math.abs(b.netPush), b.totalShare * 0.5) - Math.max(Math.abs(a.netPush), a.totalShare * 0.5)) || (b.totalShare - a.totalShare));
  return out;
}

/** Top active TFs with leverage on a specific metabolite `metIdx` (compartment-first, fallback to base). */
export function metaboliteRegulators(model, regResult, rnaSummary, v, metIdx, opts = {}) {
  const res = rankRegulatorsByProcess(model, regResult, rnaSummary, v, { kind: "met", met: metIdx }, opts);
  return {
    scope: res.scope,
    totalProd: res.totalProd,
    totalCons: res.totalCons,
    items: res.items.filter((x) => x.totalShare >= 0.005).slice(0, 6),
  };
}

/** Top active TFs controlling flux inside a specific pathway's reaction list. */
export function pathwayRegulators(model, regResult, rnaSummary, v, rxns) {
  if (!regResult?.tfs?.length || !v || !rxns?.length) return [];
  const rxnSet = new Set(rxns);
  let tot = 0;
  for (const j of rxns) if (!model.rxns[j]?.removed) tot += Math.abs(v[j] || 0);
  if (tot <= 1e-9) return [];
  const sigOnly = regResult.tfs.filter((e) => e.qRna < 0.05 || Math.abs(e.zRna) >= 2);
  const pool = sigOnly.length >= 3 ? sigOnly : regResult.tfs.slice(0, 25);
  const out = [];
  for (const e of pool) {
    if (!e.metRxns?.size) continue;
    let cov = 0, push = 0, nAct = 0;
    for (const j of e.metRxns) {
      if (!rxnSet.has(j)) continue;
      const w = Math.abs(v[j] || 0);
      if (w <= 1e-9) continue;
      nAct++;
      cov += w;
      const d = e.metRxnDir?.get(j) || 0;
      push += d * rxnEvidenceWeight(rnaSummary, j, d) * w;
    }
    if (!nAct) continue;
    const share = Math.min(1, cov / tot);
    if (share < 0.01) continue;
    out.push({ tf: e.tf, zRna: e.zRna, qRna: e.qRna, share, push: push / tot, nActiveRxns: nAct });
  }
  out.sort((a, b) => (Math.abs(b.push) - Math.abs(a.push)) || (b.share - a.share));
  return out.slice(0, 5);
}

// ---------------------------------------------------------------- the regulon as plain knowledge ----
// Which transcription factors are known to regulate a reaction's enzymes is a property of the regulon file,
// not of anybody's experiment. It is available as soon as a model is loaded, and the functions below read it
// without any RNA-seq.
//
// What differs without RNA-seq is the MEANING of the sign. The edge sign says the regulator activates or
// represses that gene. Only a measured change in the regulator's activity turns that into a direction of
// change for the reaction ("pushed up"), which is why nothing here claims one.

/**
 * A reverse index over data/<model>/regulons.json: for a gene, who regulates it; for a regulator, which
 * reactions of this model its targets catalyse. Built once per model.
 */
export function buildRegulonIndex(model, regulons) {
  if (!regulons?.tfs) return null;
  const genes = regulons.genes || [];
  const byGene = new Map();                       // gene (lowercase) -> [{ tf, sign }]
  const genesOfTf = new Map();                    // tf -> [{ gene, sign }]
  for (const [tf, flat] of regulons.tfs) {
    const arr = [];
    for (let k = 0; k < flat.length; k += 2) {
      const gene = genes[flat[k]];
      if (!gene) continue;
      const sign = flat[k + 1];
      arr.push({ gene, sign });
      const key = gene.toLowerCase();
      if (!byGene.has(key)) byGene.set(key, []);
      byGene.get(key).push({ tf, sign });
    }
    genesOfTf.set(tf, arr);
  }
  // gene -> reactions, from the GPR rules, the same way the inference does it
  const rxnsOfGene = new Map();
  model.rxns.forEach((r, j) => {
    if (!r.g || r.removed) return;
    for (const g of new Set(r.g.match(/[^\s()]+/g).filter((x) => !/^(and|or)$/i.test(x)))) {
      const key = g.toLowerCase();
      if (!rxnsOfGene.has(key)) rxnsOfGene.set(key, []);
      rxnsOfGene.get(key).push(j);
    }
  });
  return { byGene, genesOfTf, rxnsOfGene, meta: regulons.meta || null, nTfs: regulons.tfs.length };
}

/**
 * The regulators known to act on a reaction, through the genes of its GPR rule.
 * @returns [{ tf, sign, genes: [{ gene, sign }] }] -- sign is +1 activates, -1 represses, 0 both
 */
export function regulatorsOfReaction(index, model, rxnIdx) {
  const r = model.rxns[rxnIdx];
  if (!index || !r?.g) return [];
  const byTf = new Map();
  for (const g of new Set(r.g.match(/[^\s()]+/g).filter((x) => !/^(and|or)$/i.test(x)))) {
    for (const { tf, sign } of index.byGene.get(g.toLowerCase()) || []) {
      if (!byTf.has(tf)) byTf.set(tf, { tf, sign, genes: [] });
      const e = byTf.get(tf);
      if (e.sign !== sign) e.sign = 0;            // it activates one subunit and represses another
      e.genes.push({ gene: g, sign });
    }
  }
  // most of the reaction's enzymes first: a regulator that touches every subunit matters more than one
  // that touches a single isoenzyme of several
  return [...byTf.values()].sort((a, b) => b.genes.length - a.genes.length);
}

/** The regulators known to act on one gene. @returns [{ tf, sign }] */
export function regulatorsOfGene(index, gene) {
  return (index?.byGene.get(String(gene).toLowerCase()) || []).slice();
}

/**
 * Every reaction of this model that a regulator's targets catalyse, with the edge sign.
 * @returns { rxns: Set, sign: Map<rxnIdx, +1|-1|0>, drivers: Map<rxnIdx, [{gene, regSign}]> }
 */
export function regulonReactions(index, tf) {
  const out = { rxns: new Set(), sign: new Map(), drivers: new Map() };
  for (const { gene, sign } of index?.genesOfTf.get(tf) || []) {
    for (const j of index.rxnsOfGene.get(gene.toLowerCase()) || []) {
      out.rxns.add(j);
      out.sign.set(j, out.sign.has(j) && out.sign.get(j) !== sign ? 0 : sign);
      if (!out.drivers.has(j)) out.drivers.set(j, []);
      out.drivers.get(j).push({ gene, regSign: sign });
    }
  }
  return out;
}

/** All transcriptionally active TFs targeting a specific reaction `rxnIdx` (even if its enzymes weren't in RNA-seq). */
export function activeTfsForReaction(regResult, rxnIdx) {
  if (!regResult?.tfs?.length) return [];
  const out = [];
  for (const e of regResult.tfs.slice(0, 60)) {
    if (!(e.qRna < 0.05 || Math.abs(e.zRna) >= 2)) continue;
    if (!e.metRxns?.has(rxnIdx)) continue;
    out.push({
      tf: e.tf,
      dir: e.metRxnDir?.get(rxnIdx) || 0,
      zRna: e.zRna,
      qRna: e.qRna,
      drivers: e.rxnDrivers?.get(rxnIdx) || [],
    });
  }
  out.sort((a, b) => Math.abs(b.zRna) - Math.abs(a.zRna));
  return out.slice(0, 6);
}

/**
 * Level 2 — Build a GPR-respecting FBA counterfactual perturbation for a TF:
 *  - Mode `"repressed"`: attenuates concordantly downregulated metabolic targets (expected < 0, log2FC <= -0.35),
 *    measuring the loss caused by the TF's transcriptional repression.
 *  - Mode `"induced"`: if no repressed targets affect any reaction via GPR, attenuates concordantly upregulated
 *    targets (expected > 0, log2FC >= 0.35) to measure how much the process depends on the TF's induced module.
 * Redundant `or`-branch isoenzymes automatically keep reaction activity = 1 (zero spurious effect).
 */
export function buildTfCounterfactualPerturbation(model, tfEntry, offGenes = null) {
  if (!model?.rxns || !tfEntry?.metGenes?.length) return { mode: "none", pert: new Map(), nGenes: 0, nRxns: 0, genes: [] };
  // Map lowercase gene symbols to every exact GPR token spelling present in model.genes
  const tokensByLower = new Map();
  for (const g of model.genes || []) {
    for (const tok of [g[0], g[1]]) {
      if (!tok) continue;
      const k = tok.toLowerCase();
      const set = tokensByLower.get(k) || tokensByLower.set(k, new Set()).get(k);
      set.add(tok);
    }
  }
  const makePert = (targets, capFn) => {
    const levels = new Map();
    if (offGenes) {
      for (const og of offGenes) {
        levels.set(og, 0);
        for (const tok of tokensByLower.get(og.toLowerCase()) || []) levels.set(tok, 0);
      }
    }
    const usedGenes = [];
    for (const mg of targets) {
      const a = capFn(mg.log2fc);
      const low = mg.gene.toLowerCase();
      const toks = tokensByLower.get(low);
      levels.set(mg.gene, Math.min(levels.get(mg.gene) ?? 1, a));
      if (toks) for (const tok of toks) levels.set(tok, Math.min(levels.get(tok) ?? 1, a));
      usedGenes.push(mg.gene);
    }
    const pert = new Map();
    for (const j of tfEntry.metRxns || []) {
      const r = model.rxns[j];
      if (!r || r.removed || !r.g) continue;
      const a = gprActivity(r.g, levels);
      if (a < 0.999) pert.set(j, a);
    }
    return { pert, usedGenes };
  };

  const downTargets = tfEntry.metGenes.filter((mg) => mg.expected < 0 && mg.log2fc <= -0.35);
  if (downTargets.length) {
    const { pert, usedGenes } = makePert(downTargets, (fc) => (fc <= -2 ? 0 : Math.max(0.05, Math.min(0.5, Math.pow(2, fc)))));
    if (pert.size) return { mode: "repressed", pert, nGenes: usedGenes.length, nRxns: pert.size, genes: usedGenes };
  }
  const upTargets = tfEntry.metGenes.filter((mg) => mg.expected > 0 && mg.log2fc >= 0.35);
  if (upTargets.length) {
    const { pert, usedGenes } = makePert(upTargets, (fc) => Math.max(0.05, Math.min(0.5, Math.pow(2, -fc))));
    if (pert.size) return { mode: "induced", pert, nGenes: usedGenes.length, nRxns: pert.size, genes: usedGenes };
  }
  return { mode: "none", pert: new Map(), nGenes: 0, nRxns: 0, genes: [] };
}

/**
 * Compute exact counterfactual FBA effect size (% change in process turnover or objective) from a baseline
 * pFBA solution (`baseV`, `baseObj`) and a perturbed solution (`pertV`, `pertObj`).
 */
export function evaluateCounterfactualEffect(model, baseV, pertV, baseObj, pertObj, processSpec, opts = {}) {
  if (!baseV) return null;
  if (processSpec === "obj") {
    if (!Number.isFinite(baseObj) || Math.abs(baseObj) < 1e-12) return null;
    const pv = pertV ? (pertObj || 0) : 0;
    return { baseVal: baseObj, pertVal: pv, relDelta: (pv - baseObj) / Math.abs(baseObj) };
  }
  const b = processRxnWeights(model, baseV, processSpec, opts);
  const baseVal = b.totalProd > 1e-9 ? b.totalProd : b.totalCons;
  if (baseVal <= 1e-9) return null;
  if (!pertV) return { baseVal, pertVal: 0, relDelta: -1 };
  const p = processRxnWeights(model, pertV, processSpec, opts);
  const pertVal = b.totalProd > 1e-9 ? p.totalProd : p.totalCons;
  return { baseVal, pertVal, relDelta: (pertVal - baseVal) / baseVal };
}

