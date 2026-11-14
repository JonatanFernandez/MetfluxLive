// Simulation orchestration: medium -> bounds -> FBA (worker) -> isotope propagation.
import { packNetwork } from "./core/fba.js";
import { applyMedium, findExchanges, uptakeCapacity, UNLIMITED } from "./core/medium.js";
import { TRACE_SECRETION, FREE_SECRETION, atpMaintenanceRxn } from "./core/measured.js";
import { Tracer } from "./core/tracer.js";
import { t } from "./i18n.js";

export class Simulator {
  /** @param backend optional replacement for the solver worker: async ({ type, ... }) => result (used by the tests) */
  constructor(model, structures, atommaps, backend) {
    this.model = model;
    this.tracer = new Tracer(model, structures, atommaps);
    this.exchanges = findExchanges(model);
    this.baseLb = Float64Array.from(model.rxns, (r) => r.lb);
    this.baseUb = Float64Array.from(model.rxns, (r) => r.ub);
    this.ngamRxn = atpMaintenanceRxn(model);
    this.pending = new Map();
    if (backend) { this._call = backend; this.ready = backend({ type: "init", net: packNetwork(model) }); return; }
    this.worker = new Worker(new URL("./core/solver.worker.js", import.meta.url), { type: "module" });
    this.seq = 0;
    this.worker.onmessage = (ev) => {
      const p = this.pending.get(ev.data.id);
      if (!p) return;
      this.pending.delete(ev.data.id);
      if (ev.data.ok) p.resolve(ev.data.result); else p.reject(new Error(ev.data.error));
    };
    this.worker.onerror = (ev) => {
      for (const [, p] of this.pending) p.reject(new Error(ev.message || t("err.worker")));
      this.pending.clear();
    };
    this.ready = this._call({ type: "init", net: packNetwork(model) });
  }

  dispose() { this.worker?.terminate(); }

  _call(msg) {
    const id = ++this.seq;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.worker.postMessage({ ...msg, id });
    });
  }

  /** Split the user's supply list into exchange-driven medium and internal injections. */
  _supplies(supplies, concOverride) {
    const medium = [], sources = [], srcItems = [];
    for (const it of supplies) {
      const conc = concOverride?.get(it.met) ?? it.conc;
      if (this.exchanges.has(it.met)) medium.push({ ...it, conc });
      else if (conc > 0) {
        sources.push({ met: it.met, max: it.unlimited ? UNLIMITED : uptakeCapacity(conc, it.vmax, it.km) });
        srcItems.push(it);
      }
    }
    return { medium, sources, srcItems };
  }

  /** Flux caps for perturbed reactions: knockout -> 0, knockdown -> fraction of the reference flux. */
  _caps(perturb, refV) {
    const caps = new Map();
    for (const [j, a] of perturb) {
      const v0 = Math.abs(refV[j]);
      if (a <= 0) caps.set(j, 0);
      else if (v0 > 1e-9) caps.set(j, a * v0); // unused in the reference: a partial knockdown has nothing to scale
    }
    return caps;
  }

  _key(cfg, supplies) {
    return JSON.stringify([cfg.objective, cfg.maximize, cfg.parsimonious, cfg.measured || null, supplies.map((it) => [it.met, it.conc, it.vmax, it.km, it.unlimited ? 1 : 0, it.hold ? 1 : 0])]);
  }

  /** The unperturbed reference is reused while medium and objective stay the same. */
  async _reference(key, compute) {
    if (this.refCache && this.refCache.key === key) return this.refCache.value;
    const value = await compute();
    this.refCache = { key, value };
    return value;
  }

  async _solve(cfg, supplies, concOverride, capLimit, pertCaps) {
    const { medium, sources, srcItems } = this._supplies(supplies, concOverride);
    const { lb, ub } = applyMedium(this.model, this.exchanges, medium, this.baseLb, this.baseUb);
    if (capLimit) {
      for (const it of medium) {
        const lim = capLimit.get(it.met);
        if (lim === undefined) continue;
        const e = this.exchanges.get(it.met);
        if (e.dir < 0) lb[e.rxn] = Math.max(lb[e.rxn], -lim); else ub[e.rxn] = Math.min(ub[e.rxn], lim);
      }
    }
    const measured = cfg.measured?.items?.length || cfg.measured?.ngam > 0 ? cfg.measured : null;
    // a perturbed cell keeps the measured phenotype of the reference; only if that becomes impossible are the
    // measured fluxes relaxed (below), as in any other case
    if (measured) this._applyMeasured(measured, medium, lb, ub, capLimit, !!cfg.relaxed, cfg.objective);
    if (pertCaps) {
      for (const [j, cap] of pertCaps) {
        ub[j] = Math.min(ub[j], cap); lb[j] = Math.max(lb[j], -cap);
        if (lb[j] > ub[j]) lb[j] = ub[j] = cap === 0 ? 0 : Math.sign(lb[j]) * cap;
      }
    }
    await this.ready;
    let res = await this._call({
      type: "solve",
      params: { lb, ub, objective: cfg.objective, maximize: cfg.maximize, parsimonious: cfg.parsimonious, sources },
    });
    // the measured fluxes belong to cells in a rich medium: when they cannot be met (a nutrient removed or
    // exhausted, a perturbation…) they are relaxed instead of leaving the user without a solution
    if (measured && res.status !== "optimal" && !cfg.relaxed) {
      res = await this._solve({ ...cfg, relaxed: true }, supplies, concOverride, capLimit, pertCaps);
      res.relaxed = true;
      return res;
    }
    res.srcItems = srcItems;
    return res;
  }

  /**
   * Pin exchange fluxes to measured values (± tol). They replace the uptake ceilings that the medium gives.
   * An uptake is only applied when the metabolite is in the medium, and never above what is physically left
   * (dynamic mode). Relaxed (when the pinned problem has no solution): uptakes keep only their measured
   * maximum and secretions are left free. The objective's own exchange is never capped as a trace.
   */
  _applyMeasured(meas, medium, lb, ub, capLimit, perturbed, objective) {
    const tol = Math.max(0, meas.tol ?? 0.2), present = new Map(medium.map((it) => [it.met, it]));
    // unmeasured organic products: traces only
    if (meas.ngam > 0 && this.ngamRxn >= 0) lb[this.ngamRxn] = Math.max(lb[this.ngamRxn], Math.min(meas.ngam, ub[this.ngamRxn]));
    const measuredMets = new Set(meas.items.map((x) => x.met));
    for (const [met, e] of this.exchanges) {
      // exchanges added by a model edit are left free: the user put them there to be used
      if (measuredMets.has(met) || e.rxn === objective || this.model.rxns[e.rxn].user || FREE_SECRETION.has(this.model.bases[this.model.mets[met].b].n)) continue;
      if (e.dir < 0) ub[e.rxn] = Math.min(ub[e.rxn], TRACE_SECRETION); else lb[e.rxn] = Math.max(lb[e.rxn], -TRACE_SECRETION);
    }
    for (const { met, rate } of meas.items) {
      const e = this.exchanges.get(met);
      if (!e || !rate) continue;
      let lo, hi; // range of uptake (positive) or secretion (negative), in "uptake" terms
      if (rate > 0) {
        const it = present.get(met);
        if (!it || (!it.unlimited && !(it.conc > 0))) continue; // nothing to take up
        hi = rate * (1 + tol); lo = perturbed ? 0 : rate * (1 - tol);
        const avail = capLimit?.get(met);
        if (avail !== undefined) { hi = Math.min(hi, avail); lo = Math.min(lo, hi); }
      } else {
        if (perturbed) continue;
        lo = rate * (1 + tol); hi = rate * (1 - tol);
      }
      // uptake = dir · v
      const a = lo * e.dir, b = hi * e.dir;
      lb[e.rxn] = Math.min(a, b); ub[e.rxn] = Math.max(a, b);
    }
  }

  /** Tracer inputs: every uptake and injection, labelled where the user marked atoms. */
  _inputs(res, supplies) {
    const labelOf = new Map();
    for (const it of supplies) {
      if (it.label && it.label.some((x) => x > 0)) labelOf.set(it.met, Float64Array.from(it.label, (x) => x * (it.fraction ?? 1)));
    }
    const inputs = [];
    for (const [met, e] of this.exchanges) {
      const up = res.v[e.rxn] * e.dir;
      if (up > 1e-9) inputs.push({ met, flux: up, label: labelOf.get(met) || null });
    }
    res.srcItems.forEach((it, i) => {
      if (res.sourceFlux[i] > 1e-9) inputs.push({ met: it.met, flux: res.sourceFlux[i], label: labelOf.get(it.met) || null });
    });
    return inputs;
  }

  _elements(supplies, structures) {
    const els = new Set();
    for (const it of supplies) {
      if (!it.label) continue;
      const st = structures[this.model.bases[this.model.mets[it.met].b].id];
      it.label.forEach((x, a) => { if (x > 0) els.add(st ? st.e[a] : "C"); });
    }
    return els;
  }

  _frame(t, res, inputs, prog, sol, elements, extra = {}) {
    const frame = { t, v: res.v, status: res.status, objective: res.objective, inputs, sourceFlux: res.sourceFlux, srcItems: res.srcItems, elements, relaxed: !!res.relaxed, ...extra };
    if (sol) {
      const sum = this.tracer.summarize(prog, sol, elements);
      frame.e = Float32Array.from(sol.e.subarray(0, this.tracer.nAtoms));
      frame.metE = sum.metE;
      frame.uncertain = sum.uncertain;
      frame.converged = sol.converged;
    }
    return frame;
  }

  /** Flux balance + isotopic steady state. */
  async runSteady(cfg, supplies, structures, onPhase) {
    let ref = null, caps = null;
    if (cfg.perturb?.length) {
      onPhase?.("ref");
      const r = await this._reference("s|" + this._key(cfg, supplies), () => this._solve(cfg, supplies));
      if (r.status === "optimal") { ref = { v: r.v, objective: r.objective }; caps = this._caps(cfg.perturb, r.v); }
      onPhase?.("run");
    }
    const res = await this._solve(cfg, supplies, null, null, caps);
    if (res.status !== "optimal") return { frames: [{ t: 0, v: res.v, status: res.status, objective: 0, inputs: [], ref }], solveMs: res.ms };
    const inputs = this._inputs(res, supplies);
    const elements = this._elements(supplies, structures);
    let prog = null, sol = null;
    if (inputs.some((i) => i.label)) {
      prog = this.tracer.compile(res.v, inputs);
      sol = this.tracer.advance(prog, null, Infinity);
    }
    return { frames: [this._frame(0, res, inputs, prog, sol, elements, { ref })], solveMs: res.ms };
  }

  /**
   * Approximate dynamics: medium pools are depleted, uptake follows Michaelis-Menten
   * kinetics, FBA is re-solved when uptake capacities move, and label fills finite pools.
   * @param dyn { hours, biomass (gDW/L), pool (mmol/gDW), frames }
   */
  async runDynamic(cfg, supplies, structures, dyn, onProgress) {
    if (!cfg.perturb?.length) return this._dynamic(cfg, supplies, structures, dyn, (p, f, fs) => onProgress?.(p, f, fs, "run"));
    // perturbed run: an unperturbed run on the same time grid is the reference for every frame
    const key = "d|" + JSON.stringify([dyn.hours, dyn.biomass, dyn.pool, dyn.frames, (dyn.events || []).map((ev) => [ev.t, ev.type, ev.met, ev.conc, ev.items])]) + this._key(cfg, supplies);
    const ref = await this._reference(key, () => this._dynamic(cfg, supplies, structures, dyn, (p, f, fs) => onProgress?.(p, f, fs, "ref"), null, true));
    const f0 = ref.frames[0];
    const caps = f0 && f0.status === "optimal" ? this._caps(cfg.perturb, f0.v) : null;
    const attach = (f, k) => {
      const r = ref.frames[Math.min(k, ref.frames.length - 1)];
      f.ref = r && r.status === "optimal" ? { v: r.v, objective: r.objective, biomass: r.biomass } : null;
    };
    const res = await this._dynamic(cfg, supplies, structures, dyn, (p, f, fs) => { attach(f, fs.length - 1); onProgress?.(p, f, fs, "run"); }, caps);
    res.frames.forEach(attach);
    return res;
  }

  /**
   * @param dyn.events scheduled changes of the medium, applied at their time t (hours):
   *   { t, type: "add", met, conc, vmax, km, label?, fraction? }   add `conc` mM of an extracellular metabolite
   *   { t, type: "medium", items: [{ met, conc, vmax, km, unlimited, hold }] }   replace the whole medium (unlabelled)
   */
  async _dynamic(cfg, supplies, structures, dyn, onProgress, pertCaps, noTracer) {
    const { model, exchanges, tracer } = this;
    const T = dyn.hours;
    const events = (dyn.events || []).filter((ev) => ev.t < T).map((ev) => ({ ...ev, t: Math.max(0, ev.t) })).sort((a, b) => a.t - b.t);
    const hasLabel = (it) => !!(it.label && it.label.some((x) => x > 0));
    const elements = this._elements([...supplies, ...events.filter((ev) => ev.type === "add")], structures);

    // ---- state of the medium: concentration and isotopic make-up of every component
    // A component is a mix of batches (what was there, what was added later); uptake does not tell them apart.
    const injections = supplies.filter((it) => !exchanges.has(it.met));
    const st = new Map(), outConc = new Map(), instant = new Set();
    const tracked = (s) => !s.unlimited && !s.hold; // finite and not replenished: it gets depleted
    const put = (it, labelled) => {
      const conc = it.unlimited ? 1 : it.conc;
      st.set(it.met, {
        conc, vmax: it.vmax, km: it.km, unlimited: !!it.unlimited, hold: !!it.hold,
        batches: conc > 0 ? [{ amt: conc, label: labelled && hasLabel(it) ? Float64Array.from(it.label, (x) => (x > 0 ? 1 : 0)) : null, frac: it.fraction ?? 1 }] : [],
      });
    };
    for (const it of supplies) if (exchanges.has(it.met)) put(it, true);
    const apply = (ev) => {
      if (ev.type === "medium") {
        const keep = new Set(ev.items.map((it) => it.met));
        for (const [met, s] of st) if (!keep.has(met)) { s.conc = 0; s.unlimited = false; s.hold = false; s.batches = []; }
        for (const it of ev.items) if (exchanges.has(it.met)) put(it, false);
        outConc.clear(); // secreted products are washed away with the old medium
      } else if (exchanges.has(ev.met) && ev.conc > 0) {
        let s = st.get(ev.met);
        if (!s) st.set(ev.met, (s = { conc: 0, vmax: ev.vmax, km: ev.km, unlimited: false, hold: false, batches: [] }));
        if (s.unlimited) return;
        s.conc += ev.conc;
        s.batches.push({ amt: ev.conc, label: hasLabel(ev) ? Float64Array.from(ev.label, (x) => (x > 0 ? 1 : 0)) : null, frac: ev.fraction ?? 1 });
      }
    };
    const supplyList = () => [...injections, ...[...st].map(([met, s]) => ({ met, conc: s.conc, vmax: s.vmax, km: s.km, unlimited: s.unlimited, hold: s.hold }))];
    const mkInputs = (res) => {
      const inputs = [];
      for (const [met, ex] of exchanges) {
        const up = res.v[ex.rxn] * ex.dir;
        if (!(up > 1e-9)) continue;
        const s = st.get(met);
        let label = null, batches = null;
        if (s && s.batches.some((b) => b.label)) {
          const tot = s.batches.reduce((a, b) => a + b.amt, 0), n = tracer.atomsOf(met);
          label = new Float64Array(n);
          for (const b of s.batches) if (b.label) for (let a = 0; a < n; a++) label[a] += (b.amt * b.frac * b.label[a]) / tot;
          batches = s.batches.map((b) => ({ w: b.amt / tot, label: b.label, frac: b.frac }));
        }
        inputs.push({ met, flux: up, label, batches });
      }
      res.srcItems.forEach((it, i) => {
        if (res.sourceFlux[i] > 1e-9) inputs.push({ met: it.met, flux: res.sourceFlux[i], label: hasLabel(it) ? Float64Array.from(it.label, (x) => x * (it.fraction ?? 1)) : null });
      });
      return inputs;
    };

    // ---- time grid: logarithmic from 10 s after the start and after every event, when label moves fastest
    const t0 = 10 / 3600;
    const cuts = [0, ...new Set(events.map((ev) => ev.t).filter((t) => t > 0)), T];
    const nSeg = cuts.length - 1, per = nSeg === 1 ? dyn.frames || 30 : Math.max(10, Math.min(20, Math.floor(90 / nSeg)));
    const times = [0];
    for (let g = 0; g < nSeg; g++) {
      const a = cuts[g], len = cuts[g + 1] - a;
      if (len <= t0 * 1.5) { times.push(cuts[g + 1]); continue; }
      for (let i = 0; i < per; i++) times.push(i === per - 1 ? cuts[g + 1] : a + t0 * Math.pow(len / t0, i / (per - 1)));
    }

    const isBiomassObj = !!model.rxns[cfg.objective].obj;
    // a measured uptake replaces the kinetic ceiling of the medium (see _applyMeasured)
    const measUp = new Map();
    if (cfg.measured?.items) for (const x of cfg.measured.items) if (x.rate > 0) measUp.set(x.met, x.rate * (1 + (cfg.measured.tol ?? 0.2)));
    let X = dyn.biomass, res = null, prog = null, lastCaps = null, e = null, solveMs = 0, solves = 0, labelOn = false;
    const frames = [];
    const poolOf = (m) => {
      if (model.mets[m].c !== "e") return dyn.pool;
      const s = st.get(m);
      if (s) return tracked(s) ? 0 : s.conc / X; // a depleting component is defined directly by its (labelled) input
      return (outConc.get(m) || 0) / X;
    };
    const snapshot = () => {
      const c = new Map(outConc);
      for (const [met, s] of st) if (!s.unlimited) c.set(met, s.conc);
      return c;
    };
    for (let k = 1; k < times.length; k++) {
      const dt = times[k] - times[k - 1];
      let need = !res;
      for (const ev of events) if (ev.t === times[k - 1]) { apply(ev); need = true; }
      // uptake capacity cannot exceed what is physically left in the medium
      const caps = new Map(), limit = new Map();
      for (const [met, s] of st) {
        if (!tracked(s)) continue;
        instant.add(met);
        const avail = s.conc / (X * dt);
        caps.set(met, Math.min(measUp.get(met) ?? uptakeCapacity(s.conc, s.vmax, s.km), avail));
        limit.set(met, avail);
      }
      if (!need) for (const [m, cap] of caps) {
        const prev = lastCaps.get(m) ?? 0, ex = exchanges.get(m);
        const used = res.v[ex.rxn] * ex.dir;
        // re-solve only when a binding capacity moved noticeably (each solve costs seconds)
        if (used > cap * 1.08 || (used > prev * 0.98 && cap > prev * 1.08)) { need = true; break; }
      }
      if (need) {
        res = await this._solve(cfg, supplyList(), null, limit, pertCaps);
        solveMs += res.ms; solves++;
        lastCaps = caps;
        if (res.status !== "optimal") {
          frames.push({ t: times[k], v: res.v, status: res.status, objective: 0, inputs: [], conc: snapshot(), biomass: X });
          break;
        }
        res.inputs = mkInputs(res);
        // once label has entered the cell it keeps being tracked, also after it is gone from the medium
        labelOn ||= res.inputs.some((i) => i.label);
        prog = !noTracer && labelOn ? tracer.compile(res.v, res.inputs) : null;
      }
      let sol = null;
      if (prog) { sol = tracer.advance(prog, e, dt, poolOf); e = sol.e; }
      // medium update
      for (const [met, ex] of exchanges) {
        const up = res.v[ex.rxn] * ex.dir;
        if (Math.abs(up) < 1e-12) continue;
        const s = st.get(met);
        if (!s) { if (up < 0) outConc.set(met, (outConc.get(met) || 0) - up * X * dt); continue; }
        if (!tracked(s)) continue; // replenished / unlimited components
        const next = Math.max(0, s.conc - up * X * dt);
        if (up > 0) { const f = s.conc > 0 ? next / s.conc : 0; for (const b of s.batches) b.amt *= f; }
        else { // secreted into a medium component: counted as unlabelled
          let b = s.batches.find((x) => !x.label);
          if (!b) s.batches.push((b = { amt: 0, label: null, frac: 1 }));
          b.amt += next - s.conc;
        }
        s.conc = next;
      }
      if (isBiomassObj) X *= Math.exp(res.objective * dt);
      const frame = this._frame(times[k], res, res.inputs, prog, sol, elements, { conc: snapshot(), biomass: X });
      frames.push(frame);
      onProgress?.(k / (times.length - 1), frame, frames);
    }
    return { frames, solveMs, solves, instant, events: events.map((ev) => ({ t: ev.t, type: ev.type, met: ev.met })) };
  }
}
