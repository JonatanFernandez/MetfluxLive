// Building a cell-type context from expression levels: genes below a cut-off are switched off, the reactions left
// without an enzyme are blocked, and genes are switched back on until every metabolic task is possible again.
// Shared by tools/contexts/build_contexts.mjs (the built-in catalogue) and the app (the user's own RNA-seq data,
// in js/core/ctxbuild.worker.js), so both follow exactly the same procedure.
//
// Task rescue: for a task that is not possible, one LP finds the cheapest way to make it possible through blocked
// reactions (each costs BIG * (2 - level of its best-expressed off gene / cut-off), so genes just below the cut-off
// are preferred; the other reactions cost freqW, a small weight) and the genes those reactions need are switched
// back on (for "or", the branch needing the fewest / best-expressed genes). This is the task protection of tINIT
// (Agren et al. 2014) applied to a list of genes switched off.

import { isDiffusion } from "./contexts.js";

const BIG = 1000;

export function parseGpr(rule) {
  const tok = rule.match(/\(|\)|[^\s()]+/g) || [];
  let p = 0;
  const is = (w) => tok[p] !== undefined && tok[p].toLowerCase() === w;
  const factor = () => { if (tok[p] === "(") { p++; const n = expr(); if (tok[p] === ")") p++; return n; } return tok[p++]; };
  const term = () => { const k = [factor()]; while (is("and")) { p++; k.push(factor()); } return k.length > 1 ? ["and", ...k] : k[0]; };
  const expr = () => { const k = [term()]; while (is("or")) { p++; k.push(term()); } return k.length > 1 ? ["or", ...k] : k[0]; };
  return expr();
}
export const active = (n, off) => (typeof n === "string" ? !off.has(n) : n[0] === "or" ? n.slice(1).some((x) => active(x, off)) : n.slice(1).every((x) => active(x, off)));
/** Genes to switch on so that a rule becomes active. */
export function enable(n, off, level) {
  if (typeof n === "string") return off.has(n) ? [n] : [];
  if (n[0] === "and") return [...new Set(n.slice(1).flatMap((x) => enable(x, off, level)))];
  let best = null, bc = null;
  for (const x of n.slice(1)) {
    const g = enable(x, off, level), c = [g.length, -g.reduce((s, y) => s + (level.get(y) || 0), 0)];
    if (!best || c[0] < bc[0] || (c[0] === bc[0] && c[1] < bc[1])) { best = g; bc = c; }
  }
  return best;
}

export class ContextBuilder {
  /** @param tr TaskRunner (js/core/tasks.js) on the same model */
  constructor(tr, model) {
    this.tr = tr; this.model = model;
    const nR = (this.nR = model.rxns.length);
    // reactions that can be blocked: a GPR rule, and not the transport of a freely diffusing molecule
    this.asts = model.rxns.map((r) => (r.g && !r.removed && !isDiffusion(model, r) ? parseGpr(r.g) : null));
    this.genesOf = model.rxns.map((r) => (r.g ? [...new Set(r.g.match(/[^\s()]+/g).filter((w) => !/^(and|or)$/i.test(w)))] : []));
    this.rxnsOfGene = new Map();
    this.genesOf.forEach((gs, j) => gs.forEach((g) => { if (!this.rxnsOfGene.has(g)) this.rxnsOfGene.set(g, []); this.rxnsOfGene.get(g).push(j); }));
    this.freqW = new Float64Array(nR).fill(1e-3);
    this.pool = new Map(); // task -> recent flux supports known to be feasible (reused across contexts)
    this.nLp = 0; this.nRescueLp = 0;
  }

  /** Blocked reactions (0/1 per reaction) with the given genes off. */
  blockedOf(off) {
    const b = new Uint8Array(this.nR);
    for (let j = 0; j < this.nR; j++) if (this.asts[j] && !active(this.asts[j], off)) b[j] = 1;
    return b;
  }

  _solve(t, w, block) { return t.bounds ? this.tr.solveBounds(t.bounds, w, block) : this.tr.solve(t, w, block); }
  _support(v) { const s = []; for (let j = 0; j < this.nR; j++) if (v[j] !== 0) s.push(j); return Int32Array.from(s); }
  _addPool(t, v) { const p = this.pool.get(t) || []; p.unshift(this._support(v)); if (p.length > 25) p.pop(); this.pool.set(t, p); }

  /**
   * @param level  Map gene symbol -> expression (genes without data are absent and stay on)
   * @param thr    cut-off: genes with level < thr are switched off
   * @param tasks  tasks of the TaskRunner (or { desc, bounds } phenotype tasks)
   * @param onTask (index, total) progress callback
   * @returns { off: Set, nOff0, rescued: [[gene, task desc]], failed: [task desc], nBlocked }
   */
  build(level, thr, tasks, onTask) {
    const { nR, asts, genesOf, rxnsOfGene, freqW } = this;
    const off = new Set();
    for (const [g, x] of level) if (x < thr) off.add(g);
    const nOff0 = off.size;
    const blocked = this.blockedOf(off);
    const recompute = (genes) => {
      const rx = new Set(genes.flatMap((g) => rxnsOfGene.get(g) || []));
      for (const j of rx) if (asts[j]) blocked[j] = active(asts[j], off) ? 0 : 1;
    };
    const rescued = [], failed = [];
    tasks.forEach((t, ti) => {
      onTask?.(ti, tasks.length);
      if (!this.pool.has(t)) {
        const r0 = this._solve(t, freqW, null); this.nLp++;
        if (!r0.feasible) { failed.push(t.desc + " (fails in the full model)"); return; }
        this._addPool(t, r0.v);
      }
      if (this.pool.get(t).some((s) => s.every((j) => !blocked[j]))) return;
      let ok = false;
      for (let attempt = 0; attempt < 5 && !ok; attempt++) {
        const w = new Float64Array(nR);
        for (let j = 0; j < nR; j++) w[j] = blocked[j] ? BIG * (2 - Math.min(1, Math.max(...genesOf[j].map((g) => (off.has(g) ? level.get(g) || 0 : 0))) / thr)) : freqW[j];
        const rr = this._solve(t, w, null); this.nLp++;
        if (!rr.feasible) break;
        const turnOn = new Set();
        for (let j = 0; j < nR; j++) if (blocked[j] && Math.abs(rr.v[j]) > 1e-7) for (const g of enable(asts[j], off, level)) turnOn.add(g);
        if (!turnOn.size) { this._addPool(t, rr.v); ok = true; break; }
        this.nRescueLp++;
        for (const g of turnOn) { off.delete(g); rescued.push([g, t.desc]); }
        recompute([...turnOn]);
      }
      if (!ok) failed.push(t.desc);
    });
    return { off, nOff0, rescued, failed, nBlocked: blocked.reduce((s, x) => s + x, 0) };
  }
}
