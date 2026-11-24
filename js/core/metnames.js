// Resolving a metabolite label from someone else's table to a metabolite of the model.
//
// Three layers, in order, and the result always says which one answered so that the interface can show it:
//
//  1. identifier   the label is an HMDB, ChEBI, KEGG, BiGG, MetaNetX or Human-GEM id. Exact, no guessing.
//  2. name         the label is the model's own name, ignoring case and spacing.
//  3. convention   the label is the same compound written by another convention. These are RULES, not a
//                  synonym database: the acid and the anion (succinic acid / succinate), the L- and D-
//                  prefixes that the model gives to some metabolites and not others (L-Alanine / alanine),
//                  the separator before a locant (glyceraldehyde-3-phosphate / "D-glyceraldehyde 3-phosphate"),
//                  the annotation prefix of untargeted pipelines ("[FA (11:0)] …") and their instrument
//                  suffixes ("Pyruvic acid_LCQUAN").
//
// Measured on the untargeted panel of Cardaci et al. 2015 (344 labels, no identifiers at all): exact names
// alone resolve 43, the conventions take it to 75, and they recover every central metabolite the paper's
// argument rests on. The rest of that panel are lipids and plant compounds that are not in the model, so no
// amount of synonym data would place them — which is why the report (tools/validation/mapping_report.mjs)
// counts them separately instead of hiding them.
//
// What this deliberately does NOT do: guess. A label that no layer resolves comes back unresolved, with
// suggestions for the user to choose from, because an invented match is worse than a gap.

// The model's own abbreviations. Mapping these is our job, not the user's: the user writes the compound's
// name and Human-GEM happens to store a short form.
const ALIASES = {
  "2-oxoglutarate": "AKG", "alpha-ketoglutarate": "AKG", "a-ketoglutarate": "AKG", "2-ketoglutarate": "AKG",
  "alpha-oxoglutarate": "AKG", "ketoglutarate": "AKG", "akg": "AKG",
  phosphoenolpyruvate: "PEP", "phospho-enol-pyruvate": "PEP",
  "dihydroxyacetone phosphate": "DHAP", "dihydroxyacetone-phosphate": "DHAP", "glycerone phosphate": "DHAP",
  oxaloacetate: "OAA", "oxalacetic acid": "OAA", "oxaloacetic acid": "OAA",
  glutathione: "GSH", "reduced glutathione": "GSH",
  "glutathione disulfide": "GSSG", "oxidized glutathione": "GSSG", "oxidised glutathione": "GSSG",
  "tetrahydrofolate": "THF", "tetrahydrofolic acid": "THF",
  "glyceraldehyde-3-phosphate": "D-glyceraldehyde 3-phosphate", "glyceraldehyde 3-phosphate": "D-glyceraldehyde 3-phosphate",
  "g3p": "D-glyceraldehyde 3-phosphate", "ga3p": "D-glyceraldehyde 3-phosphate",
  "nad": "NAD+", "nadp": "NADP+", "nicotinamide adenine dinucleotide": "NAD+",
  lactate: "L-lactate", "lactic acid": "L-lactate",
  "inorganic phosphate": "Pi", phosphate: "Pi", orthophosphate: "Pi",
  "carbon dioxide": "CO2", bicarbonate: "HCO3-", water: "H2O", oxygen: "O2", proton: "H+", ammonium: "NH4+", ammonia: "NH3",
  // the nucleotides written out, which broad panels often do (every target verified in Human-GEM)
  "adenosine monophosphate": "AMP", "adenosine diphosphate": "ADP", "adenosine triphosphate": "ATP",
  "guanosine monophosphate": "GMP", "guanosine diphosphate": "GDP", "guanosine triphosphate": "GTP",
  "uridine monophosphate": "UMP", "uridine diphosphate": "UDP", "uridine triphosphate": "UTP",
  "cytidine monophosphate": "CMP", "cytidine diphosphate": "CDP", "cytidine triphosphate": "CTP",
  "inosine monophosphate": "IMP", "inosine diphosphate": "IDP", "inosine triphosphate": "ITP",
  "deoxyadenosine monophosphate": "dAMP", "deoxyadenosine diphosphate": "dADP", "deoxyadenosine triphosphate": "dATP",
  "deoxyguanosine monophosphate": "dGMP", "deoxyguanosine diphosphate": "dGDP", "deoxyguanosine triphosphate": "dGTP",
  "deoxycytidine monophosphate": "dCMP", "deoxycytidine diphosphate": "dCDP", "deoxycytidine triphosphate": "dCTP",
  "deoxythymidine monophosphate": "dTMP", "deoxythymidine diphosphate": "dTDP", "deoxythymidine triphosphate": "dTTP",
  "thymidine monophosphate": "dTMP", "thymidine diphosphate": "dTDP", "thymidine triphosphate": "dTTP",
  "deoxyuridine monophosphate": "dUMP", "deoxyuridine diphosphate": "dUDP", "deoxyuridine triphosphate": "dUTP",
  "cyclic amp": "cAMP", "3',5'-cyclic amp": "cAMP", "adenosine 3',5'-cyclic monophosphate": "cAMP",
  "cyclic gmp": "cGMP", "3',5'-cyclic gmp": "cGMP", "guanosine 3',5'-cyclic monophosphate": "cGMP",
  // abbreviations and spellings found in the published panels of tools/validation (the mapping report
  // names the dataset each one came from)
  gaba: "4-aminobutyrate", "gamma-aminobutyrate": "4-aminobutyrate", "gamma-aminobutyric acid": "4-aminobutyrate",
  "4-aminobutyric acid": "4-aminobutyrate",
  argsucc: "argininosuccinate", "argininosuccinic acid": "argininosuccinate",
  "5-hydroxylysine": "L-hydroxylysine", hydroxylysine: "L-hydroxylysine",
  "aminoadipic acid": "L-2-aminoadipate", "2-aminoadipic acid": "L-2-aminoadipate", aminoadipate: "L-2-aminoadipate",
  "5-hydroxytryptophane": "5-hydroxy-L-tryptophan", "5-hydroxytryptophan": "5-hydroxy-L-tryptophan",
};

const norm = (s) => String(s).trim().toLowerCase().replace(/\s+/g, " ");

/**
 * The ways the same compound may be written. Returns the label first, then its variants, so that an exact
 * match always wins over a rule.
 */
export function nameVariants(label) {
  const out = [];
  const add = (s) => { const v = norm(s); if (v && !out.includes(v)) out.push(v); };
  let base = String(label).trim();
  add(base);
  // untargeted annotation prefix: "[FA (11:0)] 11-bromo-…", "[PC (16:0/18:2)] …"
  const noPrefix = base.replace(/^\[[^\]]*\]\s*/, "").trim();
  if (noPrefix !== base) add(noPrefix);
  // instrument or method suffix: "Pyruvic acid_LCQUAN", "glucose_pos", "lactate neg"
  // Only strip underscore-delimited tags or explicit polarity tags — never arbitrary space-separated words
  // such as "phosphate", "monophosphate", "oxidized" or "methyl", which would mis-map to a different compound.
  const noSuffix = noPrefix.replace(/(?:_[A-Za-z0-9]{1,12}|\s+(?:pos|neg|positive|negative))$/i, "").trim();
  add(noSuffix);
  const seeds = [...new Set([base, noPrefix, noSuffix].map(norm).filter(Boolean))];
  for (const seed of seeds) {
    // the acid and its anion: succinic acid -> succinate, aspartic acid -> aspartate
    const anion = seed.replace(/\b([a-z]+?)ic acid\b/g, (_, stem) => `${stem}ate`);
    add(anion);
    for (const v of [seed, anion]) {
      add(v.replace(/\s*acid$/, ""));            // "linoleic acid" handled above; "folic acid" -> "folic"
      add(v.replace(/^[ld]-/, ""));              // L-Alanine -> alanine
      add(v.replace(/^[ld]\s/, ""));
      add(`l-${v.replace(/^[ld]-/, "")}`);       // lactate -> l-lactate
      add(`d-${v.replace(/^[ld]-/, "")}`);       // glucose -> d-glucose, xylulose-5-phosphate -> d-xylulose…
      // the separator before a locant: "glyceraldehyde-3-phosphate" / "glyceraldehyde 3-phosphate"
      add(v.replace(/-(\d)/g, " $1"));
      add(v.replace(/ (\d)/g, "-$1"));
    }
  }
  return out;
}

/**
 * Lookup table for one model. `mets` limits it to a set of metabolite indices (the exchanges, for medium
 * data); without it every metabolite of the model is offered.
 * @returns { byId, byName, names: [{ base, name }] }
 */
export function buildMetIndex(model, mets = null) {
  const byId = new Map(), byName = new Map(), names = [];
  const bases = new Set();
  if (mets) for (const m of mets) bases.add(model.mets[m].b);
  else model.bases.forEach((_, i) => bases.add(i));
  const first = (map, key, val) => { const k = norm(key); if (k && !map.has(k)) map.set(k, val); };
  for (const b of bases) {
    const base = model.bases[b];
    if (!base) continue;
    for (const id of [base.id, base.kegg, base.hmdb, base.chebi, base.bigg, base.mnx]) if (id) first(byId, id, b);
    // HMDB moved from 5-digit to 7-digit accessions: accept both spellings of ours
    if (base.hmdb) {
      const m = /^HMDB0*(\d+)$/.exec(base.hmdb);
      if (m) { first(byId, `HMDB${m[1].padStart(7, "0")}`, b); first(byId, `HMDB${m[1].padStart(5, "0")}`, b); }
    }
    first(byName, base.n, b);
    names.push({ base: b, name: base.n });
  }
  return { byId, byName, names };
}

/**
 * Resolve one label.
 * @returns { base, via } — via is "id", "name", "alias", "rule", or null when nothing matched
 */
export function resolveMetabolite(label, index) {
  if (!label) return { base: undefined, via: null };
  const raw = String(label).trim();
  const byId = index.byId.get(norm(raw));
  if (byId !== undefined) return { base: byId, via: "id" };
  const exact = index.byName.get(norm(raw));
  if (exact !== undefined) return { base: exact, via: "name" };
  const variants = nameVariants(raw);
  for (const v of variants) {
    const alias = ALIASES[v];
    if (alias) {
      const b = index.byName.get(norm(alias));
      if (b !== undefined) return { base: b, via: "alias" };
    }
  }
  for (const v of variants.slice(1)) {
    const b = index.byName.get(v) ?? index.byId.get(v);
    if (b !== undefined) return { base: b, via: "rule" };
  }
  return { base: undefined, via: null };
}

/** Trigrams of a string, for the suggestions offered when nothing resolved. */
const trigrams = (s) => {
  const t = ` ${norm(s).replace(/[^a-z0-9]+/g, " ")} `, out = new Set();
  for (let i = 0; i < t.length - 2; i++) out.add(t.slice(i, i + 3));
  return out;
};

/**
 * Closest metabolites of the model to a label that did not resolve, so that the interface can offer them
 * and the user decides. Similarity is the Jaccard overlap of trigrams — no dependency, tolerant of word
 * order — with two corrections that matter in practice:
 *   · a label that starts a model name, or a word of it, is boosted. Without this a three-letter code such
 *     as "ASP" scores highest against "tRNA(asp)" rather than against "aspartate", because a short query
 *     overlaps a short name proportionally more.
 *   · names far longer than the label are damped, so "serine" does not win over "anserine".
 * @returns [{ base, name, score }] best first
 */
export function suggestMetabolites(label, index, limit = 8) {
  const q = norm(label);
  const want = trigrams(label);
  if (!want.size) return [];
  const wordRe = new RegExp(`\\b${q.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`);
  const out = [];
  for (const { base, name } of index.names) {
    const n = norm(name);
    const have = trigrams(name);
    let shared = 0;
    for (const g of want) if (have.has(g)) shared++;
    const starts = n === q || n.startsWith(q) || wordRe.test(n);
    if (!shared && !starts) continue;
    let score = shared / (want.size + have.size - shared);
    if (starts) score = Math.min(1, score + 0.35);
    const ratio = Math.min(q.length, n.length) / Math.max(q.length, n.length);
    score *= 0.5 + 0.5 * ratio; // a much longer name is a weaker answer
    out.push({ base, name, score });
  }
  out.sort((a, b) => b.score - a.score);
  return out.slice(0, limit);
}
