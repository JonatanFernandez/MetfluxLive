// Cell-type contexts: genes that are not detected in a cell line, cell type or tissue, switched off.
//
// data/<slug>/contexts.json is built offline (tools/contexts/): for each context, a bitset over the genes of
// the published model marks the genes that are off (not detected by the source, minus the genes switched
// back on so that the essential metabolic tasks stay possible). A reaction is blocked when its GPR rule
// evaluates to 0 with those genes off: isoenzymes (or) compensate, a complex (and) needs all its subunits.

import { gprActivity } from "./gpr.js";

/** Extra parsimony weight of a reaction whose enzymes are not detected, in "penalise" mode. */
export const CONTEXT_PENALTY = 10;

const cache = new Map();

/** The contexts file of a model, or null when there is none. */
export async function loadContexts(slug) {
  if (!cache.has(slug)) {
    cache.set(slug, fetch(`data/${slug}/contexts.json`).then((r) => (r.ok ? r.json() : null)).catch(() => null).then((d) => {
      if (d) d.byId = new Map(d.contexts.map((c) => [c.id, c]));
      return d;
    }));
  }
  return cache.get(slug);
}

/** Gene symbols switched off in a context (genes of the published model, as used in the GPR rules). */
const offCache = new WeakMap(); // not a property of the context: contexts are saved to sessions as JSON
export function offGenes(ctx, baseGenes) {
  if (offCache.has(ctx)) return offCache.get(ctx);
  const bin = atob(ctx.off), out = new Set();
  for (let i = 0; i < baseGenes.length; i++) if (bin.charCodeAt(i >> 3) & (1 << (i & 7))) out.add(baseGenes[i][1]);
  offCache.set(ctx, out);
  return out;
}

// Small molecules that cross membranes by diffusion: their transport reactions carry a GPR rule (aquaporins,
// channels) but do not need it, so they are never blocked (in Human-GEM urea transport into the mitochondria
// depends on AQP9 alone, and a cell without AQP9 could not export the urea of mitochondrial arginase).
export const DIFFUSIBLE = new Set(["H2O", "O2", "CO2", "NH3", "urea", "NO", "H2S"]);

/** Transport reactions that only move freely diffusing molecules between compartments. */
export function isDiffusion(model, r) {
  const comps = new Set(r.m.map((m) => model.mets[m].c));
  return comps.size > 1 && r.m.every((m) => DIFFUSIBLE.has(model.bases[model.mets[m].b].n));
}

/** Reactions of the (possibly edited) model that no detected enzyme can catalyse. */
export function blockedReactions(model, off) {
  const levels = new Map([...off].map((g) => [g, 0]));
  const out = [];
  model.rxns.forEach((r, j) => { if (r.g && !r.removed && !isDiffusion(model, r) && gprActivity(r.g, levels) === 0) out.push(j); });
  return Int32Array.from(out);
}

/** Genes of a reaction's rule that are off in the context. */
export function offGenesOf(rule, off) {
  return [...new Set((rule || "").match(/[^\s()]+/g) || [])].filter((g) => !/^(and|or)$/i.test(g) && off.has(g));
}

/** Name of a metabolic task, stored as an index into data.taskNames (older files kept the text). */
export const taskName = (data, x) => (typeof x === "number" ? data.taskNames?.[x] ?? String(x) : x);

export const CONTEXT_GROUPS = ["user", "strain", "consensus", "lineCancer", "lineOther", "cellType", "tissue"];

/** Search over contexts, in the shape attachSearch() expects. Empty query: the contexts with measured data first. */
export class ContextIndex {
  constructor(data, label) {
    const norm = (s) => String(s || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
    this.items = data.contexts.map((c) => {
      const i = c.info || {};
      const sub = label.sub(c);
      return { type: "ctx", ref: c.id, title: c.name, sub, badge: label.badge(c), badgeClass: label.badgeClass?.(c), group: c.group, pairs: c.pairs || [],
        hay: norm([c.name, i.genotype, i.disease, i.site, i.category, i.cellosaurus, i.entity, label.group(c)].filter(Boolean).join(" | ")), name: norm(c.name) };
    });
  }

  query(q, limit = 80) {
    const norm = (s) => String(s || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
    q = norm(q).trim();
    if (!q) return this.items.filter((it) => it.pairs.length || it.group === "consensus").concat(this.items.filter((it) => it.group === "tissue")).slice(0, limit);
    const words = q.split(/\s+/), out = [];
    for (const it of this.items) {
      let score = 0, ok = true;
      for (const w of words) {
        const p = it.hay.indexOf(w);
        if (p < 0) { ok = false; break; }
        score += p === 0 || /[\s|,;:()\-\[\]\/]/.test(it.hay[p - 1]) ? 6 : 2;
      }
      if (!ok) continue;
      if (it.name === q) score += 60; else if (it.name.startsWith(q)) score += 30;
      score -= Math.min(8, it.name.length / 12);
      out.push([score, it]);
    }
    out.sort((a, b) => b[0] - a[0]);
    return out.slice(0, limit).map((x) => x[1]);
  }
}
