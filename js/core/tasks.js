// Shared by the app (custom cell types from RNA-seq, in a worker) and tools/contexts/build_contexts.mjs.
// Metabolic tasks in the RAVEN task-list format (Human-GEM data/metabolicTasks/*.txt) on top of FbaProblem.
//
// Semantics as in RAVEN checkTasks with closed boundaries: every exchange/sink/demand reaction of the model is
// closed, each task opens temporary exchanges for its IN and OUT metabolites (default bounds 0..1000) and may
// add an EQU reaction with its own bounds. "ALLMETSIN[e]" lets every metabolite of that compartment leave.
// A metabolite listed both IN and OUT gets one net exchange: uptake - secretion in [inLB - outUB, inUB - outLB].

import { FbaProblem } from "./fba.js";

const BIG = 1000;

export function parseTasks(text) {
  const tasks = [];
  let cur = null;
  for (const raw of text.split(/\r?\n/)) {
    const c = raw.split("\t");
    if (c[0] === "#" || c[1] === "ID") { if (c[0] === "#") cur = null; continue; }
    if (c.slice(1).every((x) => !x || !x.trim())) continue;
    if (c[1]) { cur = { id: c[1], desc: c[2].trim(), shouldFail: !!c[3], rows: [] }; tasks.push(cur); }
    if (!cur) continue;
    const num = (x, d) => (x && x.trim() !== "" ? +x : d);
    cur.rows.push({
      in: c[4] ? c[4].split(";").map((s) => s.trim()).filter(Boolean) : [], inLB: num(c[5], 0), inUB: num(c[6], BIG),
      out: c[7] ? c[7].split(";").map((s) => s.trim()).filter(Boolean) : [], outLB: num(c[8], 0), outUB: num(c[9], BIG),
      equ: c[10] ? c[10].trim() : "", equLB: num(c[11], null), equUB: num(c[12], BIG),
    });
  }
  return tasks;
}

/** Extended network: model reactions + one exchange column per task metabolite + EQU reactions + a dummy. */
export class TaskRunner {
  constructor(highs, model, tasks) {
    this.model = model;
    const metKey = new Map(model.mets.map((m, i) => [model.bases[m.b].n + "[" + m.c + "]", i]));
    const nR = model.rxns.length;
    const rxnMets = model.rxns.map((r) => Int32Array.from(r.m)), rxnCoefs = model.rxns.map((r) => Float64Array.from(r.c));
    // boundary reactions of the model (only one side): closed during tasks
    this.boundary = model.rxns.map((r, j) => j).filter((j) => { const c = model.rxns[j].c; return c.every((x) => x > 0) || c.every((x) => x < 0); });
    this.exCol = new Map(); // met -> column
    const addCol = (ms, cs) => { rxnMets.push(Int32Array.from(ms)); rxnCoefs.push(Float64Array.from(cs)); return rxnMets.length - 1; };
    const exFor = (m) => { if (!this.exCol.has(m)) this.exCol.set(m, addCol([m], [1])); return this.exCol.get(m); };
    this.missing = new Set();
    const met = (s) => { const i = metKey.get(s); if (i === undefined) this.missing.add(s); return i; };
    this.compMets = (c) => model.mets.map((m, i) => (m.c === c ? i : -1)).filter((i) => i >= 0);
    this.tasks = tasks.map((t) => {
      const ex = new Map(); // met -> {inLB,inUB,outLB,outUB}
      const equs = []; let bad = false;
      for (const r of t.rows) {
        for (const s of r.in) { const m = met(s); if (m === undefined) { bad = true; continue; } const e = ex.get(m) || {}; e.inLB = (e.inLB || 0) + r.inLB; e.inUB = Math.min(BIG, (e.inUB || 0) + r.inUB); ex.set(m, e); }
        for (const s of r.out) {
          const all = /^ALLMETSIN\[(\w+)\]$/.exec(s);
          const ms = all ? this.compMets(all[1]) : [met(s)];
          for (const m of ms) { if (m === undefined) { bad = true; continue; } const e = ex.get(m) || {}; e.outLB = (e.outLB || 0) + (all ? 0 : r.outLB); e.outUB = Math.min(BIG, (e.outUB || 0) + (all ? BIG : r.outUB)); ex.set(m, e); }
        }
        if (r.equ) {
          const q = this._parseEqu(r.equ, met);
          if (!q) { bad = true; continue; }
          const col = addCol(q.ms, q.cs);
          equs.push({ col, lb: r.equLB ?? (q.rev ? -BIG : 0), ub: r.equUB });
        }
      }
      const exb = [...ex].map(([m, e]) => {
        const col = exFor(m);
        return { col, lb: (e.inLB || 0) - (e.outUB || 0), ub: (e.inUB || 0) - (e.outLB || 0) };
      });
      return { ...t, ex: exb, equs, bad };
    });
    this.dummy = addCol([], []);
    this.nCols = rxnMets.length;
    this.net = { nMets: model.mets.length, nRxns: this.nCols, rxnMets, rxnCoefs, pcost: new Float64Array(this.nCols) };
    this.fba = new FbaProblem(highs, this.net); this.highs = highs;
    this.baseLb = new Float64Array(this.nCols); this.baseUb = new Float64Array(this.nCols);
    model.rxns.forEach((r, j) => { this.baseLb[j] = r.lb; this.baseUb[j] = r.ub; });
    for (const j of this.boundary) this.baseLb[j] = this.baseUb[j] = 0;
    this.nModel = nR;
  }

  _parseEqu(s, met) {
    const rev = s.includes("<=>"), parts = s.split(/<=>|=>/);
    if (parts.length !== 2) return null;
    const ms = [], cs = [];
    const side = (txt, sign) => {
      for (const term of txt.split(" + ").map((x) => x.trim()).filter(Boolean)) {
        const m0 = /^([\d.]+)\s+(.*)$/.exec(term);
        const coef = m0 ? +m0[1] : 1, name = m0 ? m0[2] : term;
        const m = met(name); if (m === undefined) return false;
        ms.push(m); cs.push(sign * coef);
      }
      return true;
    };
    if (!side(parts[0], -1) || !side(parts[1], 1)) return null;
    return { ms, cs, rev };
  }

  /** Bounds of the extended network for a task (model boundary reactions closed, task exchanges/EQU open). */
  bounds(task) {
    const lb = Float64Array.from(this.baseLb), ub = Float64Array.from(this.baseUb);
    for (const e of task.ex) { lb[e.col] = e.lb; ub[e.col] = e.ub; }
    for (const q of task.equs) { lb[q.col] = q.lb; ub[q.col] = q.ub; }
    return { lb, ub };
  }

  /** Model bounds (as the app computes them, length nModel) on the extended network: extra columns closed. */
  modelBounds(mlb, mub) {
    const lb = new Float64Array(this.nCols), ub = new Float64Array(this.nCols);
    lb.set(mlb); ub.set(mub);
    return { lb, ub };
  }

  /**
   * Single-stage LP on the HiGHS model: minimise sum(weights * |v|) over the model reactions, or (no weights)
   * just test feasibility. Blocked reactions are fixed at 0. Warm start without presolve is the fastest here.
   */
  solveBounds({ lb: lb0, ub: ub0 }, weights, block, { warm = true, presolve = "off" } = {}) {
    const F = this.fba, n = this.nCols;
    if (!F.model) { F._build([]); F.sourceKey = ""; }
    const M = F.model, H = this.highs;
    const lb = Float64Array.from(lb0), ub = Float64Array.from(ub0);
    if (block) for (const j of block) lb[j] = ub[j] = 0;
    const lo = new Float64Array(2 * n), up = new Float64Array(2 * n), cost = new Float64Array(2 * n);
    for (let j = 0; j < n; j++) {
      lo[j] = Math.max(lb[j], 0); up[j] = Math.max(ub[j], 0); lo[n + j] = Math.max(-ub[j], 0); up[n + j] = Math.max(-lb[j], 0);
      if (weights && j < this.nModel) cost[j] = cost[n + j] = weights[j];
    }
    const all = { kind: "range", from: 0, to: 2 * n - 1 };
    M.changeColsBounds(all, lo, up); M.changeColsCost(all, cost);
    M.changeRowBounds(F.objRow ?? this.net.nMets, -1e30, 1e30);
    M.options.set({ presolve });
    if (!warm) M.clearSolver();
    // HiGHS occasionally fails (status -1) on a warm start: retry cold, then on a freshly built model
    const tryRun = () => { try { M.run(); return M.getModelStatus(); } catch { return -1; } };
    let st = tryRun();
    if (st !== H.constants.modelStatus.optimal && warm) { M.clearSolver(); M.options.set({ presolve: "on" }); st = tryRun(); }
    if (st === -1) {
      F._build([]); F.sourceKey = "";
      const M2 = F.model; M2.changeColsBounds(all, lo, up); M2.changeColsCost(all, cost); M2.options.set({ presolve: "on" });
      try { M2.run(); } catch { return { feasible: false }; }
      if (M2.getModelStatus() !== H.constants.modelStatus.optimal) return { feasible: false };
      return this._result(M2, n, weights);
    }
    if (st !== H.constants.modelStatus.optimal) return { feasible: false };
    return this._result(M, n, weights);
  }

  _result(M, n, weights) {
    const x = M.getSolution().colValue, v = new Float64Array(this.nModel);
    for (let j = 0; j < this.nModel; j++) { const d = x[j] - x[n + j]; v[j] = Math.abs(d) < 1e-9 ? 0 : d; }
    return { feasible: true, cost: weights ? M.getObjectiveValue() : 0, v };
  }

  solve(task, weights, block, opts) { return this.solveBounds(this.bounds(task), weights, block, opts); }
}
