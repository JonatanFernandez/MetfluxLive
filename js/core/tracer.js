// Isotope label propagation on a flux distribution.
//
// Every heavy atom of every metabolite is a variable holding its enrichment (0..1).
// For a metabolite pool of size A that receives atoms through reactions,
//     d(A*e)/dt = sum_in( flux * e_source ) - outflow * e
// With atom-to-atom transitions the right-hand side is linear in the source atoms, so
// positional enrichments can be solved exactly without enumerating isotopomers.
//   - isotopic steady state: e = sum_in(flux * e_source) / sum_in(flux)
//   - dynamic: implicit Euler step, e_new = (A*e_old + dt*in_label) / (A + dt*in_total)
//
// Atoms without a transition (reaction not mapped, metabolite without structure) receive
// the mean enrichment of the unmapped substrate atoms of the same element ("mixing pool");
// metabolites that got label this way are flagged as position-uncertain.

const EL = { "*": 0, C: 1, N: 2, O: 3, H: 4, S: 5, P: 6 };
const elCode = (s) => EL[s] ?? 7;

function carbonCount(formula) {
  const m = /C(?![a-z])(\d*)/.exec(formula || "");
  return m ? Math.max(1, parseInt(m[1] || "1", 10)) : 1;
}

export class Tracer {
  constructor(model, structures, atommaps) {
    this.model = model;
    this.maps = atommaps || {};
    const nb = model.bases.length;
    this.baseN = new Int32Array(nb);
    this.basePseudo = new Uint8Array(nb);
    this.baseW = new Float64Array(nb); // weight of a pseudo-atom (carbon count)
    this.baseEl = new Array(nb);
    this.baseSym = new Array(nb);
    model.bases.forEach((b, i) => {
      const s = structures[b.id];
      if (s) {
        this.baseN[i] = s.e.length;
        this.baseEl[i] = Uint8Array.from(s.e, elCode);
        this.baseSym[i] = s.sym || null;
        this.baseW[i] = 1;
      } else {
        this.baseN[i] = 1;
        this.basePseudo[i] = 1;
        this.baseEl[i] = Uint8Array.of(0);
        this.baseW[i] = carbonCount(b.f);
      }
    });
    const nm = model.mets.length;
    this.off = new Int32Array(nm + 1);
    for (let i = 0; i < nm; i++) this.off[i + 1] = this.off[i] + this.baseN[model.mets[i].b];
    this.nAtoms = this.off[nm];
    // symmetric (rotationally equivalent) atoms share one variable: the orbit representative
    this.rep = new Int32Array(this.nAtoms);
    this.orbit = new Float32Array(this.nAtoms).fill(1);
    this.metOfAtom = new Int32Array(this.nAtoms);
    for (let i = 0; i < nm; i++) {
      const o = this.off[i], n = this.off[i + 1] - o;
      for (let a = 0; a < n; a++) { this.rep[o + a] = o + a; this.metOfAtom[o + a] = i; }
      const sym = this.baseSym[model.mets[i].b];
      if (sym) for (const g of sym) for (const a of g) { this.rep[o + a] = o + g[0]; this.orbit[o + a] = g.length; }
    }
  }

  atomsOf(met) { return this.baseN[this.model.mets[met].b]; }

  /**
   * Build the propagation program for a flux distribution.
   * @param v       Float64Array of reaction fluxes
   * @param inputs  [{ met, flux, label: Float64Array(nAtoms)|null }] uptake / injections entering `met`
   */
  compile(v, inputs, eps = 1e-9) {
    const { model, off } = this;
    const mets = model.mets, rxns = model.rxns;
    const rp = this.rep, orb = this.orbit, nA = this.nAtoms;
    // edge list; pushes go through `edge` so symmetric atoms collapse onto their representative
    const eSrc = [], eDst = [], eW = [];
    const edge = (s, d, wt) => {
      eSrc.push(s < nA ? rp[s] : s);
      if (d < nA) { eDst.push(rp[d]); eW.push(wt / orb[d]); } else { eDst.push(d); eW.push(wt); }
    };
    const den = new Float64Array(mets.length); // total inflow per metabolite (mmol/gDW/h)
    const consts = []; // constant label values, addressed as negative-less extra variables
    const poolDefs = []; // per pool variable: nothing extra, edges carry normalised weights
    let nVar = this.nAtoms;
    const newVar = () => nVar++;
    const metIn = new Map(); // met -> Set of source mets (for ordering)
    const link = (a, b) => { let s = metIn.get(b); if (!s) metIn.set(b, (s = new Set())); s.add(a); };
    const poolEdge = []; // indices of edges that come out of a mixing pool
    const active = new Uint8Array(mets.length);

    for (const inp of inputs) {
      if (!(inp.flux > eps)) continue;
      den[inp.met] += inp.flux;
      active[inp.met] = 1;
      if (!inp.label) continue;
      const n = this.atomsOf(inp.met);
      for (let a = 0; a < n; a++) {
        if (!inp.label[a]) continue;
        const c = newVar();
        consts.push([c, inp.label[a]]);
        edge(c, off[inp.met] + a, inp.flux);
      }
    }

    for (let j = 0; j < rxns.length; j++) {
      const flux = Math.abs(v[j]);
      if (flux <= eps) continue;
      const r = rxns[j];
      if (r.m.length < 2) continue;
      const fwd = v[j] > 0;
      const nLoc = r.m.length;
      const isSub = new Uint8Array(nLoc);
      let hasS = false, hasP = false;
      for (let q = 0; q < nLoc; q++) {
        isSub[q] = (r.c[q] < 0) === fwd ? 1 : 0;
        if (isSub[q]) hasS = true; else hasP = true;
      }
      if (!hasS || !hasP) continue;
      // per-local used counters
      const used = new Array(nLoc);
      for (let q = 0; q < nLoc; q++) used[q] = new Float32Array(this.atomsOf(r.m[q]));
      for (let q = 0; q < nLoc; q++) if (!isSub[q]) { den[r.m[q]] += flux * Math.abs(r.c[q]); active[r.m[q]] = 1; }

      const map = this.maps[r.id];
      if (map) {
        for (const seg of map.s) {
          // segments are stored substrate->product for the forward direction
          const sl = fwd ? seg[0] : seg[1], pl = fwd ? seg[1] : seg[0];
          if (!isSub[sl] || isSub[pl]) continue;
          const sm = r.m[sl], pm = r.m[pl];
          const pairs = seg[2];
          link(sm, pm);
          const mult = seg[3] ?? 1;
          if (pairs === -1) {
            const n = Math.min(used[sl].length, used[pl].length);
            const copies = seg[3] ?? Math.min(Math.abs(r.c[sl]), Math.abs(r.c[pl]));
            for (let a = 0; a < n; a++) {
              edge(off[sm] + a, off[pm] + a, flux * copies);
              used[sl][a] += copies; used[pl][a] += copies;
            }
          } else {
            for (let k = 0; k < pairs.length; k += 2) {
              const sa = fwd ? pairs[k] : pairs[k + 1], pa = fwd ? pairs[k + 1] : pairs[k];
              if (sa >= used[sl].length || pa >= used[pl].length) continue;
              edge(off[sm] + sa, off[pm] + pa, flux * mult);
              used[sl][sa] += mult; used[pl][pa] += mult;
            }
          }
        }
      }
      // leftovers -> mixing pools per element class (pseudo-atoms join the carbon class)
      const cls = (code) => (code === 0 ? 1 : code);
      let need = null;
      for (let q = 0; q < nLoc; q++) {
        if (isSub[q]) continue;
        const coef = Math.abs(r.c[q]), el = this.baseEl[mets[r.m[q]].b];
        for (let a = 0; a < el.length; a++) {
          const left = coef - used[q][a];
          if (left > 1e-6 && el[a] !== 7 && el[a] !== 4) (need ||= []).push([q, a, left, cls(el[a])]);
        }
      }
      if (!need) continue;
      const pools = new Map(); // class -> { var, items: [[srcVar, mult]], total }
      for (let q = 0; q < nLoc; q++) {
        if (!isSub[q]) continue;
        const coef = Math.abs(r.c[q]), b = mets[r.m[q]].b, el = this.baseEl[b];
        for (let a = 0; a < el.length; a++) {
          const left = coef - used[q][a];
          if (left <= 1e-6 || el[a] === 7 || el[a] === 4) continue;
          const c = cls(el[a]);
          let p = pools.get(c);
          if (!p) pools.set(c, (p = { items: [], total: 0, mets: new Set() }));
          const mult = left * (el[a] === 0 ? this.baseW[b] : 1);
          p.items.push([off[r.m[q]] + a, mult]);
          p.total += mult;
          p.mets.add(r.m[q]);
        }
      }
      for (const [, p] of pools) {
        p.v = newVar();
        poolDefs.push(p.v);
        for (const [src, mult] of p.items) edge(src, p.v, mult / p.total);
      }
      for (const [q, a, left, c] of need) {
        const p = pools.get(c);
        if (!p) continue;
        poolEdge.push(eSrc.length);
        edge(p.v, off[r.m[q]] + a, flux * left);
        for (const sm of p.mets) link(sm, r.m[q]);
      }
    }

    // CSR by destination
    const nE = eSrc.length;
    const start = new Int32Array(nVar + 1);
    for (let i = 0; i < nE; i++) start[eDst[i] + 1]++;
    for (let i = 0; i < nVar; i++) start[i + 1] += start[i];
    const fill = start.slice(0, nVar), src = new Int32Array(nE), w = new Float64Array(nE), fromPool = new Uint8Array(nE);
    const poolSet = new Set(poolEdge);
    for (let i = 0; i < nE; i++) {
      const p = fill[eDst[i]]++;
      src[p] = eSrc[i]; w[p] = eW[i]; fromPool[p] = poolSet.has(i) ? 1 : 0;
    }
    const prog = { nVar, start, src, w, fromPool, den, consts, pools: Int32Array.from(poolDefs), metIn, active, inputs };
    this._components(prog);
    return prog;
  }

  /**
   * Strongly connected components of the variable dependency graph (Tarjan, iterative),
   * emitted so that every component comes after the ones it depends on. Solving component
   * by component turns recycling loops (TCA, ATP/ADP, cofactors) into small exact solves.
   */
  _components(prog) {
    const { nVar, start, src, den } = prog, nA = this.nAtoms, rp = this.rep, moa = this.metOfAtom;
    const isUnknown = (k) => (k < nA ? rp[k] === k && den[moa[k]] > 0 : start[k + 1] > start[k]);
    const index = new Int32Array(nVar).fill(-1), low = new Int32Array(nVar), onStack = new Uint8Array(nVar);
    const stack = [], comps = [], callK = [], callP = [];
    let counter = 0;
    for (let root = 0; root < nVar; root++) {
      if (index[root] !== -1 || !isUnknown(root)) continue;
      callK.push(root); callP.push(start[root]);
      index[root] = low[root] = counter++; stack.push(root); onStack[root] = 1;
      while (callK.length) {
        const k = callK[callK.length - 1];
        let p = callP[callP.length - 1];
        let descended = false;
        while (p < start[k + 1]) {
          const s = src[p++];
          if (!isUnknown(s)) continue;
          if (index[s] === -1) {
            callP[callP.length - 1] = p;
            index[s] = low[s] = counter++; stack.push(s); onStack[s] = 1;
            callK.push(s); callP.push(start[s]);
            descended = true;
            break;
          } else if (onStack[s] && index[s] < low[k]) low[k] = index[s];
        }
        if (descended) continue;
        callK.pop(); callP.pop();
        if (callK.length) { const parent = callK[callK.length - 1]; if (low[k] < low[parent]) low[parent] = low[k]; }
        if (low[k] === index[k]) {
          const comp = [];
          let x;
          do { x = stack.pop(); onStack[x] = 0; comp.push(x); } while (x !== k);
          comps.push(comp);
        }
      }
    }
    prog.comps = comps;
    const labelIn = new Uint8Array(prog.den.length);
    for (const inp of prog.inputs) if (inp.label && inp.flux > 0) labelIn[inp.met] = 1;
  }

  /** Metabolites reachable from labelled inputs, in breadth-first order. */
  _order(prog) {
    const out = new Map(); // src met -> [dst mets]
    for (const [dst, set] of prog.metIn) for (const s of set) { let l = out.get(s); if (!l) out.set(s, (l = [])); l.push(dst); }
    const seen = new Set(), order = [];
    const queue = prog.inputs.filter((i) => i.label && i.flux > 0).map((i) => i.met);
    for (const m of queue) seen.add(m);
    while (queue.length) {
      const m = queue.shift();
      order.push(m);
      for (const d of out.get(m) || []) if (!seen.has(d)) { seen.add(d); queue.push(d); }
    }
    return order;
  }

  /**
   * Advance enrichments. dt = Infinity gives the isotopic steady state.
   * @param prog   compiled program
   * @param e0     previous enrichments (Float64Array, at least nAtoms long) or null = unlabelled
   * @param dt     hours
   * @param poolOf function(met) -> pool size (mmol/gDW); ignored for steady state
   */
  advance(prog, e0, dt, poolOf) {
    const nA = this.nAtoms, moa = this.metOfAtom, rp = this.rep;
    const { nVar, start, src, w, den, comps } = prog;
    const e = new Float64Array(nVar);
    if (e0) e.set(e0.subarray(0, nA));
    for (const [c, val] of prog.consts) e[c] = val;
    const steady = !isFinite(dt);
    const poolCache = new Map();
    const A = (k) => {
      if (steady || k >= nA) return 0;
      const m = moa[k];
      let v = poolCache.get(m);
      if (v === undefined) poolCache.set(m, (v = poolOf(m)));
      return v;
    };
    // diagonal and right-hand side pieces of   D*x - dtw * sum(w*x_src) = A*old
    const diag = (k) => (k >= nA ? 1 : steady ? den[moa[k]] : A(k) + dt * den[moa[k]]);
    const gain = (k) => (k >= nA || steady ? 1 : dt);
    const local = new Int32Array(nVar).fill(-1);
    let converged = true, largest = 0;
    for (const comp of comps) {
      const n = comp.length;
      if (n === 1) {
        const k = comp[0];
        let s = 0, self = 0;
        for (let p = start[k]; p < start[k + 1]; p++) { if (src[p] === k) self += w[p]; else s += w[p] * e[src[p]]; }
        const d = diag(k) - gain(k) * self;
        const rhs = A(k) * e[k] + gain(k) * s;
        e[k] = d > 1e-300 ? rhs / d : e[k];
        continue;
      }
      if (n > largest) largest = n;
      for (let i = 0; i < n; i++) local[comp[i]] = i;
      const rhs = new Float64Array(n);
      let external = 0, total = 0;
      for (let i = 0; i < n; i++) {
        const k = comp[i];
        let s = 0, internal = 0;
        for (let p = start[k]; p < start[k + 1]; p++) { if (local[src[p]] >= 0) internal += w[p]; else s += w[p] * e[src[p]]; }
        rhs[i] = A(k) * e[k] + gain(k) * s;
        const d = diag(k);
        total += d; external += d - gain(k) * internal;
      }
      if (external <= 1e-12 * total) {
        // closed loop with no inflow at all (e.g. a cofactor that is never synthesised): keeps its label
      } else if (n <= 600) {
        const M = new Float64Array(n * n);
        for (let i = 0; i < n; i++) {
          const k = comp[i];
          M[i * n + i] += diag(k);
          for (let p = start[k]; p < start[k + 1]; p++) { const j = local[src[p]]; if (j >= 0) M[i * n + j] -= gain(k) * w[p]; }
        }
        if (solveDense(M, rhs, n)) for (let i = 0; i < n; i++) e[comp[i]] = Math.min(1, Math.max(0, rhs[i]));
        else converged = false;
      } else {
        // large component: Gauss-Seidel inside it
        let delta = 1, sweep = 0;
        while (delta > 1e-10 && sweep++ < 5000) {
          delta = 0;
          for (let i = 0; i < n; i++) {
            const k = comp[i];
            let s = 0, self = 0;
            for (let p = start[k]; p < start[k + 1]; p++) { const q = src[p]; if (q === k) self += w[p]; else if (local[q] >= 0) s += w[p] * e[q]; }
            const val = (rhs[i] + gain(k) * s) / (diag(k) - gain(k) * self);
            const ch = Math.abs(val - e[k]);
            if (ch > delta) delta = ch;
            e[k] = val;
          }
        }
        if (delta > 1e-6) converged = false;
      }
      for (let i = 0; i < n; i++) local[comp[i]] = -1;
    }
    // expand symmetric atoms from their representatives
    for (let k = 0; k < nA; k++) if (rp[k] !== k) e[k] = e[rp[k]];
    const order = prog.order || (prog.order = this._order(prog));
    return { e, order, converged, largest };
  }

  /**
   * Per-metabolite summary of a solution.
   * @param elements Set of element symbols carrying label (e.g. {"C"})
   * @returns { metE: Float32Array (mean enrichment of traceable atoms), uncertain: Uint8Array }
   */
  summarize(prog, sol, elements) {
    const { off } = this, mets = this.model.mets;
    const codes = new Set([...elements].map(elCode));
    const metE = new Float32Array(mets.length), uncertain = new Uint8Array(mets.length);
    for (const m of sol.order) {
      const b = mets[m].b, el = this.baseEl[b];
      let s = 0, n = 0;
      for (let a = 0; a < el.length; a++) if (el[a] === 0 || codes.has(el[a])) { s += sol.e[off[m] + a]; n++; }
      metE[m] = n ? s / n : 0;
      if (this.basePseudo[b] && metE[m] > 1e-6) uncertain[m] = 1;
    }
    // positions are uncertain where a relevant share of the label arrived through a mixing pool
    const { start, src, w, fromPool } = prog;
    for (const m of sol.order) {
      if (uncertain[m]) continue;
      const elm = this.baseEl[mets[m].b];
      let viaPool = 0, total = 0;
      for (let k = off[m]; k < off[m + 1]; k++) {
        if (elm[k - off[m]] !== 0 && !codes.has(elm[k - off[m]])) continue;
        for (let p = start[k]; p < start[k + 1]; p++) {
          const x = w[p] * sol.e[src[p]];
          total += x;
          if (fromPool[p]) viaPool += x;
        }
      }
      if (viaPool > 0.2 * total && viaPool > 1e-12) uncertain[m] = 1;
    }
    return { metE, uncertain };
  }

  /** Enrichment vector of one metabolite. */
  atomsEnrichment(sol, met) {
    return sol.e.subarray(this.off[met], this.off[met + 1]);
  }

  /** Number of labelled atoms carried per mole of metabolite (pseudo-atoms weighted). */
  labelPerMole(sol, met, elements) {
    const b = this.model.mets[met].b, el = this.baseEl[b];
    const codes = new Set([...elements].map(elCode));
    let s = 0;
    for (let a = 0; a < el.length; a++) {
      if (el[a] === 0) s += sol.e[this.off[met] + a] * this.baseW[b];
      else if (codes.has(el[a])) s += sol.e[this.off[met] + a];
    }
    return s;
  }
}

/** In-place Gaussian elimination with partial pivoting; solution returned in b. */
function solveDense(M, b, n) {
  for (let c = 0; c < n; c++) {
    let piv = c, best = Math.abs(M[c * n + c]);
    for (let r = c + 1; r < n; r++) { const v = Math.abs(M[r * n + c]); if (v > best) { best = v; piv = r; } }
    if (best < 1e-300) return false;
    if (piv !== c) {
      for (let k = c; k < n; k++) { const t = M[c * n + k]; M[c * n + k] = M[piv * n + k]; M[piv * n + k] = t; }
      const t = b[c]; b[c] = b[piv]; b[piv] = t;
    }
    const d = M[c * n + c];
    for (let r = c + 1; r < n; r++) {
      const f = M[r * n + c] / d;
      if (f === 0) continue;
      for (let k = c + 1; k < n; k++) M[r * n + k] -= f * M[c * n + k];
      b[r] -= f * b[c];
    }
  }
  for (let r = n - 1; r >= 0; r--) {
    let s = b[r];
    for (let k = r + 1; k < n; k++) s -= M[r * n + k] * b[k];
    b[r] = s / M[r * n + r];
  }
  return true;
}
