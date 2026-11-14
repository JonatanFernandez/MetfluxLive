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
   *            parsimonious: bool, sources: [{met, max}] }
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

    if (p.parsimonious !== false) {
      const slack = Math.max(1e-9, Math.abs(objective) * 1e-6);
      if (sign < 0) M.changeRowBounds(this.objRow, objective - slack, INF);
      else M.changeRowBounds(this.objRow, -INF, objective + slack);
      const pc = this.net.pcost;
      for (let j = 0; j < nRxns; j++) cost[j] = cost[nRxns + j] = pc ? pc[j] : 1;
      for (let i = n2; i < this.numCols; i++) cost[i] = 0;
      M.changeColsCost(all, cost);
      M.clearSolver();
      M.run();
      status = M.getModelStatus();
      if (status !== optimal) return { status: this._statusName(status), objective, v: new Float64Array(nRxns), sourceFlux: new Float64Array(sources.length) };
    }
    const x = M.getSolution().colValue;
    const v = new Float64Array(nRxns);
    for (let j = 0; j < nRxns; j++) {
      const val = x[j] - x[nRxns + j];
      v[j] = Math.abs(val) < 1e-9 ? 0 : val;
    }
    return { status: "optimal", objective, v, sourceFlux: Float64Array.from(sources, (_, i) => x[n2 + i]) };
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
