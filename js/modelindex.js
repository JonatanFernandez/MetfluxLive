// Derived lookups over a loaded model plus per-frame flux analyses used by the views.

export function carbonCount(formula) {
  const m = /C(?![a-z])(\d*)/.exec(formula || "");
  return m ? parseInt(m[1] || "1", 10) : 0;
}

export class ModelIndex {
  constructor(model, layout) {
    this.model = model;
    const { mets, rxns, bases, subsystems } = model;
    this.currency = new Uint8Array(bases.length);
    for (const b of layout.currency) this.currency[b] = 1;
    this.baseCarbons = Int16Array.from(bases, (b) => carbonCount(b.f));
    this.metsOfBase = bases.map(() => []);
    mets.forEach((m, i) => this.metsOfBase[m.b].push(i));
    // reactions per metabolite (CSR)
    const count = new Int32Array(mets.length + 1);
    for (const r of rxns) for (const m of r.m) count[m + 1]++;
    for (let i = 0; i < mets.length; i++) count[i + 1] += count[i];
    this.rxnStart = count;
    this.rxnList = new Int32Array(count[mets.length]);
    this.rxnCoef = new Float32Array(count[mets.length]);
    const fill = count.slice(0, mets.length);
    rxns.forEach((r, j) => r.m.forEach((m, q) => { const p = fill[m]++; this.rxnList[p] = j; this.rxnCoef[p] = r.c[q]; }));
    this.rxnsOfSub = subsystems.map(() => []);
    rxns.forEach((r, j) => this.rxnsOfSub[r.ss].push(j));
    const low = subsystems.map((s) => s.toLowerCase());
    this.isTransportSub = Uint8Array.from(low, (s) => (s.includes("transport") ? 1 : 0));
    this.isExchangeSub = Uint8Array.from(low, (s) => (s.includes("exchange") ? 1 : 0));
    this.biomassRxn = rxns.findIndex((r) => r.obj);
    if (this.biomassRxn < 0) this.biomassRxn = rxns.findIndex((r) => /biomass/i.test(r.n));
    this.rxnIndex = new Map(rxns.map((r, j) => [r.id, j]));
    // compartment roles, recognised by name so that other GEMs work too
    this.compRole = {}; this.roleComp = {};
    for (const [c, name] of Object.entries(model.compartments)) {
      const hit = ROLE_RX.find(([, rx]) => rx.test(name));
      if (hit && !this.roleComp[hit[0]]) { this.compRole[c] = hit[0]; this.roleComp[hit[0]] = c; }
    }
    this.pathwayGroups = { key: "pathway", n: subsystems.length, groupOf: Int32Array.from(rxns, (r) => r.ss), skip: this.isTransportSub, perMet: false };
  }

  /** Reactions carrying label: active, with a labelled non-currency metabolite. */
  labelMask(v, metE, thr = 0.005) {
    const { mets, rxns } = this.model;
    const met = new Uint8Array(mets.length), rxn = new Uint8Array(rxns.length);
    for (let m = 0; m < mets.length; m++) if (metE[m] > thr) met[m] = 1;
    rxns.forEach((r, j) => {
      if (!v[j]) return;
      for (const m of r.m) if (met[m] && !this.currency[mets[m].b]) { rxn[j] = 1; break; }
    });
    return { rxn, met };
  }

  /** Reactions whose flux differs from the reference, and the metabolites they touch. */
  deltaMask(v, v0, tol = 0.02) {
    const { mets, rxns } = this.model;
    const met = new Uint8Array(mets.length), rxn = new Uint8Array(rxns.length);
    rxns.forEach((r, j) => {
      if (Math.abs(v[j] - v0[j]) <= 1e-7 + tol * Math.max(Math.abs(v[j]), Math.abs(v0[j]))) return;
      rxn[j] = 1;
      for (const m of r.m) met[m] = 1;
    });
    return { rxn, met };
  }

  metName(i, withComp = true) {
    const m = this.model.mets[i];
    return this.model.bases[m.b].n + (withComp ? ` [${m.c}]` : "");
  }

  compName(c) { return this.model.compartments[c] || c; }

  equation(j, v = 1) {
    const r = this.model.rxns[j];
    const side = (sign) => r.m.map((m, q) => (r.c[q] * sign > 0 ? `${fmtCoef(r.c[q])}${this.metName(m)}` : null)).filter(Boolean).join(" + ");
    const arrow = r.lb < 0 && r.ub > 0 ? "⇌" : "→";
    return v < 0 ? `${side(1)} ${arrow} ${side(-1)}` : `${side(-1)} ${arrow} ${side(1)}`;
  }

  /** Total turnover of every metabolite: sum of producing fluxes. */
  turnover(v) {
    const { mets } = this.model, out = new Float32Array(mets.length);
    for (let m = 0; m < mets.length; m++) {
      let s = 0;
      for (let p = this.rxnStart[m]; p < this.rxnStart[m + 1]; p++) { const f = v[this.rxnList[p]] * this.rxnCoef[p]; if (f > 0) s += f; }
      out[m] = s;
    }
    return out;
  }

  /**
   * Carbon highways between reaction groups: what group A produces and group B consumes.
   * G = { n, groupOf, skip, perMet }: with perMet each compartment's pool is separate (cell view);
   * otherwise compartments are merged per metabolite and groups flagged in `skip` (transport) are ignored.
   * vRef (optional) gives the reference fluxes for the per-group change gD in [-1, 1].
   */
  groupFlows(v, metE, G, vRef) {
    const { model } = this;
    const nG = G.n, groupOf = G.groupOf, skip = G.skip;
    const gFlux = new Float32Array(nG), gLab = new Float32Array(nG), gE = new Float32Array(nG), gRef = new Float32Array(nG), gD = new Float32Array(nG);
    model.rxns.forEach((r, j) => {
      const g = groupOf[j];
      if (g < 0) return;
      if (vRef) gRef[g] += Math.abs(vRef[j]);
      const f = Math.abs(v[j]);
      if (!f) return;
      gFlux[g] += f;
      if (metE) {
        let s = 0, n = 0;
        for (const m of r.m) if (!this.currency[model.mets[m].b]) { s += metE[m]; n++; }
        if (n) gLab[g] += (f * s) / n;
      }
    });
    for (let g = 0; g < nG; g++) {
      gE[g] = gFlux[g] ? gLab[g] / gFlux[g] : 0;
      const mx = Math.max(gFlux[g], gRef[g]);
      gD[g] = vRef && mx > 0 ? (gFlux[g] - gRef[g]) / mx : 0;
    }
    const flows = new Map();
    const P = new Map(), C = new Map();
    const pool = (b, mets, carbons) => {
      P.clear(); C.clear();
      let tp = 0, tc = 0, lab = 0, tot = 0;
      for (const m of mets) {
        for (let p = this.rxnStart[m]; p < this.rxnStart[m + 1]; p++) {
          const j = this.rxnList[p], f = v[j] * this.rxnCoef[p];
          if (!f) continue;
          const g = groupOf[j];
          if (g < 0 || (skip && skip[g])) continue;
          if (f > 0) { P.set(g, (P.get(g) || 0) + f); tp += f; if (metE) { lab += f * metE[m]; tot += f; } }
          else { C.set(g, (C.get(g) || 0) - f); tc -= f; }
        }
      }
      if (!tp || !tc) return;
      const norm = Math.max(tp, tc), e = tot ? lab / tot : 0;
      for (const [a, pa] of P) for (const [c, cb] of C) {
        if (a === c) continue;
        const key = a * nG + c, flow = (pa * cb * carbons) / norm;
        let o = flows.get(key);
        if (!o) flows.set(key, (o = { a, b: c, flow: 0, lab: 0, top: null, topFlow: 0 }));
        o.flow += flow; o.lab += flow * e;
        if (flow > o.topFlow) { o.topFlow = flow; o.top = b; }
      }
    };
    const one = [0];
    for (let b = 0; b < model.bases.length; b++) {
      const carbons = this.baseCarbons[b];
      if (this.currency[b] || !carbons) continue;
      if (G.perMet) for (const m of this.metsOfBase[b]) { one[0] = m; pool(b, one, carbons); }
      else pool(b, this.metsOfBase[b], carbons);
    }
    const list = [...flows.values()].sort((x, y) => y.flow - x.flow).slice(0, G.perMet ? 320 : 220);
    for (const o of list) o.e = o.flow ? o.lab / o.flow : 0;
    return { gFlux, gE, gD, flows: list };
  }
}

const ROLE_RX = [["ext", /extracell/i], ["inner", /inner mito|intermembrane/i], ["mito", /mitochondri/i], ["cyt", /cytosol|cytoplasm/i],
  ["nuc", /nucle/i], ["er", /reticul/i], ["golgi", /golgi/i], ["lyso", /lysos/i], ["perox", /peroxi/i]];

export function fmtCoef(c) {
  const a = Math.abs(c);
  if (Math.abs(a - 1) < 1e-9) return "";
  return (a >= 100 ? a.toFixed(0) : +a.toPrecision(3)) + " ";
}

export function fmtFlux(x) {
  const a = Math.abs(x);
  if (a === 0) return "0";
  if (a >= 100) return x.toFixed(0);
  if (a >= 1) return x.toFixed(2);
  if (a >= 0.001) return x.toPrecision(3);
  return x.toExponential(1);
}

export function fmtTime(h) {
  if (h < 1 / 60) return `${Math.round(h * 3600)} s`;
  if (h < 1) return `${(h * 60).toFixed(h * 60 < 10 ? 1 : 0)} min`;
  return `${h.toFixed(h < 10 ? 1 : 0)} h`;
}

export const escapeHtml = (s) => String(s).replace(/[&<>"]/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[ch]));
