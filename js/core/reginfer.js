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

    const v = flux ? flux[r.rxn] : 0;
    let direction = 1;
    if (flux && v < -1e-9) { [S, P] = [P, S]; direction = -1; }

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
 * @param rnaByGene Map<geneLowerOrSym, { gene?, log2fc, stat?, q? }> | Map<gene, number>
 */
export function inferRegulatorsMultiOmic(model, net, regulons, fcByBase, qByBase, rnaByGene, opts = {}) {
  const {
    minTargetsRna = 5,
    minTargetsMet = 3,
    rnaFcMin = 0.35,
    metActMin = 0.15,
    bottleneckSteps = [],
  } = opts;

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
  const evidence = hasMet
    ? reactionToGeneEvidence(model, net, fcByBase, qByBase || new Map(), opts)
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
    const allMetTargets = metTargetsByTf.get(rt.tf) || [];
    for (const { gene, sign } of allMetTargets) {
      const k = gene.toLowerCase();
      const rxns = rxnsByGene.get(k) || [];
      for (const j of rxns) metRxns.add(j);
      const rna = rnaNorm.get(k);
      const met = metGeneLow.get(k);
      const expected = tfDir * sign; // expected direction of enzyme mRNA & activity
      const rnaHit = rna && Math.abs(rna.log2fc) >= rnaFcMin ? Math.sign(rna.log2fc) : 0;
      if (rna && rnaHit === expected) {
        metGenes.push({ gene, regSign: sign, expected, log2fc: rna.log2fc, q: rna.q, rxns });
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
      concordant,
      rnaOnly,
      discordant,
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

  return {
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
