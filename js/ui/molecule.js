// SVG structure drawing used both as the isotope-label editor and as an enrichment viewer.
import { enrichColor } from "./mapview.js";
import { t } from "../i18n.js";

const NS = "http://www.w3.org/2000/svg";
export const ISOTOPE = { C: "¹³C", N: "¹⁵N", O: "¹⁸O", S: "³⁴S" };
const ELEMENT_COLOR = { O: "#ff6b6b", N: "#6aa9ff", S: "#f2d45c", P: "#ff9f5a", R: "#9aa7c7", F: "#5fd38d", Cl: "#5fd38d", Br: "#c98a5a", I: "#b48cff" };
const LABEL_COLOR = { C: "#ffbe3c", N: "#5aa0ff", O: "#ff5f6d", S: "#e9d24a" };
const SUB = "₀₁₂₃₄₅₆₇₈₉";
const sub = (n) => String(n).split("").map((d) => SUB[+d]).join("");

const el = (tag, attrs, parent) => {
  const e = document.createElementNS(NS, tag);
  for (const k in attrs) e.setAttribute(k, attrs[k]);
  if (parent) parent.appendChild(e);
  return e;
};

/** Short isotopologue name, e.g. [U-¹³C]glucose or [¹³C₂]glucose. */
export function tracerName(struct, label, name) {
  if (!label) return name;
  if (!struct) return label[0] > 0 ? `[${t("mol.labelled")}]${name}` : name;
  const parts = [];
  for (const sym of Object.keys(ISOTOPE)) {
    let total = 0, n = 0;
    struct.e.forEach((e, i) => { if (e === sym) { total++; if (label[i] > 0) n++; } });
    if (!n) continue;
    parts.push(n === total && total > 1 ? `U-${ISOTOPE[sym]}` : `${ISOTOPE[sym]}${n > 1 ? sub(n) : ""}`);
  }
  return parts.length ? `[${parts.join(",")}]${name}` : name;
}

/**
 * Draw a structure.
 * @param opts { label: Float64Array (editor state), enrich: array-like (0..1 per atom),
 *               onToggle(atomIdx), height }
 */
export function renderMolecule(container, struct, opts = {}) {
  container.textContent = "";
  const n = struct.e.length;
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (let i = 0; i < n; i++) { x0 = Math.min(x0, struct.x[i]); x1 = Math.max(x1, struct.x[i]); y0 = Math.min(y0, struct.y[i]); y1 = Math.max(y1, struct.y[i]); }
  const pad = 1.3, W = x1 - x0 + 2 * pad, H = y1 - y0 + 2 * pad;
  const svg = el("svg", { viewBox: `${x0 - pad} ${y0 - pad} ${W} ${H}`, class: "mol", preserveAspectRatio: "xMidYMid meet" }, container);
  svg.style.maxHeight = (opts.height || 300) + "px";
  svg.style.aspectRatio = `${W} / ${H}`;
  const gHalo = el("g", {}, svg), gBond = el("g", { class: "bonds" }, svg), gAtom = el("g", {}, svg), gHit = el("g", {}, svg);
  const X = struct.x, Y = struct.y;
  const degree = new Uint8Array(n);
  for (let k = 0; k < struct.b.length; k += 4) { degree[struct.b[k]]++; degree[struct.b[k + 1]]++; }
  const shown = (i) => struct.e[i] !== "C" || degree[i] === 0;

  for (let k = 0; k < struct.b.length; k += 4) {
    const a = struct.b[k], b = struct.b[k + 1], order = struct.b[k + 2], wedge = struct.b[k + 3];
    let ax = X[a], ay = Y[a], bx = X[b], by = Y[b];
    const dx = bx - ax, dy = by - ay, len = Math.hypot(dx, dy) || 1, ux = dx / len, uy = dy / len;
    const sa = shown(a) ? 0.36 : 0, sb = shown(b) ? 0.36 : 0;
    ax += ux * sa; ay += uy * sa; bx -= ux * sb; by -= uy * sb;
    const px = -uy, py = ux;
    if (wedge === 1) {
      el("polygon", { points: `${ax},${ay} ${bx + px * 0.16},${by + py * 0.16} ${bx - px * 0.16},${by - py * 0.16}`, class: "wedge" }, gBond);
    } else if (wedge === 2) {
      for (let s = 1; s <= 5; s++) {
        const t = s / 5.5, w = 0.03 + 0.15 * t, cx = ax + (bx - ax) * t, cy = ay + (by - ay) * t;
        el("line", { x1: cx + px * w, y1: cy + py * w, x2: cx - px * w, y2: cy - py * w }, gBond);
      }
    } else if (order === 2) {
      for (const o of [-0.09, 0.09]) el("line", { x1: ax + px * o, y1: ay + py * o, x2: bx + px * o, y2: by + py * o }, gBond);
    } else if (order === 3) {
      for (const o of [-0.15, 0, 0.15]) el("line", { x1: ax + px * o, y1: ay + py * o, x2: bx + px * o, y2: by + py * o }, gBond);
    } else {
      el("line", { x1: ax, y1: ay, x2: bx, y2: by }, gBond);
    }
  }

  const marks = new Array(n);
  const paint = (i) => {
    const g = marks[i];
    g.textContent = "";
    const sym = struct.e[i];
    const lab = opts.label ? opts.label[i] > 0 : false;
    const en = opts.enrich ? opts.enrich[i] : 0;
    if (lab) {
      el("circle", { cx: X[i], cy: Y[i], r: 0.52, fill: LABEL_COLOR[sym] || "#ffbe3c", class: "lab" }, g);
      const t = el("text", { x: X[i], y: Y[i] + 0.02, class: "lab-text" }, g);
      t.textContent = ISOTOPE[sym] || sym;
      return;
    }
    if (opts.enrich && en > 0.004 && ISOTOPE[sym]) {
      el("circle", { cx: X[i], cy: Y[i], r: 0.36 + 0.2 * Math.sqrt(en), fill: enrichColor(en, 0.92), class: "enr" }, g);
    }
    if (shown(i)) {
      const h = struct.h[i], q = struct.q ? struct.q[i] : 0;
      const t = el("text", { x: X[i], y: Y[i] + 0.02, class: "atom", fill: opts.enrich && en > 0.25 ? "#10141f" : ELEMENT_COLOR[sym] || "#e8eefc" }, g);
      t.textContent = sym + (h ? "H" + (h > 1 ? sub(h) : "") : "") + (q ? (Math.abs(q) > 1 ? Math.abs(q) : "") + (q > 0 ? "⁺" : "⁻") : "");
    }
  };
  for (let i = 0; i < n; i++) {
    if (shown(i)) el("circle", { cx: X[i], cy: Y[i], r: 0.34, class: "mask" }, gHalo);
    marks[i] = el("g", {}, gAtom);
    paint(i);
    const editable = opts.onToggle && ISOTOPE[struct.e[i]];
    if (editable || opts.enrich) {
      const hit = el("circle", { cx: X[i], cy: Y[i], r: 0.55, class: editable ? "hit editable" : "hit" }, gHit);
      const tip = el("title", {}, hit);
      const describe = () => {
        const sym = struct.e[i];
        if (opts.enrich) return t("mol.atomEnrich", { a: sym + (i + 1), x: (100 * (opts.enrich[i] || 0)).toFixed(1) });
        return t(opts.label[i] > 0 ? "mol.atomRemove" : "mol.atomAdd", { a: sym + (i + 1), iso: ISOTOPE[sym] });
      };
      tip.textContent = describe();
      if (editable) hit.addEventListener("click", () => { opts.onToggle(i); paint(i); tip.textContent = describe(); });
    }
  }
  return { repaint: () => { for (let i = 0; i < n; i++) paint(i); } };
}
