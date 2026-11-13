// Simulation orchestration: medium -> bounds -> FBA (worker) -> isotope propagation.
import { packNetwork } from "./core/fba.js";
import { applyMedium, findExchanges, uptakeCapacity, UNLIMITED } from "./core/medium.js";
import { Tracer } from "./core/tracer.js";
import { t } from "./i18n.js";

export class Simulator {
  constructor(model, structures, atommaps) {
    this.model = model;
    this.tracer = new Tracer(model, structures, atommaps);
    this.exchanges = findExchanges(model);
    this.baseLb = Float64Array.from(model.rxns, (r) => r.lb);
    this.baseUb = Float64Array.from(model.rxns, (r) => r.ub);
    this.worker = new Worker(new URL("./core/solver.worker.js", import.meta.url), { type: "module" });
    this.pending = new Map();
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

  dispose() { this.worker.terminate(); }

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
    return JSON.stringify([cfg.objective, cfg.maximize, cfg.parsimonious, supplies.map((it) => [it.met, it.conc, it.vmax, it.km, it.unlimited ? 1 : 0, it.hold ? 1 : 0])]);
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
    if (pertCaps) {
      for (const [j, cap] of pertCaps) {
        ub[j] = Math.min(ub[j], cap); lb[j] = Math.max(lb[j], -cap);
        if (lb[j] > ub[j]) lb[j] = ub[j] = cap === 0 ? 0 : Math.sign(lb[j]) * cap;
      }
    }
    await this.ready;
    const res = await this._call({
      type: "solve",
      params: { lb, ub, objective: cfg.objective, maximize: cfg.maximize, parsimonious: cfg.parsimonious, sources },
    });
    res.srcItems = srcItems;
    return res;
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
    const frame = { t, v: res.v, status: res.status, objective: res.objective, inputs, sourceFlux: res.sourceFlux, srcItems: res.srcItems, elements, ...extra };
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
    const key = "d|" + JSON.stringify([dyn.hours, dyn.biomass, dyn.pool, dyn.frames]) + this._key(cfg, supplies);
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

  async _dynamic(cfg, supplies, structures, dyn, onProgress, pertCaps, noTracer) {
    const { model, exchanges, tracer } = this;
    const elements = this._elements(supplies, structures);
    const nF = dyn.frames || 30;
    const t0 = 10 / 3600, T = dyn.hours;
    const times = [0];
    for (let i = 0; i < nF; i++) times.push(t0 * Math.pow(T / t0, i / (nF - 1)));
    const conc = new Map(); // extracellular concentrations (mM)
    const tracked = new Set();
    const held = new Set(); // replenished components (e.g. O2 through gas exchange) keep their concentration
    for (const it of supplies) {
      if (!exchanges.has(it.met) || it.unlimited) continue;
      conc.set(it.met, it.conc);
      if (it.hold) held.add(it.met); else tracked.add(it.met);
    }
    const isBiomassObj = !!model.rxns[cfg.objective].obj;
    let X = dyn.biomass, res = null, prog = null, lastCaps = null, e = null, solveMs = 0, solves = 0;
    const frames = [];
    const poolOf = (m) => {
      if (model.mets[m].c !== "e") return dyn.pool;
      if (tracked.has(m)) return 0; // defined directly by the (labelled) medium input
      return (conc.get(m) || 0) / X;
    };
    for (let k = 1; k < times.length; k++) {
      const dt = times[k] - times[k - 1];
      // uptake capacity cannot exceed what is physically left in the medium
      const caps = new Map(), limit = new Map();
      for (const it of supplies) {
        if (!tracked.has(it.met)) continue;
        const c = conc.get(it.met);
        const avail = c / (X * dt);
        caps.set(it.met, Math.min(uptakeCapacity(c, it.vmax, it.km), avail));
        limit.set(it.met, avail);
      }
      let need = !res;
      if (!need) for (const [m, cap] of caps) {
        const prev = lastCaps.get(m), ex = exchanges.get(m);
        const used = res.v[ex.rxn] * ex.dir;
        // re-solve only when a binding capacity moved noticeably (each solve costs seconds)
        if (used > cap * 1.08 || (used > prev * 0.98 && cap > prev * 1.08)) { need = true; break; }
      }
      if (need) {
        res = await this._solve(cfg, supplies, conc, limit, pertCaps);
        solveMs += res.ms; solves++;
        lastCaps = caps;
        if (res.status !== "optimal") {
          frames.push({ t: times[k], v: res.v, status: res.status, objective: 0, inputs: [], conc: new Map(conc), biomass: X });
          break;
        }
        const inputs = this._inputs(res, supplies);
        res.inputs = inputs;
        prog = !noTracer && inputs.some((i) => i.label) ? tracer.compile(res.v, inputs) : null;
      }
      let sol = null;
      if (prog) { sol = tracer.advance(prog, e, dt, poolOf); e = sol.e; }
      // medium update
      for (const [met, ex] of exchanges) {
        const up = res.v[ex.rxn] * ex.dir;
        if (Math.abs(up) < 1e-12) continue;
        if (held.has(met) || (up > 0 && !tracked.has(met))) continue; // replenished / unlimited components
        conc.set(met, Math.max(0, (conc.get(met) || 0) - up * X * dt));
      }
      if (isBiomassObj) X *= Math.exp(res.objective * dt);
      const frame = this._frame(times[k], res, res.inputs, prog, sol, elements, { conc: new Map(conc), biomass: X });
      frames.push(frame);
      onProgress?.(k / (times.length - 1), frame, frames);
    }
    return { frames, solveMs, solves };
  }
}
