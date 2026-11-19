// Flux balance analysis on top of HiGHS (WebAssembly).
// Works in a module Worker and in Node (tests).
//
// Every reaction j is split in a forward and a reverse part, v_j = f_j - r_j with f, r >= 0,
// so that parsimonious FBA (minimise total flux at optimal objective) stays a plain LP.

const INF = 1e30;

export class FbaProblem {
  /**
   * @param highs   loaded highs-js runtime
   * @param net     { nMets, nRxns, rxnMets: Int32Array[], rxnCoefs: Float64Array[] }
   */
  constructor(highs, net) {
    this.highs = highs;
    this.net = net;
    this.model = null;
    this.sourceKey = null;
  }

  dispose() {
    if (this.model) this.model.dispose();
    this.model = null;
  }

  /** Build the LP. `sources` are extra supply columns "-> metabolite" (injections). */
  _build(sources) {
    this.dispose();
    const { nMets, nRxns, rxnMets, rxnCoefs } = this.net;
    const nS = sources.length;
    const numCols = 2 * nRxns + nS;
    const numRows = nMets + 1; // + objective row
    let nnz = nS;
    for (let j = 0; j < nRxns; j++) nnz += rxnMets[j].length;
    nnz = 2 * nnz + 2; // objective row entries are patched per solve (max 2)
    const starts = new Int32Array(numCols + 1);
    const indices = new Int32Array(nnz);
    const values = new Float64Array(nnz);
    let k = 0;
    for (let half = 0; half < 2; half++) {
      const sign = half ? -1 : 1;
      for (let j = 0; j < nRxns; j++) {
        starts[half * nRxns + j] = k;
        const ms = rxnMets[j], cs = rxnCoefs[j];
        for (let q = 0; q < ms.length; q++) { indices[k] = ms[q]; values[k] = sign * cs[q]; k++; }
      }
    }
    for (let s = 0; s < nS; s++) {
      starts[2 * nRxns + s] = k;
      indices[k] = sources[s]; values[k] = 1; k++;
    }
    starts[numCols] = k;
    const rowLower = new Float64Array(numRows), rowUpper = new Float64Array(numRows);
    rowLower[nMets] = -INF; rowUpper[nMets] = INF;
    this.model = this.highs.createModel({
      numCols, numRows, sense: this.highs.constants.objectiveSense.minimize,
      colCost: new Float64Array(numCols),
      colLower: new Float64Array(numCols), colUpper: new Float64Array(numCols),
      rowLower, rowUpper,
      matrix: { format: "csc", numRows, numCols,
        starts, indices: indices.subarray(0, k), values: values.subarray(0, k) },
    });
    this.model.options.set({ output_flag: false, presolve: "on" });
    this.numCols = numCols;
    this.objRow = nMets;
    this.objCols = [];
  }

  /**
   * @param p { lb, ub: Float64Array(nRxns), objective: rxn index, maximize: bool,
   *            parsimonious: bool, sources: [{met, max}], penalty?: { rxns: Int32Array, w: number } }
   *            penalty: extra weight (1 + w) of those reactions in the parsimonious stage only
   *            secondary?: { rxn, maximize, frac }: after the objective, optimise reaction rxn while the objective
   *            keeps at least frac (0..1) of its optimum (an epsilon-constraint); pFBA then keeps that value.
   *            The result's objective is then the objective's flux in that solution, and secondary =
   *            { value, primaryOpt } (primaryOpt: the objective's optimum alone)
   * @returns { status, objective, v: Float64Array(nRxns), sourceFlux: Float64Array }
   */
  solve(p) {
    const { nRxns } = this.net;
    const sources = p.sources || [];
    const key = sources.map((s) => s.met).join(",");
    if (!this.model || key !== this.sourceKey) { this._build(sources.map((s) => s.met)); this.sourceKey = key; }
    const M = this.model, H = this.highs, n2 = 2 * nRxns;
    const lo = new Float64Array(this.numCols), up = new Float64Array(this.numCols);
    for (let j = 0; j < nRxns; j++) {
      const lb = p.lb[j], ub = p.ub[j];
      lo[j] = Math.max(lb, 0); up[j] = Math.max(ub, 0);
      lo[nRxns + j] = Math.max(-ub, 0); up[nRxns + j] = Math.max(-lb, 0);
    }
    sources.forEach((s, i) => { up[n2 + i] = s.max; });
    const all = { kind: "range", from: 0, to: this.numCols - 1 };
    M.changeColsBounds(all, lo, up);

    // objective row: obj = f_o - r_o
    for (const c of this.objCols) M.changeCoefficient(this.objRow, c, 0);
    const o = p.objective;
    this.objCols = [o, nRxns + o];
    M.changeCoefficient(this.objRow, o, 1);
    M.changeCoefficient(this.objRow, nRxns + o, -1);
    M.changeRowBounds(this.objRow, -INF, INF);

    const sign = p.maximize === false ? 1 : -1; // we always minimise
    const cost = new Float64Array(this.numCols);
    cost[o] = sign; cost[nRxns + o] = -sign;
    M.changeColsCost(all, cost);
    M.clearSolver(); // a cold start with presolve is ~4x faster than HiGHS warm start here
    M.run();
    const optimal = H.constants.modelStatus.optimal;
    let status = M.getModelStatus();
    if (status !== optimal) return { status: this._statusName(status), objective: 0, v: new Float64Array(nRxns), sourceFlux: new Float64Array(sources.length) };
    const objective = sign * M.getObjectiveValue() || 0;
    let sol1 = null;
    try { sol1 = M.getSolution(); } catch { /* no duals */ }
    const limits = this._limits(sol1, lo, up, sign, o, n2, sources);
    // value of each metabolite for the objective: objective gained per mmol/gDW/h of it supplied for free
    // (minus the shadow price of its mass balance; degenerate LPs have several valid sets of prices)
    const metValue = new Float32Array(this.net.nMets);
    if (sol1?.rowDual) for (let i = 0; i < this.net.nMets; i++) { const y = -sign * sol1.rowDual[i]; metValue[i] = Math.abs(y) < 1e-9 ? 0 : y; }
    if (p.fva !== undefined) {
      const many = Array.isArray(p.fva), r = this._ranges(M, many ? p.fva : [p.fva], objective, sign, p.fvaFrac ?? 1, !!p.fvaSolutions, p.fvaCycles ?? null);
      return { status: "optimal", objective, range: many ? undefined : r.ranges[0], ranges: r.ranges, solutions: r.solutions, v: new Float64Array(nRxns), sourceFlux: new Float64Array(sources.length) };
    }

    // secondary objective: the first objective is held by a temporary row, the objective row moves to the second
    let stageObj = objective, stageSign = sign, secondary = null, extraRow = -1;
    const dropRow = () => { if (extraRow >= 0) { M.deleteRows({ kind: "range", from: extraRow, to: extraRow }); extraRow = -1; } };
    if (p.secondary && p.secondary.rxn !== o && p.secondary.rxn >= 0) {
      const s = p.secondary, f = Math.min(1, Math.max(0, s.frac ?? 1)), tol = Math.max(1e-9, Math.abs(objective) * 1e-7);
      const keepLo = sign < 0 ? objective - (1 - f) * Math.abs(objective) - tol : -INF;
      const keepUp = sign < 0 ? INF : objective + (1 - f) * Math.abs(objective) + tol;
      M.addRow(keepLo, keepUp, { indices: Int32Array.of(o, nRxns + o), values: Float64Array.of(1, -1) });
      extraRow = this.net.nMets + 1;
      M.changeCoefficient(this.objRow, o, 0); M.changeCoefficient(this.objRow, nRxns + o, 0);
      const q = s.rxn;
      this.objCols = [q, nRxns + q];
      M.changeCoefficient(this.objRow, q, 1); M.changeCoefficient(this.objRow, nRxns + q, -1);
      stageSign = s.maximize === false ? 1 : -1;
      cost.fill(0); cost[q] = stageSign; cost[nRxns + q] = -stageSign;
      M.changeColsCost(all, cost);
      M.clearSolver(); M.run();
      status = M.getModelStatus();
      if (status !== optimal) { dropRow(); return { status: this._statusName(status), objective, v: new Float64Array(nRxns), sourceFlux: new Float64Array(sources.length) }; }
      stageObj = stageSign * M.getObjectiveValue() || 0;
      secondary = { value: stageObj, primaryOpt: objective };
    }

    if (p.parsimonious !== false) {
      const slack = Math.max(1e-9, Math.abs(stageObj) * 1e-6);
      if (stageSign < 0) M.changeRowBounds(this.objRow, stageObj - slack, INF);
      else M.changeRowBounds(this.objRow, -INF, stageObj + slack);
      const pc = this.net.pcost;
      for (let j = 0; j < nRxns; j++) cost[j] = cost[nRxns + j] = pc ? pc[j] : 1;
      if (p.penalty) for (const j of p.penalty.rxns) cost[j] = cost[nRxns + j] = cost[j] * (1 + p.penalty.w);
      for (let i = n2; i < this.numCols; i++) cost[i] = 0;
      M.changeColsCost(all, cost);
      M.clearSolver();
      M.run();
      status = M.getModelStatus();
      if (status !== optimal) { dropRow(); return { status: this._statusName(status), objective, v: new Float64Array(nRxns), sourceFlux: new Float64Array(sources.length) }; }
    }
    const x = M.getSolution().colValue;
    dropRow();
    const v = new Float64Array(nRxns);
    for (let j = 0; j < nRxns; j++) {
      const val = x[j] - x[nRxns + j];
      v[j] = Math.abs(val) < 1e-9 ? 0 : val;
    }
    // with a secondary objective, the objective reported is the first objective's flux in this solution
    return { status: "optimal", objective: secondary ? v[o] : objective, secondary, v, sourceFlux: Float64Array.from(sources, (_, i) => x[n2 + i]), limits, metValue };
  }

  /**
   * Bounds that limit the objective, from the reduced costs of the first (FBA) stage. A column at a bound with
   * reduced cost d changes the minimised cost by d per unit the bound moves, so the objective gains sign * d per
   * unit an upper bound rises and -sign * d per unit a positive lower bound falls. Degenerate LPs have several dual
   * solutions: the list is one valid explanation, not the only one.
   * @returns [{ j (reaction, or -1 - i for injection i), half: 1 forward / -1 reverse, kind: "ub" | "lb" | "closed", gain }]
   */
  _limits(sol, lo, up, sign, o, n2, sources, top = 12) {
    if (!sol) return [];
    const d = sol.colDual, x = sol.colValue, nR = this.net.nRxns, out = [];
    if (!d) return [];
    for (let c = 0; c < this.numCols; c++) {
      const j = c < n2 ? c % nR : -1 - (c - n2);
      if (j === o) continue;
      const dc = d[c];
      if (!Number.isFinite(dc) || Math.abs(dc) < 1e-9) continue;
      const tol = 1e-7 * Math.max(1, Math.abs(up[c])), atUp = up[c] < INF / 2 && Math.abs(x[c] - up[c]) <= tol, atLo = lo[c] > 0 && Math.abs(x[c] - lo[c]) <= tol;
      let kind = null, gain = 0;
      if (atUp && up[c] === 0 && lo[c] === 0) {
        // only a closure the published model does not have (cell type, knockout, edit), and not an exchange
        const net = this.net, half = c < nR ? 1 : -1;
        if (j < 0 || !net.lb0 || net.rxnMets[j].length < 2 || (half > 0 ? net.ub0[j] <= 0 : net.lb0[j] >= 0)) continue;
        kind = "closed"; gain = sign * dc;
      }
      else if (atUp && up[c] > 0) { kind = "ub"; gain = sign * dc; }
      else if (atLo) { kind = "lb"; gain = -sign * dc; }
      if (!kind || gain <= 1e-9) continue;
      out.push({ j, half: c < n2 && c >= nR ? -1 : 1, kind, gain });
    }
    out.sort((a, b) => b.gain - a.gain);
    return out.slice(0, top);
  }

  /**
   * Flux variability: min and max of v_j for each j with the objective held at frac of its optimum (frac = 1: at
   * the optimum within 1e-6). Warm starts between the LPs, with a cold retry if HiGHS fails.
   * @returns { ranges: [[min, max]], solutions?: [[vmin, vmax]] (full flux vectors, when asked) }
   */
  _ranges(M, list, objective, sign, frac = 1, withSolutions = false, cycleSlack = null) {
    const { nRxns } = this.net, H = this.highs, all = { kind: "range", from: 0, to: this.numCols - 1 };
    const opt = H.constants.modelStatus.optimal;
    const slack = Math.max(1e-9, Math.abs(objective) * 1e-6);
    const target = frac < 1 ? objective * frac : objective;
    if (sign < 0) M.changeRowBounds(this.objRow, (frac < 1 ? target : objective - slack), INF);
    else M.changeRowBounds(this.objRow, -INF, (frac < 1 ? target : objective + slack));
    const ranges = [], solutions = withSolutions ? [] : null;
    const cost = new Float64Array(this.numCols);
    // Without cycles: internal loops (thermodynamically impossible cycles) can carry any flux without changing the
    // objective and make FVA ranges look wide. Optionally the total flux (the pFBA measure) is capped at its minimum
    // + cycleSlack, which removes them; the extra row is deleted afterwards.
    let extraRow = -1;
    if (cycleSlack !== null) {
      const pc = this.net.pcost;
      for (let j = 0; j < nRxns; j++) cost[j] = cost[nRxns + j] = pc ? pc[j] : 1;
      M.changeColsCost(all, cost); M.clearSolver(); M.run();
      if (M.getModelStatus() === opt) {
        const T = M.getObjectiveValue(), idx = new Int32Array(2 * nRxns), val = new Float64Array(2 * nRxns);
        for (let j = 0; j < nRxns; j++) { idx[j] = j; idx[nRxns + j] = nRxns + j; val[j] = val[nRxns + j] = pc ? pc[j] : 1; }
        M.addRow(-Infinity, T * (1 + cycleSlack) + 1e-9, { indices: idx, values: val });
        extraRow = this.net.nMets + 1;
      }
    }
    M.options.set({ presolve: "off", simplex_strategy: 4 }); // only the cost changes: primal simplex from the last basis is fast
    for (const j of list) {
      const r = [], sol = [];
      for (const dir of [1, -1]) { // minimise v_j, then maximise it
        cost.fill(0); cost[j] = dir; cost[nRxns + j] = -dir;
        M.changeColsCost(all, cost);
        let st;
        try { M.run(); st = M.getModelStatus(); } catch { st = -1; }
        if (st !== opt) { try { M.clearSolver(); M.run(); st = M.getModelStatus(); } catch { st = -1; } }
        r.push(st === opt ? dir * M.getObjectiveValue() : -dir * Infinity);
        if (withSolutions) {
          if (st === opt) { const x = M.getSolution().colValue, v = new Float64Array(nRxns); for (let k = 0; k < nRxns; k++) v[k] = x[k] - x[nRxns + k]; sol.push(v); }
          else sol.push(null);
        }
      }
      ranges.push(r);
      if (withSolutions) solutions.push(sol);
    }
    M.options.set({ presolve: "on", simplex_strategy: 1 }); // back to the default (dual) for the next FBA
    if (extraRow >= 0) M.deleteRows({ kind: "range", from: extraRow, to: extraRow });
    return { ranges, solutions };
  }

  _statusName(code) {
    const ms = this.highs.constants.modelStatus;
    for (const k in ms) if (ms[k] === code) return k;
    return String(code);
  }
}

/** Pack model.json reactions into the typed layout used by FbaProblem. */
export function packNetwork(model) {
  return {
    nMets: model.mets.length,
    nRxns: model.rxns.length,
    rxnMets: model.rxns.map((r) => Int32Array.from(r.m)),
    rxnCoefs: model.rxns.map((r) => Float64Array.from(r.c)),
    pcost: parsimonyCosts(model),
    lb0: Float64Array.from(model.rxns, (r) => r.lb), ub0: Float64Array.from(model.rxns, (r) => r.ub), // published bounds
  };
}

// Deoxynucleotides and the ribonucleotide each one stands in for.
const DEOXY = { dATP: "ATP", dADP: "ADP", dAMP: "AMP", dGTP: "GTP", dGDP: "GDP", dGMP: "GMP",
  dCTP: "CTP", dCDP: "CDP", dCMP: "CMP", dUTP: "UTP", dUDP: "UDP", dUMP: "UMP" };
export const DEOXY_PENALTY = 1e-3;

/**
 * Weight of each reaction in the parsimonious (second) stage: 1, or 1 + DEOXY_PENALTY for a reaction that
 * is a copy of another one with a deoxynucleotide in place of the ribonucleotide (hexokinase with dATP,
 * pyruvate kinase with dADP...). Without it pFBA picks either copy at the same cost, and a dATP/dADP cycle
 * can stand in for ATP/ADP in glycolysis. Deoxynucleotides are ~1 % of the ribonucleotide pools in cells.
 */
export function parsimonyCosts(model) {
  const { mets, bases, rxns } = model;
  const w = new Float64Array(rxns.length).fill(1);
  const byName = new Map(bases.map((b, i) => [b.n, i]));
  const swap = new Map(); // base index of a deoxynucleotide -> base index of its ribonucleotide
  for (const [d, r] of Object.entries(DEOXY)) if (byName.has(d) && byName.has(r)) swap.set(byName.get(d), byName.get(r));
  if (!swap.size) return w;
  const metKey = new Map(mets.map((m, i) => [m.b + "|" + m.c, i]));
  const sig = (pairs) => pairs.map(([m, c]) => `${m}:${+c.toFixed(6)}`).sort().join(" ");
  const sigs = new Set(rxns.map((r) => (r.removed ? "" : sig(r.m.map((m, q) => [m, r.c[q]])))));
  const ribo = new Set(swap.values());
  rxns.forEach((r, j) => {
    // only reactions where the deoxynucleotides do the ribonucleotides' job: none of those present
    if (r.removed || r.m.length < 2 || !r.m.some((m) => swap.has(mets[m].b)) || r.m.some((m) => ribo.has(mets[m].b))) return;
    const twin = r.m.map((m, q) => {
      const b = swap.get(mets[m].b);
      return [b === undefined ? m : metKey.get(b + "|" + mets[m].c) ?? -1, r.c[q]];
    });
    if (twin.every(([m]) => m >= 0) && sigs.has(sig(twin))) w[j] = 1 + DEOXY_PENALTY;
  });
  return w;
}
