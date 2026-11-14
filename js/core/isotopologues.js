// Isotopologue (mass) distributions by backward Monte-Carlo sampling of single molecules.
//
// The positional tracer (tracer.js) gives the enrichment of every atom but not how the labelled
// atoms are combined inside one molecule: [U-13C]glucose makes pyruvate that is either fully
// labelled (M+3) or unlabelled (M+0), which positional averages cannot tell apart from a mix.
//
// Here one molecule is sampled at a time: pick where it came from (an uptake, or one of the
// reactions producing it, with probability proportional to flux), follow each atom to its
// substrate through the atom map, and repeat for the substrate molecules. Atoms that came from
// the same substrate molecule stay together, which is exactly what preserves the correlations.
// The walk ends at the medium, where the label is known.
//
// Steady state: the walk has no clock. Dynamic runs: the walk also goes back in time. A molecule
// found in a well-mixed pool of size A fed at rate F entered it an exponentially distributed time
// ago (mean A/F); fluxes and medium composition are those of that earlier moment, and a molecule
// that turns out to be older than the simulation belongs to the initial, unlabelled content.
//
// Where a reaction has no atom map the atom falls back to the positional enrichment (drawn
// independently); the share of such draws is reported as `approx`.

const SHIFT = { C: 1, N: 1, O: 2, S: 2 }; // 13C, 15N, 18O, 34S
const EL_CODE = { C: 1, N: 2, O: 3, S: 5 };

function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let x = Math.imul(a ^ (a >>> 15), 1 | a);
    x = (x + Math.imul(x ^ (x >>> 7), 61 | x)) ^ x;
    return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
  };
}

export class IsotopologueSampler {
  /**
   * Steady-state sampler.
   * @param tracer   Tracer (provides structures, symmetry and atom maps)
   * @param index    ModelIndex (reactions per metabolite)
   * @param v        fluxes
   * @param inputs   tracer inputs [{ met, flux, label, batches? }]
   * @param e        positional enrichments (frame.e), used where no atom map exists
   * @param elements Set of labelled element symbols
   */
  constructor(tracer, index, v, inputs, e, elements, seed = 12345) {
    Object.assign(this, { tracer, index, model: tracer.model });
    this.rand = rng(seed);
    this.elements = [...elements].filter((s) => SHIFT[s]);
    this.codes = new Set(this.elements.map((s) => EL_CODE[s]));
    this.timed = false;
    this.ctxs = v ? [this._context(v, inputs, e, 0, Infinity, null)] : [];
    this.fallbacks = 0; this.draws = 0; this.steps = 0;
  }

  /**
   * Sampler over a dynamic run.
   * @param frames   result.frames: { t, v, inputs, e, conc, biomass }
   * @param pool     intracellular pool size (mmol/gDW)
   * @param instant  Set of metabolites whose pool is defined by its input alone (the medium components)
   */
  static dynamic(tracer, index, frames, elements, pool, instant, seed = 12345) {
    const S = new IsotopologueSampler(tracer, index, null, null, null, elements, seed);
    S.timed = true;
    S.frames = frames;
    S.frameCtx = new Int32Array(frames.length);
    const zero = new Float32Array(tracer.nAtoms);
    let t0 = 0;
    frames.forEach((f, i) => {
      const last = S.ctxs[S.ctxs.length - 1];
      if (last && last.v === f.v && last.inputs === f.inputs) { last.t1 = f.t; last.e = f.e || zero; last.frame = f; }
      else {
        // intracellular pools have one size; other extracellular pools hold what has been secreted so far
        const ctx = S._context(f.v, f.inputs || [], f.e || zero, t0, f.t, null);
        ctx.frame = f;
        ctx.poolOf = (m) => (instant.has(m) ? 0 : tracer.model.mets[m].c !== "e" ? pool : (ctx.frame.conc?.get(m) || 0) / (ctx.frame.biomass || 1));
        S.ctxs.push(ctx);
      }
      S.frameCtx[i] = S.ctxs.length - 1;
      t0 = f.t;
    });
    return S;
  }

  _context(v, inputs, e, t0, t1, poolOf) {
    const inputsOf = new Map();
    for (const inp of inputs) if (inp.flux > 1e-9) { let l = inputsOf.get(inp.met); if (!l) inputsOf.set(inp.met, (l = [])); l.push(inp); }
    return { v, inputs, inputsOf, e, t0, t1, poolOf, prod: new Map(), rxn: new Map() };
  }

  /** Everything that makes metabolite m: uptakes and reactions, weighted by flux. */
  _producers(ctx, m) {
    let P = ctx.prod.get(m);
    if (P) return P;
    const { index, model } = this, v = ctx.v;
    const items = [];
    let total = 0;
    for (const inp of ctx.inputsOf.get(m) || []) { items.push({ w: inp.flux, inp }); total += inp.flux; }
    for (let p = index.rxnStart[m]; p < index.rxnStart[m + 1]; p++) {
      const j = index.rxnList[p], f = v[j] * index.rxnCoef[p];
      if (!(f > 1e-9)) continue;
      const r = model.rxns[j];
      if (r.m.length < 2) continue;
      const fwd = v[j] > 0;
      if (!r.c.some((c) => (c < 0) === fwd)) continue; // no substrate side
      // a metabolite can appear more than once in a reaction: take every product position
      for (let q = 0; q < r.m.length; q++) {
        if (r.m[q] !== m || (r.c[q] < 0) === fwd) continue;
        const w = Math.abs(v[j] * r.c[q]);
        items.push({ w, j, q }); total += w;
      }
    }
    P = { items, total };
    ctx.prod.set(m, P);
    return P;
  }

  /** For reaction j: per product position, per atom, the candidate sources [substrate position, atom, ...]. */
  _sources(ctx, j) {
    let S = ctx.rxn.get(j);
    if (S) return S;
    const { model, tracer } = this, r = model.rxns[j], fwd = ctx.v[j] > 0;
    const isSub = r.c.map((c) => (c < 0) === fwd);
    S = r.m.map((m, q) => (isSub[q] ? null : Array.from({ length: tracer.atomsOf(m) }, () => [])));
    const map = tracer.maps[r.id];
    const used = r.m.map((m) => new Float32Array(tracer.atomsOf(m)));
    if (map) for (const seg of map.s) {
      const sl = fwd ? seg[0] : seg[1], pl = fwd ? seg[1] : seg[0];
      if (!isSub[sl] || isSub[pl]) continue;
      const nS = used[sl].length, nP = used[pl].length, pairs = seg[2];
      if (pairs === -1) {
        const copies = seg[3] ?? Math.min(Math.abs(r.c[sl]), Math.abs(r.c[pl]));
        for (let a = 0; a < Math.min(nS, nP); a++) { S[pl][a].push(sl, a); used[sl][a] += copies; }
      } else {
        const mult = seg[3] ?? 1;
        for (let k = 0; k < pairs.length; k += 2) {
          const sa = fwd ? pairs[k] : pairs[k + 1], pa = fwd ? pairs[k + 1] : pairs[k];
          if (sa < nS && pa < nP) { S[pl][pa].push(sl, sa); used[sl][sa] += mult; }
        }
      }
    }
    // Atoms without a transition take the tracer's "mixing pool" of the reaction: the mean enrichment
    // of the substrate atoms of the same element that the map left unused.
    const pools = new Map(); // element class -> [atom variable, weight, ...]
    r.m.forEach((m, q) => {
      if (!isSub[q]) return;
      const b = model.mets[m].b, el = tracer.baseEl[b], coef = Math.abs(r.c[q]);
      for (let a = 0; a < el.length; a++) {
        const left = coef - used[q][a];
        if (left <= 1e-6 || el[a] === 7 || el[a] === 4) continue;
        const c = el[a] === 0 ? 1 : el[a];
        (pools.get(c) || pools.set(c, []).get(c)).push(tracer.off[m] + a, left * (el[a] === 0 ? tracer.baseW[b] : 1));
      }
    });
    S.pools = pools;
    ctx.rxn.set(j, S);
    return S;
  }

  _poolValue(S, cls, e) {
    const p = S.pools.get(cls);
    if (!p) return 0;
    let lab = 0, tot = 0;
    for (let i = 0; i < p.length; i += 2) { lab += p[i + 1] * e[p[i]]; tot += p[i + 1]; }
    return tot ? lab / tot : 0;
  }

  /**
   * When did a molecule found in pool m at time tau (context ci) enter that pool?
   * @returns [time, context index], or null when it was there from the start
   */
  _entry(m, tau, ci) {
    let need = -Math.log(1 - this.rand());
    for (let c = ci; c >= 0; c--) {
      const ctx = this.ctxs[c], F = this._producers(ctx, m).total;
      const hi = Math.min(tau, ctx.t1), d = hi - ctx.t0;
      if (!(F > 0) || d <= 0) continue; // nothing came in during this stretch
      const A = ctx.poolOf(m);
      if (!(A > 0)) return [hi, c];
      const lam = F / A;
      if (lam * d >= need) return [hi - need / lam, c];
      need -= lam * d;
    }
    return null;
  }

  /** Sample the label state of `atoms` of one molecule of m; atom i is written to out[pos[i]]. */
  _sample(m0, atoms0, pos0, out, tau0, ci0) {
    const { tracer, rand, model } = this;
    const stack = [[m0, atoms0, pos0, tau0, ci0]];
    let budget = 5000;
    while (stack.length) {
      let [m, atoms, pos, tau, ci] = stack.pop();
      this.draws += atoms.length; this.steps++;
      if (this.timed) {
        const en = this._entry(m, tau, ci);
        if (!en) { for (let i = 0; i < atoms.length; i++) out[pos[i]] = 0; continue; } // initial, unlabelled content
        tau = en[0]; ci = en[1];
      }
      const ctx = this.ctxs[ci], P = this._producers(ctx, m);
      if (--budget < 0 || !(P.total > 0)) {
        const o = tracer.off[m];
        for (let i = 0; i < atoms.length; i++) { out[pos[i]] = rand() < ctx.e[o + atoms[i]] ? 1 : 0; this.fallbacks++; }
        continue;
      }
      // a symmetric molecule has no memory of its orientation
      const sym = tracer.baseSym[model.mets[m].b];
      if (sym) {
        let moved = null, turnSize = 0, turn = 0;
        for (const g of sym) {
          if (g.length !== turnSize) { turnSize = g.length; turn = Math.floor(rand() * g.length); }
          if (!turn) continue;
          for (let i = 0; i < g.length; i++) (moved ||= new Map()).set(g[i], g[(i + turn) % g.length]);
        }
        if (moved) atoms = atoms.map((a) => moved.get(a) ?? a);
      }
      let x = rand() * P.total, it = P.items[P.items.length - 1];
      for (const cand of P.items) { x -= cand.w; if (x < 0) { it = cand; break; } }
      if (it.inp) {
        // the medium can hold several batches of the same metabolite (e.g. unlabelled, then a labelled addition)
        let lab = it.inp.label, frac = 0;
        if (it.inp.batches) {
          let u = rand(), b = it.inp.batches[it.inp.batches.length - 1];
          for (const cand of it.inp.batches) { u -= cand.w; if (u < 0) { b = cand; break; } }
          lab = b.label; frac = lab ? b.frac : 0;
        } else if (lab) for (const y of lab) if (y > frac) frac = y;
        const on = frac > 0 && rand() < frac;
        for (let i = 0; i < atoms.length; i++) out[pos[i]] = on && lab[atoms[i]] > 0 ? 1 : 0;
        continue;
      }
      const r = model.rxns[it.j], info = this._sources(ctx, it.j), src = info[it.q], el = tracer.baseEl[model.mets[m].b];
      const copy = Math.floor(rand() * 64);
      // group the atoms by the substrate molecule they came from
      const groups = new Map(); // substrate position -> [[atoms, pos]] one entry per molecule
      for (let i = 0; i < atoms.length; i++) {
        const c = src[atoms[i]];
        if (!c || !c.length) {
          // same rule as the tracer: an unmapped carrier atom (CoA) is unlabelled
          out[pos[i]] = !tracer.noPool[model.mets[m].b] && rand() < this._poolValue(info, el[atoms[i]] === 0 ? 1 : el[atoms[i]], ctx.e) ? 1 : 0;
          this.fallbacks++; continue;
        }
        const k = (copy % (c.length / 2)) * 2, sl = c[k], sa = c[k + 1];
        let list = groups.get(sl);
        if (!list) groups.set(sl, (list = []));
        // the same substrate atom needed twice means two substrate molecules (2 acetyl-CoA -> acetoacetyl-CoA)
        let g = list.find((y) => !y[0].includes(sa));
        if (!g) list.push((g = [[], []]));
        g[0].push(sa); g[1].push(pos[i]);
      }
      for (const [sl, list] of groups) for (const g of list) stack.push([r.m[sl], g[0], g[1], tau, ci]);
    }
  }

  /**
   * Mass isotopologue distribution of metabolite m (steady state, or at frame `fi` of a dynamic run).
   * @returns null (no structure, not produced, or no labelled element in it) or
   *   { dist: [p(M+0), p(M+1), ...], atoms, mean (labelled atoms per molecule), positional (same, from the
   *     positional tracer), approx (share of atoms drawn without an atom map), n }
   */
  mid(m, n = 2000, maxMs = 250, fi = 0) {
    const { tracer, model } = this, b = model.mets[m].b;
    if (tracer.basePseudo[b] || !this.codes.size || !this.ctxs.length) return null;
    const ci = this.timed ? this.frameCtx[fi] : 0, tau = this.timed ? this.frames[fi].t : 0;
    // in a dynamic run a pool that is not being made right now still holds what was made before
    if (!this.timed && !(this._producers(this.ctxs[0], m).total > 0)) return null;
    if (this.timed && !this.ctxs.slice(0, ci + 1).some((c) => this._producers(c, m).total > 0)) return null;
    const el = tracer.baseEl[b], atoms = [], shift = [];
    const shiftOf = new Map(this.elements.map((s) => [EL_CODE[s], SHIFT[s]]));
    for (let a = 0; a < el.length; a++) if (this.codes.has(el[a])) { atoms.push(a); shift.push(shiftOf.get(el[a])); }
    if (!atoms.length) return null;
    const maxShift = shift.reduce((s, x) => s + x, 0);
    const dist = new Float64Array(maxShift + 1), out = new Uint8Array(atoms.length), pos = atoms.map((_, i) => i);
    let mean = 0;
    this.fallbacks = 0; this.draws = 0; this.steps = 0;
    const t0 = Date.now(), want = n;
    for (let k = 0; k < want; k++) {
      // molecules caught in long recycling loops are slow to trace: settle for fewer of them
      if (k >= 100 && k % 20 === 0 && Date.now() - t0 > maxMs) { n = k; break; }
      this._sample(m, atoms, pos, out, tau, ci);
      let s = 0, c = 0;
      for (let i = 0; i < atoms.length; i++) if (out[i]) { s += shift[i]; c++; }
      dist[s] += 1; mean += c;
    }
    for (let i = 0; i < dist.length; i++) dist[i] /= n;
    const e = this.timed ? this.frames[fi].e : this.ctxs[0].e;
    let positional = 0;
    if (e) for (const a of atoms) positional += e[tracer.off[m] + a];
    return { dist: Array.from(dist), atoms: atoms.length, mean: mean / n, positional, approx: this.fallbacks / (n * atoms.length), steps: this.steps / n, n };
  }
}

// Natural isotope abundances: [mass shift, fraction] of the heavy isotopes of each element.
const NATURAL = {
  H: [[1, 0.000115]], C: [[1, 0.0107]], N: [[1, 0.00364]], O: [[1, 0.00038], [2, 0.00205]],
  S: [[1, 0.0075], [2, 0.0425], [4, 0.0001]], Cl: [[2, 0.2424]], Br: [[2, 0.4931]], K: [[2, 0.067302]],
  Mg: [[1, 0.1], [2, 0.1101]], Ca: [[2, 0.00647], [4, 0.02086]], Si: [[1, 0.04685], [2, 0.03092]],
  Fe: [[-2, 0.05845], [1, 0.02119], [2, 0.00282]], Se: null, Zn: null, Cu: null, Mo: null, Ni: null,
  P: [], F: [], Na: [], I: [], Co: [], Mn: [], As: [],
};

/**
 * Mass isotopologue distribution of an unlabelled molecule, from its formula.
 * @returns null (no usable formula) or { dist: [p(M+0), ...], ignored: [elements left out] }
 */
export function naturalMid(formula, maxShift = 12) {
  if (!formula) return null;
  const counts = new Map(), ignored = [];
  for (const m of formula.matchAll(/([A-Z][a-z]?)(\d*)/g)) counts.set(m[1], (counts.get(m[1]) || 0) + (m[2] ? parseInt(m[2], 10) : 1));
  if (!counts.size) return null;
  let dist = new Float64Array(maxShift + 1);
  dist[0] = 1;
  for (const [el, n] of counts) {
    const iso = NATURAL[el];
    // generic groups (R, X) and elements whose lightest isotope is not the main one are left out
    if (!iso || iso.some((x) => x[0] < 0)) { ignored.push(el); continue; }
    if (!iso.length) continue;
    const light = 1 - iso.reduce((a, x) => a + x[1], 0);
    // one atom at a time would be slow for large molecules: square-and-multiply on the per-atom distribution
    let unit = new Float64Array(maxShift + 1);
    unit[0] = light;
    for (const [sh, p] of iso) if (sh <= maxShift) unit[sh] += p;
    let acc = new Float64Array(maxShift + 1);
    acc[0] = 1;
    const mul = (a, b) => { const o = new Float64Array(maxShift + 1); for (let i = 0; i <= maxShift; i++) if (a[i]) for (let j = 0; i + j <= maxShift; j++) o[i + j] += a[i] * b[j]; return o; };
    for (let k = n; k > 0; k >>= 1) { if (k & 1) acc = mul(acc, unit); unit = mul(unit, unit); }
    dist = mul(dist, acc);
  }
  return { dist: Array.from(dist), ignored };
}
