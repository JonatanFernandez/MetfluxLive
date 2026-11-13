// Canvas renderer for the global (subsystem) map and the per-pathway maps.
// Flux is encoded as edge width, particle speed and node size; isotope enrichment as colour.

const UNIT = 64; // px per layout unit at zoom 1
export const COMP_COLORS = {
  c: "#8fa3c8", m: "#ff9f5a", e: "#5fd38d", s: "#5fd38d", r: "#b48cff", x: "#3fd0c9",
  l: "#ff7eb6", g: "#f2d45c", n: "#6aa9ff", i: "#ff6b6b",
};
const FLUX_RGB = [76, 201, 240];
// enrichment ramp: unlabelled slate -> amber -> hot magenta
const RAMP = [[118, 136, 176], [255, 190, 60], [255, 120, 50], [255, 45, 120]];

export function enrichColor(e, alpha = 1) {
  const t = Math.pow(Math.min(1, Math.max(0, e)), 0.55) * (RAMP.length - 1);
  const i = Math.min(RAMP.length - 2, Math.floor(t)), f = t - i;
  const c = RAMP[i].map((x, k) => Math.round(x + (RAMP[i + 1][k] - x) * f));
  return `rgba(${c[0]},${c[1]},${c[2]},${alpha})`;
}

// flux change against the reference: blue (down) - slate (same) - orange (up)
const D_UP = [255, 159, 90], D_DOWN = [90, 150, 255], D_SAME = [124, 138, 170];
export function deltaColor(d, alpha = 1) {
  const k = d ? Math.min(1, 0.3 + Math.abs(d) * 1.2) : 0, to = d > 0 ? D_UP : D_DOWN;
  const c = D_SAME.map((x, i) => Math.round(x + (to[i] - x) * k));
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
   * sub scenes: { v, turnover, metE, uncertain, ref, mask: { rxn, met }, perturb: Map }
   * global:     { gFlux, gE, gD, gHas, flows, minE }
   * both:       { mode: "flux" | "tracer" | "delta" }
   */
  setData(d) {
    const sc = this.scene;
    this.mode = d.mode || "flux";
    this.tracerOn = this.mode === "tracer";
    this.masked = !!(d.mask || d.gHas);
    const logScale = (x, max, dec = 4, floor = 0.04) => (x > 0 && max > 0 ? Math.min(1, Math.max(floor, 1 + Math.log10(x / max) / dec)) : 0);
    const rel = (a, b) => { const m = Math.max(a, b); return m > 0 ? (a - b) / m : 0; };
    if (sc.kind === "sub") {
      const mask = d.mask, ref = d.ref;
      let max = 0;
      for (const e of sc.edges) { const f = d.v ? d.v[sc.nodes[e.r].ref] * e.coef : 0; e.f = f; if (Math.abs(f) > max) max = Math.abs(f); }
      let tmax = 0;
      for (const n of sc.nodes) if (n.type === 0 && d.turnover) tmax = Math.max(tmax, d.turnover[n.ref]);
      for (const n of sc.nodes) {
        if (n.type === 0) {
          n.flux = d.turnover ? d.turnover[n.ref] : 0; n.s = logScale(n.flux, tmax);
          n.e = d.metE ? d.metE[n.ref] : 0; n.unc = d.uncertain ? d.uncertain[n.ref] : 0;
          n.hidden = !!mask && !mask.met[n.ref];
        } else {
          n.flux = d.v ? Math.abs(d.v[n.ref]) : 0; n.s = logScale(n.flux, max); n.dir = d.v ? Math.sign(d.v[n.ref]) : 0;
          const f0 = ref ? Math.abs(ref[n.ref]) : n.flux;
          n.d = rel(n.flux, f0); n.lost = !n.flux && f0 > 0;
          n.hidden = !!mask && !mask.rxn[n.ref];
          n.pert = d.perturb ? d.perturb.get(n.ref) : undefined;
        }
      }
      for (const e of sc.edges) {
        const r = sc.nodes[e.r], m = sc.nodes[e.m];
        e.flux = Math.abs(e.f);
        e.s = logScale(e.flux, max);
        e.out = e.f > 0; // reaction -> metabolite
        e.e = m.e; e.d = r.d; e.lost = r.lost;
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
      for (const n of sc.nodes) {
        n.s = logScale(n.flux, max); n.e = d.gE ? d.gE[n.ref] : 0; n.d = d.gD ? d.gD[n.ref] : 0;
        n.hidden = !!d.gHas && !d.gHas[n.ref];
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
  _vis(n) { return !n.hidden && (this.options.inactive || n.s > 0 || this.masked || this.scene.kind !== "sub"); }

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
    c.addEventListener("pointerdown", (ev) => {
      c.setPointerCapture(ev.pointerId);
      drag = { x: ev.clientX, y: ev.clientY, cx: this.cam.x, cy: this.cam.y, moved: false };
      this.camTarget = null;
    });
    c.addEventListener("pointermove", (ev) => {
      const r = c.getBoundingClientRect(), mx = ev.clientX - r.left, my = ev.clientY - r.top;
      if (drag) {
        const dx = ev.clientX - drag.x, dy = ev.clientY - drag.y;
        if (Math.abs(dx) + Math.abs(dy) > 3) drag.moved = true;
        if (drag.moved) { this.cam.x = drag.cx - dx / (UNIT * this.cam.z); this.cam.y = drag.cy - dy / (UNIT * this.cam.z); c.style.cursor = "grabbing"; return; }
      }
      const h = this._hit(mx, my);
      if (h !== this.hover) { this.hover = h; c.style.cursor = h >= 0 ? "pointer" : "grab"; }
      this.hooks.onHover?.(h >= 0 ? this.scene.nodes[h] : null, ev.clientX, ev.clientY);
    });
    c.addEventListener("pointerup", (ev) => {
      const wasDrag = drag && drag.moved;
      drag = null; c.style.cursor = this.hover >= 0 ? "pointer" : "grab";
      if (wasDrag) return;
      const r = c.getBoundingClientRect();
      const h = this._hit(ev.clientX - r.left, ev.clientY - r.top);
      this.selected = h;
      this.hooks.onSelect?.(h >= 0 ? this.scene.nodes[h] : null);
    });
    c.addEventListener("dblclick", (ev) => {
      const r = c.getBoundingClientRect();
      const h = this._hit(ev.clientX - r.left, ev.clientY - r.top);
      if (h >= 0) this.hooks.onOpen?.(this.scene.nodes[h]); else this.fit();
    });
    c.addEventListener("pointerleave", () => { this.hover = -1; this.hooks.onHover?.(null); });
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

  _hit(mx, my) {
    const ns = this.scene.nodes;
    let best = -1, bd = 1e9;
    for (let i = 0; i < ns.length; i++) {
      const n = ns[i];
      if (!this._vis(n)) continue;
      const dx = this._sx(n.x) - mx, dy = this._sy(n.y) - my, r = this._radius(n) + 5;
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
    if (this.scene.kind === "sub") this._drawSub(ctx);
    else if (this.scene.kind === "global") this._drawGlobal(ctx);
  }

  _edgeColor(e, alpha) {
    if (this.mode === "delta") return deltaColor(e.d, alpha);
    if (this.tracerOn) return enrichColor(e.e, alpha);
    return `rgba(${FLUX_RGB[0]},${FLUX_RGB[1]},${FLUX_RGB[2]},${alpha})`;
  }

  _curve(ax, ay, bx, by, bend) {
    const mx = (ax + bx) / 2, my = (ay + by) / 2, dx = bx - ax, dy = by - ay;
    return [mx - dy * bend, my + dx * bend];
  }

  _drawParticles(ctx, list) {
    // list: [ax, ay, cx, cy, bx, by, s, phase, color]
    ctx.globalCompositeOperation = "lighter";
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
    ctx.lineWidth = 3; ctx.strokeStyle = "rgba(8,12,24,0.92)"; ctx.strokeText(text, x, y);
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

    // inactive edges
    if (this.options.inactive) {
      ctx.beginPath();
      for (const e of sc.edges) {
        if (e.s > 0 || e.hidden || (!onScreen(e.r) && !onScreen(e.m))) continue;
        ctx.moveTo(sx[e.r], sy[e.r]); ctx.lineTo(sx[e.m], sy[e.m]);
      }
      ctx.strokeStyle = "rgba(125,145,190,0.13)"; ctx.lineWidth = 1; ctx.stroke();
    }
    // flux that existed in the reference and is gone now
    if (this.mode === "delta") {
      ctx.beginPath();
      for (const e of sc.edges) {
        if (e.s > 0 || !e.lost || e.hidden || (!onScreen(e.r) && !onScreen(e.m))) continue;
        ctx.moveTo(sx[e.r], sy[e.r]); ctx.lineTo(sx[e.m], sy[e.m]);
      }
      ctx.setLineDash([5, 4]); ctx.strokeStyle = deltaColor(-1, 0.75); ctx.lineWidth = 1.6; ctx.stroke(); ctx.setLineDash([]);
    }
    // active edges
    const parts = [];
    const wk = Math.min(1.8, Math.max(0.5, Math.sqrt(z)));
    for (const e of sc.edges) {
      if (!e.s || e.hidden || (!onScreen(e.r) && !onScreen(e.m))) continue;
      const a = e.out ? e.r : e.m, b = e.out ? e.m : e.r;
      const d = sel >= 0 && !(e.r === sel || e.m === sel) ? 0.22 : 1;
      const [cx, cy] = this._curve(sx[a], sy[a], sx[b], sy[b], 0.1);
      ctx.beginPath(); ctx.moveTo(sx[a], sy[a]); ctx.quadraticCurveTo(cx, cy, sx[b], sy[b]);
      ctx.strokeStyle = this._edgeColor(e, (0.3 + 0.6 * e.s) * d);
      ctx.lineWidth = (0.8 + 5.2 * e.s) * wk; ctx.lineCap = "round"; ctx.stroke();
      // arrow head near the target
      const rb = this._radius(ns[b]) + 2, ang = Math.atan2(sy[b] - cy, sx[b] - cx), ah = (3.5 + 4.5 * e.s) * wk;
      const tx = sx[b] - Math.cos(ang) * rb, ty = sy[b] - Math.sin(ang) * rb;
      ctx.beginPath(); ctx.moveTo(tx, ty);
      ctx.lineTo(tx - Math.cos(ang - 0.45) * ah, ty - Math.sin(ang - 0.45) * ah);
      ctx.lineTo(tx - Math.cos(ang + 0.45) * ah, ty - Math.sin(ang + 0.45) * ah);
      ctx.closePath(); ctx.fillStyle = this._edgeColor(e, (0.55 + 0.45 * e.s) * d); ctx.fill();
      if (this.options.particles && d === 1) parts.push([sx[a], sy[a], cx, cy, sx[b], sy[b], e.s, e.phase, this.mode === "delta" ? deltaColor(e.d, 0.9) : this.tracerOn ? enrichColor(Math.max(e.e, 0.02), 0.9) : "rgba(190,240,255,0.85)"]);
    }
    this._drawParticles(ctx, parts);

    // nodes
    for (let i = 0; i < ns.length; i++) {
      const n = ns[i];
      if (!onScreen(i) || !this._vis(n)) continue;
      const r = this._radius(n), a = dim(i);
      ctx.globalAlpha = a;
      if (n.type === 0) {
        ctx.beginPath(); ctx.arc(sx[i], sy[i], r, 0, 6.283);
        ctx.fillStyle = n.s ? (this.tracerOn ? enrichColor(n.e) : "#1d3350") : "#141c30";
        ctx.fill();
        ctx.lineWidth = n.s ? 2 : 1.2;
        ctx.strokeStyle = COMP_COLORS[n.comp] || "#8fa3c8";
        if (n.unc) ctx.setLineDash([3, 2.5]);
        ctx.globalAlpha = a * (n.s ? 1 : 0.5); ctx.stroke(); ctx.setLineDash([]);
      } else {
        ctx.save(); ctx.translate(sx[i], sy[i]); ctx.rotate(Math.PI / 4);
        ctx.fillStyle = this.mode === "delta" ? deltaColor(n.lost ? -1 : n.d, n.s ? 1 : 0.7) : n.s ? (n.transport ? "#9fb4d8" : "#e8eefc") : "#2a3552";
        ctx.fillRect(-r, -r, 2 * r, 2 * r); ctx.restore();
        if (n.pert !== undefined) { // knocked out / knocked down
          ctx.beginPath(); ctx.arc(sx[i], sy[i], r * 1.5 + 3, 0, 6.283);
          ctx.strokeStyle = "#ff5d6c"; ctx.lineWidth = 2; if (n.pert > 0) ctx.setLineDash([4, 3]);
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
      if (near.has(i)) return true;
      if (n.type === 0) return z > 0.75 || (n.s > 0 && drawn < 28);
      return z > 1.7;
    };
    const drawLabel = (i) => {
      const n = ns[i], r = this._radius(n);
      const active = n.s > 0, hl = near.has(i);
      const size = n.type === 0 ? (hl ? 12.5 : 11) : 9.5;
      const col = n.type === 0 ? (active || hl ? "#eef3ff" : "rgba(170,185,215,0.6)") : (active || hl ? "#b8c6e6" : "rgba(140,155,190,0.5)");
      if (this._label(ctx, n.label, sx[i], sy[i] + r + size * 0.75, size, col, boxes)) drawn++;
    };
    for (const i of near) if (this._vis(ns[i])) drawLabel(i);
    for (const i of order) { if (drawn >= maxLabels) break; if (!near.has(i) && want(i)) drawLabel(i); }
  }

  _rings(ctx, sx, sy) {
    const ns = this.scene.nodes;
    const ring = (i, color, extra) => {
      if (i < 0 || !ns[i]) return;
      ctx.beginPath(); ctx.arc(sx[i], sy[i], this._radius(ns[i]) + extra, 0, 6.283);
      ctx.strokeStyle = color; ctx.lineWidth = 2; ctx.stroke();
    };
    ring(this.hover, "rgba(255,255,255,0.55)", 4);
    ring(this.selected, "#ffffff", 5);
    if (this.pulse) {
      const u = (performance.now() - this.pulse.t0) / 1600;
      if (u > 3) this.pulse = null;
      else { const f = u % 1; ring(this.pulse.node, `rgba(255,255,255,${0.8 * (1 - f)})`, 6 + 26 * f); }
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
    ctx.strokeStyle = "rgba(125,145,190,0.10)"; ctx.lineWidth = 1; ctx.stroke();
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
      if (this.options.particles && d === 1 && f.s > 0.25) parts.push([sx[f.a], sy[f.a], cx, cy, sx[f.b], sy[f.b], f.s, f.phase, this.mode === "delta" ? deltaColor(f.d, 0.9) : this.tracerOn ? enrichColor(Math.max(f.e, 0.02), 0.9) : "rgba(190,240,255,0.8)"]);
    }
    this._drawParticles(ctx, parts);
    for (let i = 0; i < ns.length; i++) {
      const n = ns[i], r = this._radius(n), a = sel >= 0 && !near.has(i) ? 0.3 : 1;
      if (n.hidden) continue;
      const delta = this.mode === "delta";
      ctx.globalAlpha = a;
      if (n.s > 0) {
        const g = ctx.createRadialGradient(sx[i], sy[i], r * 0.4, sx[i], sy[i], r * (1.5 + n.s));
        const col = delta ? deltaColor(n.d, 0.45 * n.s) : this.tracerOn ? enrichColor(n.e, 0.5 * n.s) : `rgba(76,201,240,${0.42 * n.s})`;
        g.addColorStop(0, col); g.addColorStop(1, "rgba(0,0,0,0)");
        ctx.fillStyle = g; ctx.beginPath(); ctx.arc(sx[i], sy[i], r * (1.5 + n.s), 0, 6.283); ctx.fill();
      }
      ctx.beginPath(); ctx.arc(sx[i], sy[i], r, 0, 6.283);
      ctx.fillStyle = delta ? deltaColor(n.d, n.s > 0 ? 1 : 0.55) : n.s > 0 ? (this.tracerOn ? enrichColor(n.e) : `rgb(${28 + 30 * n.s},${60 + 90 * n.s},${92 + 110 * n.s})`) : "#151d33";
      ctx.fill();
      ctx.lineWidth = 1.5; ctx.strokeStyle = n.listOnly ? "rgba(160,175,210,0.45)" : n.s > 0 ? "rgba(235,242,255,0.9)" : "rgba(130,148,190,0.45)";
      if (n.listOnly) ctx.setLineDash([3, 3]);
      ctx.stroke(); ctx.setLineDash([]);
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
      this._label(ctx, n.label, sx[i], sy[i] + r + 9, hl ? 12.5 : 11, n.s > 0 || hl ? "#eef3ff" : "rgba(165,180,212,0.62)", boxes);
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
