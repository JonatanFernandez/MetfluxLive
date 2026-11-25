// Canvas renderer for the global (subsystem) map and the per-pathway maps.
// Flux is encoded as edge width, particle speed and node size; isotope enrichment as colour.

import { fluxChange } from "../core/change.js";

const UNIT = 64; // px per layout unit at zoom 1
const COMP_DARK = {
  c: "#8fa3c8", m: "#ff9f5a", e: "#5fd38d", s: "#5fd38d", r: "#b48cff", x: "#3fd0c9",
  l: "#ff7eb6", g: "#f2d45c", n: "#6aa9ff", i: "#ff6b6b",
};
const COMP_LIGHT = {
  c: "#6f82aa", m: "#e07f3c", e: "#3c9e64", s: "#3c9e64", r: "#8d68d6", x: "#2a9e98",
  l: "#d65c94", g: "#b8981e", n: "#4a82d6", i: "#d65656",
};
/** Compartment colours of the current theme (mutated in place by setMapTheme). */
export const COMP_COLORS = { ...COMP_DARK };
// neutral colours of the map; the data ramps (enrichment, change, free energy) are shared by both themes
const THEMES = {
  dark: {
    flux: [76, 201, 240], particle: "rgba(190,240,255,0.85)", blend: "lighter", halo: "rgba(8,12,24,0.92)",
    inactiveEdge: "rgba(125,145,190,0.13)", structEdge: "rgba(125,145,190,0.10)", guide: "rgba(125,145,190,0.25)", guideText: "rgba(147,162,198,0.9)",
    metOn: "#1d3350", metOff: "#141c30", rxnOn: "#e8eefc", rxnTransport: "#9fb4d8", rxnOff: "#2a3552",
    labelOn: "#eef3ff", labelOff: "rgba(170,185,215,0.6)", rxnLabelOn: "#b8c6e6", rxnLabelOff: "rgba(140,155,190,0.5)", groupLabelOff: "rgba(165,180,212,0.62)",
    hover: "rgba(255,255,255,0.55)", selected: "#ffffff", pulse: [255, 255, 255], gene: "#b48cff", regUp: "#3ddc97", regDown: "#ffa03c", ko: "#ff5d6c", blocked: "#6b768f", flexFix: "#5fd38d", flexOpt: "#ffbe3c", rev: "#e15bd8",
    groupOff: "#151d33", groupRing: "rgba(235,242,255,0.9)", groupRingOff: "rgba(130,148,190,0.45)", groupListOnly: "rgba(160,175,210,0.45)",
    groupFill: (s) => `rgb(${28 + 30 * s},${60 + 90 * s},${92 + 110 * s})`, unknown: [70, 80, 108],
  },
  light: {
    flux: [43, 124, 170], particle: "rgba(30,96,140,0.75)", blend: "source-over", halo: "rgba(247,248,251,0.92)",
    inactiveEdge: "rgba(90,105,140,0.18)", structEdge: "rgba(90,105,140,0.13)", guide: "rgba(90,105,140,0.3)", guideText: "rgba(95,108,135,0.95)",
    metOn: "#d3e3f0", metOff: "#eef1f6", rxnOn: "#3a4560", rxnTransport: "#7f8fb2", rxnOff: "#c9d0dd",
    labelOn: "#263046", labelOff: "rgba(90,102,128,0.65)", rxnLabelOn: "#4a5672", rxnLabelOff: "rgba(110,122,148,0.55)", groupLabelOff: "rgba(95,108,135,0.7)",
    hover: "rgba(40,50,70,0.45)", selected: "#283044", pulse: [40, 60, 90], gene: "#8d68d6", regUp: "#0e8f63", regDown: "#b55309", ko: "#d04452", blocked: "#9aa3b4", flexFix: "#2f8a52", flexOpt: "#b26f0e", rev: "#b0309f",
    groupOff: "#e6eaf1", groupRing: "rgba(45,62,92,0.75)", groupRingOff: "rgba(120,134,165,0.45)", groupListOnly: "rgba(120,134,165,0.45)",
    groupFill: (s) => `rgb(${222 - 150 * s},${234 - 100 * s},${244 - 60 * s})`, unknown: [196, 202, 214],
  },
};
let TH = THEMES.dark, themeName = "dark";

/**
 * Colour scales the user can choose (Appearance dialog). Every ramp starts and ends at mid lightness, so that both
 * ends stay visible on the dark and the light background.
 */
export const SCALES = {
  // enrichment, from unlabelled to fully labelled
  enrich: {
    default: [[118, 136, 176], [255, 190, 60], [255, 120, 50], [255, 45, 120]], // slate -> amber -> magenta
    viridis: [[72, 40, 120], [49, 104, 142], [33, 145, 140], [94, 201, 98], [222, 205, 30]],
    plasma: [[106, 0, 168], [177, 42, 144], [225, 100, 98], [252, 166, 54], [230, 210, 40]],
    coolwarm: [[118, 136, 176], [80, 160, 230], [235, 140, 80], [210, 40, 50]],
  },
  // change against the reference: down / up (the midpoint is always neutral slate)
  delta: {
    default: { down: [90, 150, 255], up: [255, 159, 90] }, // blue - orange
    redblue: { down: [70, 130, 235], up: [230, 75, 70] },
    greenpurple: { down: [165, 105, 230], up: [60, 180, 105] },
  },
  // free energy: uphill colour, and the downhill ramp
  energy: {
    default: { up: [176, 120, 255], down: [[124, 138, 170], [255, 196, 70], [255, 80, 60]] },
    cb: { up: [70, 150, 240], down: [[124, 138, 170], [235, 195, 60], [225, 110, 20]] },
  },
  // compartments: a set chosen by search so that every pair stays apart under protanopia and deuteranopia
  // (OKLab ΔE ≥ 11 on the dark background, ≥ 7.6 on the light one, where the [c]/[m] labels and the legend also name them)
  comp: {
    default: null,
    cvd: {
      dark: { c: "#ffffff", m: "#e69f00", i: "#e69f00", e: "#009e73", s: "#009e73", r: "#b48cff", x: "#8a5a00", l: "#ffb3d1", g: "#f0e442", n: "#0072b2" },
      light: { c: "#000000", m: "#8a5a00", i: "#8a5a00", e: "#2f8a52", s: "#2f8a52", r: "#5e3c99", x: "#56b4e9", l: "#cc79a7", g: "#b8a800", n: "#0072b2" },
    },
  },
  // colour of flux lines (null = the theme's own)
  flux: {
    default: null,
    green: { dark: [95, 211, 141], light: [47, 138, 82] },
    orange: { dark: [255, 159, 90], light: [196, 100, 30] },
    violet: { dark: [180, 140, 255], light: [118, 80, 196] },
    grey: { dark: [205, 214, 235], light: [70, 80, 100] },
  },
};
let LOOK = { enrich: "default", delta: "default", energy: "default", comp: "default", flux: "default" };
let RAMP = SCALES.enrich.default;
let D_UP = SCALES.delta.default.up, D_DOWN = SCALES.delta.default.down;
const D_SAME = [124, 138, 170];
let G_DOWN = SCALES.energy.default.down, G_UP = SCALES.energy.default.up;

function applyLook() {
  const pick = (k) => SCALES[k][LOOK[k]] ?? SCALES[k].default;
  RAMP = pick("enrich");
  ({ up: D_UP, down: D_DOWN } = pick("delta"));
  ({ up: G_UP, down: G_DOWN } = pick("energy"));
  const base = THEMES[themeName] || THEMES.dark, fl = pick("flux")?.[themeName === "light" ? "light" : "dark"];
  if (fl) {
    const mix = (a, b, k) => a.map((x, i) => Math.round(x + (b[i] - x) * k));
    const lightT = themeName === "light", off = lightT ? [230, 234, 241] : [21, 29, 51];
    TH = { ...base, flux: fl, particle: `rgba(${mix(fl, lightT ? [0, 0, 0] : [255, 255, 255], lightT ? 0.3 : 0.55).join(",")},0.85)`,
      groupFill: (x) => `rgb(${mix(off, fl, 0.3 + 0.7 * x).join(",")})` };
  } else TH = base;
  const comp = pick("comp")?.[themeName === "light" ? "light" : "dark"];
  Object.assign(COMP_COLORS, comp || (themeName === "light" ? COMP_LIGHT : COMP_DARK));
}

/** Switch the neutral colours of every map (and COMP_COLORS) to "dark" or "light". */
// Compartment colours are keyed by Human-GEM's compartment letters; other models map theirs by role
// (yeast-GEM "p" is the peroxisome, iML1515 "p" the periplasm…), set with setCompAliases().
let COMP_ALIAS = {};
const ROLE_KEY = { cyt: "c", ext: "e", mito: "m", inner: "i", nuc: "n", er: "r", golgi: "g", lyso: "l", perox: "x", vac: "l", peri: "s", lipid: "g" };
export function setCompAliases(compRole, membraneOf = {}) {
  COMP_ALIAS = {};
  for (const [c, role] of Object.entries(compRole)) if (ROLE_KEY[role]) COMP_ALIAS[c] = ROLE_KEY[role];
  for (const [c, parent] of Object.entries(membraneOf)) COMP_ALIAS[c] = COMP_ALIAS[parent] || parent;
}
export const compColor = (c) => COMP_COLORS[COMP_ALIAS[c] ?? c] || COMP_COLORS.c;

export function setMapTheme(name) {
  themeName = THEMES[name] ? name : "dark";
  applyLook();
}

/** Choose colour scales: { enrich, delta, energy, comp, flux } (names from SCALES; unknown names = default). */
export function setMapLook(look) {
  LOOK = { ...LOOK, ...look };
  applyLook();
}

export function enrichColor(e, alpha = 1) {
  const t = Math.pow(Math.min(1, Math.max(0, e)), 0.55) * (RAMP.length - 1);
  const i = Math.min(RAMP.length - 2, Math.floor(t)), f = t - i;
  const c = RAMP[i].map((x, k) => Math.round(x + (RAMP[i + 1][k] - x) * f));
  return `rgba(${c[0]},${c[1]},${c[2]},${alpha})`;
}

/** Colour that marks a reaction running the other way in B ("A → B" view). */
export const revColor = () => TH.rev;
/** The two regulon ring colours, for the legend. */
export const regColors = () => ({ up: TH.regUp, down: TH.regDown, mixed: TH.gene });

// flux change against the reference: blue (down) - slate (same) - orange (up) by default
export function deltaColor(d, alpha = 1) {
  const k = d ? Math.min(1, 0.3 + Math.abs(d) * 1.2) : 0, to = d > 0 ? D_UP : D_DOWN;
  const c = D_SAME.map((x, i) => Math.round(x + (to[i] - x) * k));
  return `rgba(${c[0]},${c[1]},${c[2]},${alpha})`;
}
// free energy: violet (uphill at 1 mM) - slate (near equilibrium) - amber - red (strongly dissipating); NaN = unknown
export function energyColor(g, alpha = 1) {
  if (!Number.isFinite(g)) return `rgba(${TH.unknown[0]},${TH.unknown[1]},${TH.unknown[2]},${alpha})`;
  let c;
  if (g >= 0) {
    const t = Math.min(1, g) * 2, i = Math.min(1, Math.floor(t)), f = t - i;
    c = G_DOWN[i].map((x, k) => Math.round(x + (G_DOWN[i + 1][k] - x) * f));
  } else {
    const k = Math.min(1, -g);
    c = G_DOWN[0].map((x, i) => Math.round(x + (G_UP[i] - x) * k));
  }
  return `rgba(${c[0]},${c[1]},${c[2]},${alpha})`;
}
const hexA = (hex, a) => `rgba(${parseInt(hex.slice(1, 3), 16)},${parseInt(hex.slice(3, 5), 16)},${parseInt(hex.slice(5, 7), 16)},${a})`;

export class MapView {
  constructor(canvas, hooks) {
    this.canvas = canvas;
    this.ctx = canvas.getContext("2d");
    this.hooks = hooks; // { onSelect(node), onOpen(node), onHover(node, x, y) }
    this.cam = { x: 0, y: 0, z: 1 };
    this.camTarget = null;
    this.scene = { kind: "empty", nodes: [], edges: [] };
    this.hover = -1;
    this.selected = -1;
    this.pulse = null;
    this.options = { particles: true, inactive: true };
    this.tracerOn = false;
    this.mode = "flux"; // flux | tracer | delta
    this.masked = false;
    this.time = 0;
    this._bind();
    this._resize();
    new ResizeObserver(() => this._resize()).observe(canvas.parentElement);
    const loop = (t) => { this._frame(t); requestAnimationFrame(loop); };
    requestAnimationFrame(loop);
  }

  // ------------------------------------------------------------ scene ----
  setScene(scene, keepCamera = false) {
    this.scene = scene;
    this.hover = -1;
    this.selected = -1;
    scene.nodes.forEach((n) => { n.s = 0; n.e = 0; n.flux = 0; });
    scene.edges.forEach((e, i) => { e.s = 0; e.flux = 0; e.phase = (i * 0.618) % 1; });
    if (!keepCamera) this.fit(false);
  }

  /** Frame the scene; with activeOnly, frame just the nodes carrying flux (if any). */
  fit(animate = true, activeOnly = false) {
    let ns = this.scene.nodes;
    if (!ns.length) return;
    if (this.masked) { const vis = ns.filter((n) => !n.hidden); if (vis.length) ns = vis; }
    if (activeOnly) { const act = ns.filter((n) => n.s > 0 || (this.masked && !n.hidden)); if (act.length >= 2) ns = act; }
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const n of ns) { const r = n.type === 2 ? n.r : 0; x0 = Math.min(x0, n.x - r); y0 = Math.min(y0, n.y - r); x1 = Math.max(x1, n.x + r); y1 = Math.max(y1, n.y + r); }
    // the cell backdrop is always framed whole, so that the organelles keep their context
    for (const r of this.scene.regions || []) { x0 = Math.min(x0, r.x - r.rx); y0 = Math.min(y0, r.y - r.ry, r.ly ?? r.y); x1 = Math.max(x1, r.x + r.rx); y1 = Math.max(y1, r.y + r.ry); }
    const w = this.w, h = this.h, pad = 90;
    const z = Math.min((w - 2 * pad) / Math.max(1e-6, (x1 - x0) * UNIT), (h - 2 * pad) / Math.max(1e-6, (y1 - y0) * UNIT), 2.2);
    const target = { x: (x0 + x1) / 2, y: (y0 + y1) / 2, z: Math.max(z, 0.04) };
    this.homeZoom = target.z;
    if (animate) this.camTarget = target; else { this.cam = target; this.camTarget = null; }
  }

  focusNode(i, zoom) {
    const n = this.scene.nodes[i];
    if (!n) return;
    this.camTarget = { x: n.x, y: n.y, z: zoom ?? Math.min(1.5, Math.max(this.cam.z, 1.0, (this.homeZoom || 1) * 1.6)) };
    this.selected = i;
    this.pulse = { node: i, t0: performance.now() };
  }

  findNode(type, ref) { return this.scene.nodes.findIndex((n) => n.type === type && n.ref === ref); }

  /**
   * Push per-frame values.
   * sub scenes: { v, turnover, metE, uncertain, ref, refE (label of the compared scenario), mask: { rxn, met }, perturb: Map }
   * global:     { gFlux, gE, gD, gHas, flows, minE }
   * both:       { mode: "flux" | "tracer" | "delta" | "dlabel" }
   */
  setData(d) {
    const sc = this.scene;
    // "dlabel" (label difference against a compared scenario) is drawn with the delta colours
    this.dlabel = d.mode === "dlabel";
    // free energy (dG'm per reaction, or per group) is drawn with the delta machinery and its own palette
    this.energy = !!(d.dG || d.energy);
    // "change" (A → B view): colour = change of size, width = |B − A|, reversals / on / off marked apart (core/change.js)
    this.change = d.mode === "change" && !this.energy && !this.dlabel;
    this.mtbOn = !!(d.mtb || d.mtbGlobal);
    this.rnaOn = !!(d.rna || d.rnaGlobal);
    this.mode = this.dlabel || this.energy || this.change ? "delta" : d.mode || "flux";
    this.tracerOn = this.mode === "tracer";
    this.masked = !!(d.mask || d.gHas);
    const logScale = (x, max, dec = 4, floor = 0.04) => (x > 0 && max > 0 ? Math.min(1, Math.max(floor, 1 + Math.log10(x / max) / dec)) : 0);
    const rel = (a, b) => { const m = Math.max(a, b); return m > 0 ? (a - b) / m : 0; };
    if (sc.kind === "sub") {
      const mask = d.mask, ref = d.ref;
      let max = 0;
      // with a cofactor chosen, a reaction's edges carry how much of it the reaction makes or uses (d.qflux)
      const fl = (e) => { const j = sc.nodes[e.r].ref, x = d.v ? d.v[j] * e.coef : 0; return d.qflux ? Math.sign(x) * d.qflux[j] : x; };
      const chg = this.change && ref;
      let dmax = 0;
      for (const e of sc.edges) {
        const f = fl(e); e.f = f; if (Math.abs(f) > max) max = Math.abs(f);
        if (chg) {
          const a = ref[sc.nodes[e.r].ref] * e.coef;
          e.fa = a; e.dflux = Math.abs(f - a);
          if (Math.abs(a) > max) max = Math.abs(a);
          if (e.dflux > dmax) dmax = e.dflux;
        }
      }
      let tmax = 0;
      for (const n of sc.nodes) if (n.type === 0 && d.turnover) tmax = Math.max(tmax, d.turnover[n.ref], chg && d.refTurnover ? d.refTurnover[n.ref] : 0);
      const mtb = d.mtb || null, rna = d.rna || null;
      for (const n of sc.nodes) {
        if (n.type === 0) {
          n.flux = d.turnover ? d.turnover[n.ref] : 0; n.s = logScale(n.flux, tmax);
          n.e = d.metE ? d.metE[n.ref] : 0; n.unc = d.uncertain ? d.uncertain[n.ref] : 0;
          n.de = this.dlabel ? Math.max(-1, Math.min(1, 3 * (n.e - (d.refE ? d.refE[n.ref] : 0)))) : 0;
          if (chg && d.refTurnover) { // size from the larger of A and B, colour from the change of turnover
            const t0 = d.refTurnover[n.ref];
            n.s = logScale(Math.max(n.flux, t0), tmax); n.de = fluxChange(t0, n.flux).size;
          }
          n.hidden = !!mask && !mask.met[n.ref];
          const fc = mtb ? mtb.fcByMet.get(n.ref) : undefined;
          n.mtbFc = fc !== undefined ? fc : NaN;
          n.mtbSig = !!(mtb && mtb.sigMets.has(n.ref));
        } else {
          n.flux = d.qflux ? d.qflux[n.ref] : d.v ? Math.abs(d.v[n.ref]) : 0; n.s = logScale(n.flux, max); n.dir = d.v ? Math.sign(d.v[n.ref]) : 0;
          const f0 = ref ? Math.abs(ref[n.ref]) : n.flux;
          n.d = rel(n.flux, f0); n.lost = !n.flux && f0 > 0; n.ck = null;
          if (chg) {
            const c = fluxChange(ref[n.ref], d.v ? d.v[n.ref] : 0);
            n.d = c.size; n.ck = c.kind; n.lost = false;
            n.s = logScale(Math.max(Math.abs(ref[n.ref]), n.flux), max);
          }
          n.hidden = !!mask && !mask.rxn[n.ref];
          n.pert = d.perturb ? d.perturb.get(n.ref) : undefined;
          n.blk = !!(d.blocked && d.blocked.has(n.ref)); // no detected enzyme in the chosen cell type
          n.fx = d.flex ? d.flex.get(n.ref)?.cls : undefined; // flux variability class (FVA of the pathway)
          n.mtbObs = !!(mtb && mtb.obsRxns.has(n.ref));
          n.mtbTop = !!(mtb && mtb.topSteps.has(n.ref));
          const rfc = rna ? rna.fcByRxn.get(n.ref) : undefined;
          n.rnaFc = rfc !== undefined ? rfc : NaN;
          n.rnaSig = !!(rna && rna.sigRxns.has(n.ref));
          n.rnaIso = !!(rna && rna.isoRxns.has(n.ref));
        }
      }
      if (d.dG) { // reactions coloured by dG'm in the direction they run: -40 kJ/mol and below is full red
        for (const n of sc.nodes) {
          if (n.type !== 1) continue;
          const g = d.dG[n.ref], run = d.v && d.v[n.ref] ? Math.sign(d.v[n.ref]) * g : g;
          n.d = Number.isFinite(g) ? Math.max(-1, Math.min(1, -run / 40)) : NaN; n.lost = false;
        }
      }
      if (this.dlabel) { // a reaction takes the mean label change of the metabolites it touches
        const sum = new Map();
        for (const e of sc.edges) { const o = sum.get(e.r) || [0, 0]; o[0] += sc.nodes[e.m].de; o[1]++; sum.set(e.r, o); }
        for (const [i, o] of sum) { sc.nodes[i].d = o[0] / o[1]; sc.nodes[i].lost = false; }
      }
      for (const e of sc.edges) {
        const r = sc.nodes[e.r], m = sc.nodes[e.m];
        e.flux = Math.abs(e.f);
        e.s = logScale(e.flux, max);
        e.out = e.f > 0; // reaction -> metabolite
        e.e = m.e; e.d = this.dlabel ? m.de : r.d; e.lost = r.lost; e.ck = r.ck;
        if (chg) { // width = how much flux moved on this edge; unchanged flux stays as a thin grey line
          const moved = r.ck !== "same" && r.ck !== "zero";
          e.s = moved ? Math.max(0.08, logScale(e.dflux, dmax)) : e.f || e.fa ? 0.02 : 0;
          if (!e.f) e.out = e.fa > 0; // gone in B: drawn in the direction it ran in A
        }
        e.hidden = r.hidden || m.hidden;
      }
      if (mask) { // a metabolite touched only by affected reactions outside this map would float alone
        const linked = new Set();
        for (const e of sc.edges) if (!e.hidden) linked.add(e.m);
        sc.nodes.forEach((n, i) => { if (n.type === 0 && !linked.has(i)) n.hidden = true; });
      }
      sc.max = max;
    } else if (sc.kind === "global") {
      let max = 0;
      for (const n of sc.nodes) { n.flux = d.gFlux ? d.gFlux[n.ref] : 0; if (n.flux > max) max = n.flux; }
      const mg = d.mtbGlobal || null, rg = d.rnaGlobal || null;
      for (const n of sc.nodes) {
        n.s = logScale(n.flux, max); n.e = d.gE ? d.gE[n.ref] : 0; n.d = d.energy ? d.energy[n.ref] : d.gD ? d.gD[n.ref] : 0;
        n.hidden = !!d.gHas && !d.gHas[n.ref];
        n.mtbFc = mg ? mg.medFc[n.ref] : NaN;
        n.mtbObs = !!(mg && mg.hasObs[n.ref]);
        n.mtbTop = !!(mg && mg.hasTop[n.ref]);
        n.rnaFc = rg ? rg.medFc[n.ref] : NaN;
        n.rnaN = rg ? rg.count[n.ref] : 0;
      }
      const byRef = new Map(sc.nodes.map((n, i) => [n.ref, i]));
      const fmax = d.flows && d.flows.length ? d.flows[0].flow : 0;
      sc.flows = (d.flows || []).filter((f) => byRef.has(f.a) && byRef.has(f.b) && !(d.minE && f.e < d.minE)).map((f, i) => {
        const a = byRef.get(f.a), b = byRef.get(f.b);
        return { a, b, flux: f.flow, s: logScale(f.flow, fmax, 2.6, 0), e: f.e, d: (sc.nodes[a].d + sc.nodes[b].d) / 2, phase: (i * 0.618) % 1, top: f.top };
      }).filter((f) => f.s > 0.02 && !sc.nodes[f.a].hidden && !sc.nodes[f.b].hidden);
    }
  }

  /** A node is drawn when it passes the filter and either carries flux or inactive ones are shown. */
  _vis(n) {
    return !n.hidden && (
      this.options.inactive || n.s > 0 || this.masked || this.scene.kind !== "sub"
      || (this.mtbOn && (Number.isFinite(n.mtbFc) || n.mtbObs || n.mtbTop))
      || (this.rnaOn && Number.isFinite(n.rnaFc) && Math.abs(n.rnaFc) >= 0.35)
    );
  }

  visibleCount() { let k = 0; for (const n of this.scene.nodes) if (this._vis(n)) k++; return k; }

  // ------------------------------------------------------- interaction ----
  _bind() {
    const c = this.canvas;
    let drag = null;
    c.addEventListener("wheel", (ev) => {
      ev.preventDefault();
      const r = c.getBoundingClientRect(), mx = ev.clientX - r.left, my = ev.clientY - r.top;
      const before = this.toWorld(mx, my);
      const cam = this.camTarget ? { ...this.camTarget } : { ...this.cam };
      cam.z = Math.min(8, Math.max(0.03, cam.z * Math.exp(-ev.deltaY * 0.0015)));
      this.cam.z = cam.z; this.camTarget = null;
      const after = this.toWorld(mx, my);
      this.cam.x += before.x - after.x; this.cam.y += before.y - after.y;
    }, { passive: false });
    // pointers: mouse, pen and touch. One finger pans, two fingers pinch-zoom, a long press opens the context menu,
    // a double tap opens (as a double click does)
    const pts = new Map();
    let pinch = null, press = null, lastTap = null, touchUp = 0;
    const local = (ev) => { const r = c.getBoundingClientRect(); return [ev.clientX - r.left, ev.clientY - r.top]; };
    const cancelPress = () => { if (press) { clearTimeout(press); press = null; } };
    c.addEventListener("pointerdown", (ev) => {
      c.setPointerCapture(ev.pointerId);
      pts.set(ev.pointerId, { x: ev.clientX, y: ev.clientY, touch: ev.pointerType !== "mouse" });
      this.camTarget = null;
      if (pts.size === 2) { // second finger: pinch from here on
        cancelPress(); drag = null;
        const [p, q] = [...pts.values()], r = c.getBoundingClientRect();
        const mx = (p.x + q.x) / 2 - r.left, my = (p.y + q.y) / 2 - r.top;
        pinch = { d: Math.hypot(p.x - q.x, p.y - q.y) || 1, z: this.cam.z, w: this.toWorld(mx, my) };
        return;
      }
      if (pts.size > 2) return;
      drag = { x: ev.clientX, y: ev.clientY, cx: this.cam.x, cy: this.cam.y, moved: false, touch: ev.pointerType !== "mouse" };
      if (drag.touch && this.hooks.onContext) {
        const [mx, my] = local(ev), cx = ev.clientX, cy = ev.clientY;
        press = setTimeout(() => {
          press = null;
          if (!drag || drag.moved) return;
          const h = this._hit(mx, my, true);
          if (h < 0) return;
          drag.used = true; this.selected = h;
          navigator.vibrate?.(15);
          this.hooks.onContext(this.scene.nodes[h], cx, cy);
        }, 520);
      }
    });
    c.addEventListener("pointermove", (ev) => {
      const [mx, my] = local(ev);
      const pt = pts.get(ev.pointerId);
      if (pt) { pt.x = ev.clientX; pt.y = ev.clientY; }
      if (pinch && pts.size >= 2) {
        const [p, q] = [...pts.values()], r = c.getBoundingClientRect();
        const cx = (p.x + q.x) / 2 - r.left, cy = (p.y + q.y) / 2 - r.top;
        this.cam.z = Math.min(8, Math.max(0.03, pinch.z * Math.hypot(p.x - q.x, p.y - q.y) / pinch.d));
        // keep the world point that was under the fingers' midpoint under it
        this.cam.x = pinch.w.x - (cx - this.w / 2) / (UNIT * this.cam.z);
        this.cam.y = pinch.w.y - (cy - this.h / 2) / (UNIT * this.cam.z);
        return;
      }
      if (drag) {
        const dx = ev.clientX - drag.x, dy = ev.clientY - drag.y;
        if (Math.abs(dx) + Math.abs(dy) > (drag.touch ? 8 : 3)) { drag.moved = true; cancelPress(); }
        if (drag.moved) { this.cam.x = drag.cx - dx / (UNIT * this.cam.z); this.cam.y = drag.cy - dy / (UNIT * this.cam.z); c.style.cursor = "grabbing"; return; }
      }
      if (ev.pointerType !== "mouse") return; // no hover on touch screens
      const h = this._hit(mx, my);
      if (h !== this.hover) { this.hover = h; c.style.cursor = h >= 0 ? "pointer" : "grab"; }
      this.hooks.onHover?.(h >= 0 ? this.scene.nodes[h] : null, ev.clientX, ev.clientY);
    });
    const up = (ev) => {
      pts.delete(ev.pointerId);
      if (ev.pointerType !== "mouse") touchUp = performance.now();
      if (pinch) { if (pts.size < 2) pinch = null; drag = null; return; }
      cancelPress();
      // a click that started elsewhere (e.g. on a search result lying over the map) is not a click on the map
      if (!drag || ev.type === "pointercancel") { drag = null; return; }
      const { moved, used, touch } = drag;
      drag = null; c.style.cursor = this.hover >= 0 ? "pointer" : "grab";
      if (moved || used) return;
      const [mx, my] = local(ev);
      const h = this._hit(mx, my, touch);
      if (touch) { // double tap = double click
        const now = performance.now();
        if (lastTap && now - lastTap.t < 320 && Math.hypot(mx - lastTap.x, my - lastTap.y) < 30) {
          lastTap = null;
          if (h >= 0) this.hooks.onOpen?.(this.scene.nodes[h]); else this.fit();
          return;
        }
        lastTap = { t: now, x: mx, y: my };
      }
      this.selected = h;
      this.hooks.onSelect?.(h >= 0 ? this.scene.nodes[h] : null);
    };
    c.addEventListener("pointerup", up);
    c.addEventListener("pointercancel", up);
    c.addEventListener("dblclick", (ev) => {
      if (performance.now() - touchUp < 700) return; // the double tap was already handled
      const r = c.getBoundingClientRect();
      const h = this._hit(ev.clientX - r.left, ev.clientY - r.top);
      if (h >= 0) this.hooks.onOpen?.(this.scene.nodes[h]); else this.fit();
    });
    c.addEventListener("pointerleave", () => { this.hover = -1; this.hooks.onHover?.(null); });
    // right click on a node: context menu (the app decides what is in it)
    c.addEventListener("contextmenu", (ev) => {
      if (ev.pointerType === "touch" || pts.size) { ev.preventDefault(); return; } // touch: handled by the long press
      const r = c.getBoundingClientRect();
      const h = this._hit(ev.clientX - r.left, ev.clientY - r.top);
      if (h < 0 || !this.hooks.onContext) return;
      ev.preventDefault();
      this.selected = h;
      this.hooks.onContext(this.scene.nodes[h], ev.clientX, ev.clientY);
    });
    // mouse back / forward buttons
    c.addEventListener("mouseup", (ev) => { if (ev.button === 3 || ev.button === 4) { ev.preventDefault(); this.hooks.onNav?.(ev.button === 3 ? -1 : 1); } });
  }

  toWorld(px, py) { return { x: this.cam.x + (px - this.w / 2) / (UNIT * this.cam.z), y: this.cam.y + (py - this.h / 2) / (UNIT * this.cam.z) }; }
  _sx(x) { return (x - this.cam.x) * UNIT * this.cam.z + this.w / 2; }
  _sy(y) { return (y - this.cam.y) * UNIT * this.cam.z + this.h / 2; }

  _radius(n) {
    const z = this.cam.z, k = Math.min(1.9, Math.max(0.45, Math.sqrt(z)));
    if (n.type === 2) return Math.max(3.5, n.r * UNIT * z);
    if (n.type === 0) return (n.s > 0 ? 4.5 + 8 * n.s : 3.4) * k;
    return (n.s > 0 ? 3.2 + 3 * n.s : 2.4) * k;
  }

  _hit(mx, my, touch = false) {
    const ns = this.scene.nodes;
    let best = -1, bd = 1e9;
    for (let i = 0; i < ns.length; i++) {
      const n = ns[i];
      if (!this._vis(n)) continue;
      const dx = this._sx(n.x) - mx, dy = this._sy(n.y) - my, r = this._radius(n) + (touch ? 14 : 5);
      const d = dx * dx + dy * dy;
      if (d < r * r && d < bd) { bd = d; best = i; }
    }
    return best;
  }

  _resize() {
    const p = this.canvas.parentElement, dpr = Math.min(2, window.devicePixelRatio || 1);
    this.w = p.clientWidth; this.h = p.clientHeight; this.dpr = dpr;
    this.canvas.width = Math.round(this.w * dpr); this.canvas.height = Math.round(this.h * dpr);
    this.canvas.style.width = this.w + "px"; this.canvas.style.height = this.h + "px";
  }

  // ------------------------------------------------------------ render ----
  _frame(t) {
    const dt = Math.min(0.05, (t - (this.last || t)) / 1000);
    this.last = t;
    this.time += dt;
    if (this.camTarget) {
      const k = 1 - Math.pow(0.002, dt), c = this.cam, g = this.camTarget;
      c.x += (g.x - c.x) * k; c.y += (g.y - c.y) * k; c.z *= Math.pow(g.z / c.z, k);
      if (Math.abs(g.x - c.x) < 1e-3 && Math.abs(g.y - c.y) < 1e-3 && Math.abs(g.z / c.z - 1) < 1e-3) this.camTarget = null;
    }
    const ctx = this.ctx;
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.clearRect(0, 0, this.w, this.h);
    if (this.scene.guides) this._drawGuides(ctx);
    if (this.scene.kind === "sub") this._drawSub(ctx);
    else if (this.scene.kind === "global") this._drawGlobal(ctx);
  }

  /** Cascade view: one faint line per level, labelled with its distance from the medium. */
  _drawGuides(ctx) {
    ctx.font = "11px Inter, system-ui, sans-serif"; ctx.textAlign = "left"; ctx.textBaseline = "bottom";
    for (const g of this.scene.guides) {
      const y = Math.round(this._sy(g.y)) + 0.5;
      if (y < 44 || y > this.h - 8) continue;
      ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(this.w, y);
      ctx.setLineDash([2, 6]); ctx.strokeStyle = TH.guide; ctx.lineWidth = 1; ctx.stroke(); ctx.setLineDash([]);
      ctx.fillStyle = TH.guideText; ctx.fillText(g.label, 12, y - 3);
    }
  }

  _dc(d, alpha) { return this.energy ? energyColor(d, alpha) : deltaColor(d, alpha); }

  _edgeColor(e, alpha) {
    if (this.mode === "delta") return this._dc(e.d, alpha);
    if (this.tracerOn) return enrichColor(e.e, alpha);
    return `rgba(${TH.flux[0]},${TH.flux[1]},${TH.flux[2]},${alpha})`;
  }

  _curve(ax, ay, bx, by, bend) {
    const mx = (ax + bx) / 2, my = (ay + by) / 2, dx = bx - ax, dy = by - ay;
    return [mx - dy * bend, my + dx * bend];
  }

  _drawParticles(ctx, list) {
    // list: [ax, ay, cx, cy, bx, by, s, phase, color]
    ctx.globalCompositeOperation = TH.blend;
    for (const p of list) {
      const [ax, ay, cx, cy, bx, by, s, phase, color] = p;
      const len = Math.hypot(bx - ax, by - ay);
      if (len < 14) continue;
      const count = Math.max(1, Math.min(7, Math.round(len / 55)));
      const speed = (18 + 75 * s) / len;
      const r = 1.2 + 1.9 * s;
      ctx.fillStyle = color;
      for (let k = 0; k < count; k++) {
        const u = (phase + k / count + this.time * speed) % 1, w = 1 - u;
        const x = w * w * ax + 2 * w * u * cx + u * u * bx, y = w * w * ay + 2 * w * u * cy + u * u * by;
        ctx.beginPath(); ctx.arc(x, y, r, 0, 6.283); ctx.fill();
      }
    }
    ctx.globalCompositeOperation = "source-over";
  }

  _label(ctx, text, x, y, size, color, boxes, align = "center") {
    ctx.font = `${size}px Inter, system-ui, sans-serif`;
    const w = ctx.measureText(text).width, h = size + 2;
    const bx = align === "center" ? x - w / 2 : x, by = y - h / 2;
    for (const b of boxes) if (bx < b[0] + b[2] && bx + w > b[0] && by < b[1] + b[3] && by + h > b[1]) return false;
    boxes.push([bx - 3, by - 1, w + 6, h + 2]);
    ctx.textAlign = align; ctx.textBaseline = "middle";
    ctx.lineWidth = 3; ctx.strokeStyle = TH.halo; ctx.strokeText(text, x, y);
    ctx.fillStyle = color; ctx.fillText(text, x, y);
    return true;
  }

  _drawSub(ctx) {
    const sc = this.scene, ns = sc.nodes, z = this.cam.z;
    const sx = new Float32Array(ns.length), sy = new Float32Array(ns.length);
    for (let i = 0; i < ns.length; i++) { sx[i] = this._sx(ns[i].x); sy[i] = this._sy(ns[i].y); }
    const sel = this.selected >= 0 ? this.selected : this.hover;
    const near = new Set();
    if (sel >= 0) { near.add(sel); for (const e of sc.edges) { if (e.r === sel) near.add(e.m); if (e.m === sel) near.add(e.r); } }
    const dim = (i) => (sel >= 0 && !near.has(i) ? 0.28 : 1);
    const onScreen = (i) => sx[i] > -60 && sx[i] < this.w + 60 && sy[i] > -60 && sy[i] < this.h + 60;
    // an edge is drawn when the box around its two ends (plus the curve's bulge) meets the view: with both ends off
    // screen a long edge can still cross it when zoomed into a pathway
    const segOn = (i, k) => {
      const m = 80 + 0.12 * Math.max(Math.abs(sx[i] - sx[k]), Math.abs(sy[i] - sy[k]));
      return Math.max(sx[i], sx[k]) > -m && Math.min(sx[i], sx[k]) < this.w + m && Math.max(sy[i], sy[k]) > -m && Math.min(sy[i], sy[k]) < this.h + m;
    };

    // inactive edges
    if (this.options.inactive) {
      ctx.beginPath();
      for (const e of sc.edges) {
        if (e.s > 0 || e.hidden || !segOn(e.r, e.m)) continue;
        ctx.moveTo(sx[e.r], sy[e.r]); ctx.lineTo(sx[e.m], sy[e.m]);
      }
      ctx.strokeStyle = TH.inactiveEdge; ctx.lineWidth = 1; ctx.stroke();
    }
    // reactions without a detected enzyme in the cell type: grey dashed edges
    {
      ctx.beginPath(); let any = false;
      for (const e of sc.edges) {
        if (!sc.nodes[e.r]?.blk || e.hidden || !segOn(e.r, e.m)) continue;
        ctx.moveTo(sx[e.r], sy[e.r]); ctx.lineTo(sx[e.m], sy[e.m]); any = true;
      }
      if (any) { ctx.setLineDash([4, 4]); ctx.strokeStyle = TH.blocked; ctx.lineWidth = 1.3; ctx.stroke(); ctx.setLineDash([]); }
    }
    // flux that existed in the reference and is gone now
    if (this.mode === "delta") {
      ctx.beginPath();
      for (const e of sc.edges) {
        if (e.s > 0 || !e.lost || e.hidden || !segOn(e.r, e.m)) continue;
        ctx.moveTo(sx[e.r], sy[e.r]); ctx.lineTo(sx[e.m], sy[e.m]);
      }
      ctx.setLineDash([5, 4]); ctx.strokeStyle = this._dc(-1, 0.75); ctx.lineWidth = 1.6; ctx.stroke(); ctx.setLineDash([]);
    }
    // active edges
    const parts = [];
    const wk = Math.min(1.8, Math.max(0.5, Math.sqrt(z)));
    for (const e of sc.edges) {
      if (!e.s || e.hidden || !segOn(e.r, e.m)) continue;
      const a = e.out ? e.r : e.m, b = e.out ? e.m : e.r;
      const d = sel >= 0 && !(e.r === sel || e.m === sel) ? 0.22 : 1;
      const [cx, cy] = this._curve(sx[a], sy[a], sx[b], sy[b], 0.1);
      ctx.beginPath(); ctx.moveTo(sx[a], sy[a]); ctx.quadraticCurveTo(cx, cy, sx[b], sy[b]);
      ctx.strokeStyle = this._edgeColor(e, (0.3 + 0.6 * e.s) * d);
      ctx.lineWidth = (0.8 + 5.2 * e.s) * wk; ctx.lineCap = "round";
      if (this.change && e.ck === "rev") { ctx.lineCap = "butt"; ctx.setLineDash([7 * wk, 4 * wk]); }
      ctx.stroke(); ctx.setLineDash([]);
      // arrow head near the target
      const rb = this._radius(ns[b]) + 2, ang = Math.atan2(sy[b] - cy, sx[b] - cx), ah = (3.5 + 4.5 * e.s) * wk;
      const tx = sx[b] - Math.cos(ang) * rb, ty = sy[b] - Math.sin(ang) * rb;
      ctx.beginPath(); ctx.moveTo(tx, ty);
      ctx.lineTo(tx - Math.cos(ang - 0.45) * ah, ty - Math.sin(ang - 0.45) * ah);
      ctx.lineTo(tx - Math.cos(ang + 0.45) * ah, ty - Math.sin(ang + 0.45) * ah);
      ctx.closePath(); ctx.fillStyle = this._edgeColor(e, (0.55 + 0.45 * e.s) * d); ctx.fill();
      if (this.options.particles && d === 1 && !(this.change && (e.ck === "same" || e.ck === "zero"))) parts.push([sx[a], sy[a], cx, cy, sx[b], sy[b], e.s, e.phase, this.mode === "delta" ? this._dc(e.d, 0.9) : this.tracerOn ? enrichColor(Math.max(e.e, 0.02), 0.9) : TH.particle]);
    }
    this._drawParticles(ctx, parts);

    // nodes
    for (let i = 0; i < ns.length; i++) {
      const n = ns[i];
      if (!onScreen(i) || !this._vis(n)) continue;
      const r = this._radius(n), a = dim(i);
      ctx.globalAlpha = a;
      if (n.type === 0) {
        if (this.mtbOn) {
          const meas = Number.isFinite(n.mtbFc);
          const col = meas ? deltaColor(Math.max(-1, Math.min(1, n.mtbFc / 2))) : TH.metOff;
          ctx.beginPath(); ctx.arc(sx[i], sy[i], r, 0, 6.283);
          ctx.globalAlpha = a * (meas ? 1 : 0.42);
          ctx.fillStyle = col; ctx.fill();
          ctx.lineWidth = meas ? 2.2 : 1;
          ctx.strokeStyle = compColor(n.comp);
          if (n.unc) ctx.setLineDash([3, 2.5]);
          ctx.globalAlpha = a * (meas ? 1 : 0.35); ctx.stroke(); ctx.setLineDash([]);
          if (meas && n.mtbSig) { // statistically significant metabolite change (q < 0.05)
            ctx.beginPath(); ctx.arc(sx[i], sy[i], r + 3.2, 0, 6.283);
            ctx.globalAlpha = a;
            ctx.strokeStyle = deltaColor(Math.max(-1, Math.min(1, n.mtbFc / 2)), 0.92);
            ctx.lineWidth = 1.8; ctx.stroke();
          }
        } else {
          ctx.beginPath(); ctx.arc(sx[i], sy[i], r, 0, 6.283);
          ctx.fillStyle = n.s ? (this.dlabel || this.change ? this._dc(n.de) : this.tracerOn ? enrichColor(n.e) : TH.metOn) : TH.metOff;
          ctx.fill();
          ctx.lineWidth = n.s ? 2 : 1.2;
          ctx.strokeStyle = compColor(n.comp);
          if (n.unc) ctx.setLineDash([3, 2.5]);
          ctx.globalAlpha = a * (n.s ? 1 : 0.5); ctx.stroke(); ctx.setLineDash([]);
        }
      } else {
        ctx.save(); ctx.translate(sx[i], sy[i]); ctx.rotate(Math.PI / 4);
        const hasRna = this.rnaOn && Number.isFinite(n.rnaFc);
        const rnaCol = hasRna ? deltaColor(Math.max(-1, Math.min(1, n.rnaFc / 2))) : null;
        ctx.fillStyle = this.mode === "delta" ? this._dc(n.lost ? -1 : n.d, n.s ? 1 : 0.7) : hasRna ? rnaCol : n.s ? (n.transport ? TH.rxnTransport : TH.rxnOn) : TH.rxnOff;
        if (n.blk && !n.s && !hasRna) ctx.fillStyle = TH.blocked;
        if (this.change && n.ck === "off") { // active only in A: hollow
          ctx.fillStyle = TH.halo; ctx.fillRect(-r, -r, 2 * r, 2 * r);
          ctx.strokeStyle = this._dc(-1); ctx.lineWidth = 1.8; ctx.strokeRect(-r, -r, 2 * r, 2 * r);
        } else if (this.mtbOn && !n.mtbObs) { // not observable on both sides by the metabolomics panel
          ctx.globalAlpha = a * (hasRna ? 0.88 : 0.55);
          ctx.fillStyle = hasRna ? rnaCol : TH.halo; ctx.fillRect(-r, -r, 2 * r, 2 * r);
          ctx.strokeStyle = hasRna && n.rnaSig ? TH.selected : TH.rxnOff; ctx.lineWidth = 1.2; ctx.setLineDash([2.5, 2]);
          ctx.strokeRect(-r, -r, 2 * r, 2 * r); ctx.setLineDash([]);
        } else {
          ctx.fillRect(-r, -r, 2 * r, 2 * r);
          if (hasRna && n.rnaSig && this.mode !== "delta") {
            ctx.strokeStyle = TH.selected; ctx.lineWidth = 1.3; ctx.strokeRect(-r, -r, 2 * r, 2 * r);
          }
        }
        ctx.restore();
        if (this.rnaOn && n.rnaIso) { // divergent OR-branch isoenzyme switch
          ctx.beginPath(); ctx.arc(sx[i], sy[i], r * 1.5 + 3.5, 0, 6.283);
          ctx.strokeStyle = TH.rev; ctx.lineWidth = 1.8; ctx.setLineDash([3, 2]); ctx.stroke(); ctx.setLineDash([]);
        }
        if (this.mtbOn && n.mtbTop) { // candidate bottleneck step from metabolomics
          ctx.beginPath(); ctx.arc(sx[i], sy[i], r * 1.5 + 4, 0, 6.283);
          ctx.strokeStyle = TH.flexOpt; ctx.lineWidth = 2.6; ctx.stroke();
        }
        if (this.change && n.ck === "on") { // active only in B: halo
          ctx.beginPath(); ctx.arc(sx[i], sy[i], r * 1.5 + 3, 0, 6.283);
          ctx.strokeStyle = this._dc(1, 0.85); ctx.lineWidth = 2; ctx.stroke();
        }
        if (this.change && n.ck === "rev") { // runs the other way in B: magenta ring and ⇄
          ctx.beginPath(); ctx.arc(sx[i], sy[i], r * 1.5 + 3, 0, 6.283);
          ctx.strokeStyle = TH.rev; ctx.lineWidth = 2.2; ctx.stroke();
          const fs = Math.round(Math.max(11, r * 2.2));
          ctx.font = `700 ${fs}px Inter, "Segoe UI", system-ui, sans-serif`; ctx.textAlign = "left"; ctx.textBaseline = "middle";
          ctx.lineWidth = 3; ctx.strokeStyle = TH.halo; ctx.strokeText("⇄", sx[i] + r * 1.5 + 5, sy[i] - r * 1.2);
          ctx.fillStyle = TH.rev; ctx.fillText("⇄", sx[i] + r * 1.5 + 5, sy[i] - r * 1.2);
        }
        if (n.ghost) { // a reaction of another pathway shown around the selected metabolite
          ctx.beginPath(); ctx.arc(sx[i], sy[i], r * 1.5 + 5, 0, 6.283);
          ctx.strokeStyle = TH.gene; ctx.lineWidth = 1.6; ctx.setLineDash([4, 3]); ctx.stroke(); ctx.setLineDash([]);
        }
        if (n.fx && n.fx !== "zero") { // flux flexibility: solid = determined, dotted = optional, red dotted = loop
          ctx.beginPath(); ctx.arc(sx[i], sy[i], r * 1.5 + 6, 0, 6.283);
          ctx.strokeStyle = n.fx === "loop" ? TH.ko : n.fx === "optional" ? TH.flexOpt : TH.flexFix;
          ctx.lineWidth = n.fx === "fixed" ? 2.4 : 1.6;
          if (n.fx === "optional" || n.fx === "loop") ctx.setLineDash([2, 3]);
          ctx.stroke(); ctx.setLineDash([]);
        }
        if (n.blk) { // not detected in the cell type: grey dashed ring
          ctx.beginPath(); ctx.arc(sx[i], sy[i], r * 1.5 + 3, 0, 6.283);
          ctx.strokeStyle = TH.blocked; ctx.lineWidth = 1.5; ctx.setLineDash([3, 3]); ctx.stroke(); ctx.setLineDash([]);
        }
        if (this.marks && this.marks.has(n.ref)) {
          // Reactions of the selected gene, or of a marked regulon. With markDir the ring also says which
          // way the regulator pushes the step, which is the whole point of marking a regulon: a double ring
          // in green for up, amber for down, and the plain violet ring when the targets disagree.
          const d = this.markDir ? this.markDir.get(n.ref) : undefined;
          ctx.strokeStyle = d > 0 ? TH.regUp : d < 0 ? TH.regDown : TH.gene;
          ctx.beginPath(); ctx.arc(sx[i], sy[i], r * 1.5 + 6, 0, 6.283);
          ctx.lineWidth = d === undefined ? 2 : 2.6; ctx.stroke();
          if (d > 0 || d < 0) { // second, tighter ring: visible at a glance among the other rings
            ctx.beginPath(); ctx.arc(sx[i], sy[i], r * 1.5 + 2.6, 0, 6.283);
            ctx.lineWidth = 1.4; ctx.stroke();
          }
        }
        if (n.pert !== undefined) { // knocked out / knocked down
          ctx.beginPath(); ctx.arc(sx[i], sy[i], r * 1.5 + 3, 0, 6.283);
          ctx.strokeStyle = TH.ko; ctx.lineWidth = 2; if (n.pert > 0) ctx.setLineDash([4, 3]);
          ctx.stroke(); ctx.setLineDash([]);
        }
      }
      ctx.globalAlpha = 1;
    }
    this._rings(ctx, sx, sy);

    // labels: selection first, then by flux
    const boxes = [];
    const order = sc.labelOrder || (sc.labelOrder = ns.map((_, i) => i));
    order.sort((p, q) => ns[q].flux - ns[p].flux);
    const maxLabels = Math.round((this.w * this.h) / 9000);
    let drawn = 0;
    const want = (i) => {
      const n = ns[i];
      if (!onScreen(i) || !this._vis(n)) return false;
      if (near.has(i) || n.ghost || (this.mtbOn && n.mtbTop)) return true;
      if (n.type === 0) return z > 0.75 || (this.mtbOn && Number.isFinite(n.mtbFc) && z > 0.5) || (n.s > 0 && drawn < 28);
      return z > 1.7;
    };
    const drawLabel = (i) => {
      const n = ns[i], r = this._radius(n);
      const active = n.s > 0 || (this.mtbOn && (Number.isFinite(n.mtbFc) || n.mtbTop)), hl = near.has(i);
      const size = n.type === 0 ? (hl ? 12.5 : 11) : 9.5;
      const col = n.type === 0 ? (active || hl ? TH.labelOn : TH.labelOff) : (active || hl ? TH.rxnLabelOn : TH.rxnLabelOff);
      if (this._label(ctx, n.label, sx[i], sy[i] + r + size * 0.75, size, col, boxes)) drawn++;
    };
    for (const i of near) if (this._vis(ns[i])) drawLabel(i);
    ns.forEach((n, i) => { if ((n.ghost || (this.mtbOn && n.mtbTop)) && !near.has(i) && this._vis(n) && onScreen(i)) drawLabel(i); });
    for (const i of order) { if (drawn >= maxLabels) break; if (!near.has(i) && want(i)) drawLabel(i); }
  }

  _rings(ctx, sx, sy) {
    const ns = this.scene.nodes;
    const ring = (i, color, extra) => {
      if (i < 0 || !ns[i]) return;
      ctx.beginPath(); ctx.arc(sx[i], sy[i], this._radius(ns[i]) + extra, 0, 6.283);
      ctx.strokeStyle = color; ctx.lineWidth = 2; ctx.stroke();
    };
    ring(this.hover, TH.hover, 4);
    ring(this.selected, TH.selected, 5);
    if (this.pulse) {
      const u = (performance.now() - this.pulse.t0) / 1600;
      if (u > 3) this.pulse = null;
      else { const f = u % 1; ring(this.pulse.node, `rgba(${TH.pulse.join(",")},${0.8 * (1 - f)})`, 6 + 26 * f); }
    }
  }

  /** Cell view backdrop: compartments as membrane-bounded shapes. */
  _drawRegions(ctx) {
    const k = this.cam.z * UNIT;
    for (const r of this.scene.regions) {
      if (r.labelOnly) continue;
      const cx = this._sx(r.x), cy = this._sy(r.y), rx = r.rx * k, ry = r.ry * k;
      ctx.beginPath();
      if (r.wavy) { // cristae-like inner membrane
        for (let i = 0; i <= 240; i++) {
          const a = (i / 240) * 6.2832, w = 1 + 0.03 * Math.sin(a * r.wavy);
          const x = cx + Math.cos(a) * rx * w, y = cy + Math.sin(a) * ry * w;
          if (i) ctx.lineTo(x, y); else ctx.moveTo(x, y);
        }
        ctx.closePath();
      } else ctx.ellipse(cx, cy, rx, ry, 0, 0, 6.2832);
      ctx.fillStyle = hexA(r.color, r.cell ? 0.045 : 0.07); ctx.fill();
      const w = Math.max(2.5, 0.22 * k); // lipid bilayer: soft band + crisp line
      ctx.lineWidth = w; ctx.strokeStyle = hexA(r.color, 0.2);
      if (r.dash) ctx.setLineDash([w * 2.2, w * 0.7]);
      ctx.stroke(); ctx.setLineDash([]);
      ctx.lineWidth = 1.2; ctx.strokeStyle = hexA(r.color, 0.65); ctx.stroke();
    }
  }

  _drawGlobal(ctx) {
    const sc = this.scene, ns = sc.nodes, z = this.cam.z;
    const sx = new Float32Array(ns.length), sy = new Float32Array(ns.length);
    for (let i = 0; i < ns.length; i++) { sx[i] = this._sx(ns[i].x); sy[i] = this._sy(ns[i].y); }
    const sel = this.selected >= 0 ? this.selected : this.hover;
    if (sc.regions) this._drawRegions(ctx);
    // structural edges
    ctx.beginPath();
    for (const e of sc.edges) { if (ns[e.a].hidden || ns[e.b].hidden) continue; ctx.moveTo(sx[e.a], sy[e.a]); ctx.lineTo(sx[e.b], sy[e.b]); }
    ctx.strokeStyle = TH.structEdge; ctx.lineWidth = 1; ctx.stroke();
    // carbon flows
    const parts = [], near = new Set();
    if (sel >= 0) near.add(sel);
    const flows = sc.flows || [];
    for (let k = flows.length - 1; k >= 0; k--) {
      const f = flows[k];
      const touch = sel < 0 || f.a === sel || f.b === sel;
      if (sel >= 0 && touch) { near.add(f.a); near.add(f.b); }
      const d = touch ? 1 : 0.12;
      const [cx, cy] = this._curve(sx[f.a], sy[f.a], sx[f.b], sy[f.b], 0.16);
      ctx.beginPath(); ctx.moveTo(sx[f.a], sy[f.a]); ctx.quadraticCurveTo(cx, cy, sx[f.b], sy[f.b]);
      ctx.strokeStyle = this._edgeColor(f, (0.16 + 0.6 * f.s) * d);
      ctx.lineWidth = 0.7 + 6 * f.s * f.s; ctx.lineCap = "round"; ctx.stroke();
      if (this.options.particles && d === 1 && f.s > 0.25) parts.push([sx[f.a], sy[f.a], cx, cy, sx[f.b], sy[f.b], f.s, f.phase, this.mode === "delta" ? this._dc(f.d, 0.9) : this.tracerOn ? enrichColor(Math.max(f.e, 0.02), 0.9) : TH.particle]);
    }
    this._drawParticles(ctx, parts);
    for (let i = 0; i < ns.length; i++) {
      const n = ns[i], r = this._radius(n), a = sel >= 0 && !near.has(i) ? 0.3 : 1;
      if (n.hidden) continue;
      const delta = this.mode === "delta";
      ctx.globalAlpha = a;
      if (this.mtbOn) {
        const meas = Number.isFinite(n.mtbFc);
        const dc = meas ? Math.max(-1, Math.min(1, n.mtbFc / 2)) : 0;
        if (meas && Math.abs(dc) > 0.08) {
          const g = ctx.createRadialGradient(sx[i], sy[i], r * 0.4, sx[i], sy[i], r * (1.5 + Math.abs(dc)));
          g.addColorStop(0, deltaColor(dc, 0.45)); g.addColorStop(1, TH.blend === "lighter" ? "rgba(0,0,0,0)" : "rgba(255,255,255,0)");
          ctx.fillStyle = g; ctx.beginPath(); ctx.arc(sx[i], sy[i], r * (1.5 + Math.abs(dc)), 0, 6.283); ctx.fill();
        }
        ctx.beginPath(); ctx.arc(sx[i], sy[i], r, 0, 6.283);
        ctx.globalAlpha = a * (meas ? 1 : 0.48);
        ctx.fillStyle = meas ? deltaColor(dc) : TH.groupOff;
        ctx.fill();
        ctx.lineWidth = n.mtbObs ? 2 : 1.4;
        ctx.strokeStyle = n.mtbObs ? TH.groupRing : TH.groupRingOff;
        if (!meas) ctx.setLineDash([4, 3]);
        ctx.stroke(); ctx.setLineDash([]);
        if (this.rnaOn && Number.isFinite(n.rnaFc)) { // outer transcriptional ring paired with metabolomics fill
          const rdc = Math.max(-1, Math.min(1, n.rnaFc / 1.5));
          ctx.globalAlpha = a * 0.92;
          ctx.beginPath(); ctx.arc(sx[i], sy[i], r + 3.2, 0, 6.283);
          ctx.strokeStyle = deltaColor(rdc); ctx.lineWidth = 2.4; ctx.stroke();
        }
        if (n.mtbTop) { // pathway contains a candidate bottleneck step
          ctx.globalAlpha = a;
          ctx.beginPath(); ctx.arc(sx[i], sy[i], r + (this.rnaOn && Number.isFinite(n.rnaFc) ? 6.5 : 4), 0, 6.283);
          ctx.strokeStyle = TH.flexOpt; ctx.lineWidth = 2.6; ctx.stroke();
        }
      } else if (this.rnaOn && !delta) {
        const meas = Number.isFinite(n.rnaFc);
        const rdc = meas ? Math.max(-1, Math.min(1, n.rnaFc / 1.5)) : 0;
        if (meas && Math.abs(rdc) > 0.1) {
          const g = ctx.createRadialGradient(sx[i], sy[i], r * 0.4, sx[i], sy[i], r * (1.45 + Math.abs(rdc)));
          g.addColorStop(0, deltaColor(rdc, 0.42)); g.addColorStop(1, TH.blend === "lighter" ? "rgba(0,0,0,0)" : "rgba(255,255,255,0)");
          ctx.fillStyle = g; ctx.beginPath(); ctx.arc(sx[i], sy[i], r * (1.45 + Math.abs(rdc)), 0, 6.283); ctx.fill();
        }
        ctx.beginPath(); ctx.arc(sx[i], sy[i], r, 0, 6.283);
        ctx.globalAlpha = a * (meas ? 1 : 0.45);
        ctx.fillStyle = meas ? deltaColor(rdc) : TH.groupOff;
        ctx.fill();
        ctx.lineWidth = n.s > 0 ? 1.8 : 1.2;
        ctx.strokeStyle = n.s > 0 ? TH.groupRing : TH.groupRingOff;
        if (!meas) ctx.setLineDash([4, 3]);
        ctx.stroke(); ctx.setLineDash([]);
      } else {
        if (n.s > 0) {
          const g = ctx.createRadialGradient(sx[i], sy[i], r * 0.4, sx[i], sy[i], r * (1.5 + n.s));
          const col = delta ? this._dc(n.d, 0.45 * n.s) : this.tracerOn ? enrichColor(n.e, 0.5 * n.s) : `rgba(${TH.flux.join(",")},${0.42 * n.s})`;
          g.addColorStop(0, col); g.addColorStop(1, TH.blend === "lighter" ? "rgba(0,0,0,0)" : "rgba(255,255,255,0)");
          ctx.fillStyle = g; ctx.beginPath(); ctx.arc(sx[i], sy[i], r * (1.5 + n.s), 0, 6.283); ctx.fill();
        }
        ctx.beginPath(); ctx.arc(sx[i], sy[i], r, 0, 6.283);
        ctx.fillStyle = delta ? this._dc(n.d, n.s > 0 ? 1 : 0.55) : n.s > 0 ? (this.tracerOn ? enrichColor(n.e) : TH.groupFill(n.s)) : TH.groupOff;
        ctx.fill();
        ctx.lineWidth = 1.5; ctx.strokeStyle = n.listOnly ? TH.groupListOnly : n.s > 0 ? TH.groupRing : TH.groupRingOff;
        if (n.listOnly) ctx.setLineDash([3, 3]);
        ctx.stroke(); ctx.setLineDash([]);
      }
      ctx.globalAlpha = 1;
    }
    this._rings(ctx, sx, sy);
    const boxes = [];
    if (sc.regions) {
      for (const r of sc.regions) {
        if (r.noLabel) continue;
        ctx.save();
        try { ctx.letterSpacing = "1px"; } catch { /* older browsers */ }
        this._label(ctx, r.label.toUpperCase(), this._sx(r.lx), this._sy(r.ly), r.cell || r.labelOnly ? 12 : 10.5, hexA(r.color, 0.95), boxes);
        ctx.restore();
      }
    }
    const order = sc.labelOrder || (sc.labelOrder = ns.map((_, i) => i));
    order.sort((p, q) => (ns[q].flux - ns[p].flux) || (ns[q].size - ns[p].size));
    const rel = z / (this.homeZoom || 1);
    const draw = (i) => {
      const n = ns[i], r = this._radius(n), hl = near.has(i) && sel >= 0;
      this._label(ctx, n.label, sx[i], sy[i] + r + 9, hl ? 12.5 : 11, n.s > 0 || hl ? TH.labelOn : TH.groupLabelOff, boxes);
    };
    if (sel >= 0) for (const i of near) if (!ns[i].hidden) draw(i);
    let k = 0;
    for (const i of order) {
      const n = ns[i];
      if (n.hidden || (near.has(i) && sel >= 0)) continue;
      if (rel < 1.6 && !(n.s > 0) && !(this.masked) && (sc.regions || k > 30)) continue;
      draw(i); k++;
    }
  }
}
