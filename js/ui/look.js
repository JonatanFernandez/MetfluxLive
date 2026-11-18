// Appearance: surfaces, accent colour and the colour scales of the map, chosen in a dialog and kept in the browser
// (localStorage "metflux.look"). The surfaces and the accent are CSS (css/palettes.css); the scales live in mapview.js.

import { t } from "../i18n.js";
import { SCALES, setMapLook } from "./mapview.js";

export const LOOK_DEFAULT = { surfaceDark: "default", surfaceLight: "default", accent: "default", flux: "default", enrich: "default", delta: "default", energy: "default", comp: "default" };
const OPTIONS = {
  surfaceDark: ["default", "black", "slate"],
  surfaceLight: ["default", "white", "paper"],
  accent: ["default", "teal", "violet", "orange", "green", "pink"],
  flux: Object.keys(SCALES.flux),
  enrich: Object.keys(SCALES.enrich),
  delta: Object.keys(SCALES.delta),
  energy: Object.keys(SCALES.energy),
  comp: Object.keys(SCALES.comp),
};

export function loadLook() {
  let look = {};
  try { look = JSON.parse(localStorage.getItem("metflux.look") || "{}") || {}; } catch { /* storage unavailable */ }
  const out = { ...LOOK_DEFAULT };
  for (const k of Object.keys(OPTIONS)) if (OPTIONS[k].includes(look[k])) out[k] = look[k];
  return out;
}
function saveLook(look) { try { localStorage.setItem("metflux.look", JSON.stringify(look)); } catch { /* ignore */ } }

/** Apply a look to the page (CSS attributes on <html>) and to the map scales. */
export function applyLook(look) {
  const root = document.documentElement, light = root.dataset.theme === "light";
  const surf = light ? look.surfaceLight : look.surfaceDark;
  if (surf && surf !== "default") root.dataset.palette = surf; else delete root.dataset.palette;
  if (look.accent && look.accent !== "default") root.dataset.accent = look.accent; else delete root.dataset.accent;
  setMapLook({ flux: look.flux, enrich: look.enrich, delta: look.delta, energy: look.energy, comp: look.comp });
}

const rgb = (c) => `rgb(${c.join(",")})`;
/** A small preview of each option (a gradient or swatches). */
function preview(k, v) {
  const grad = (cols) => `<span class="lk-ramp" style="background:linear-gradient(90deg,${cols.join(",")})"></span>`;
  if (k === "enrich") return grad((SCALES.enrich[v]).map(rgb));
  if (k === "delta") { const d = SCALES.delta[v]; return grad([rgb(d.down), "rgb(124,138,170)", rgb(d.up)]); }
  if (k === "energy") { const e = SCALES.energy[v]; return grad([rgb(e.up), ...e.down.map(rgb)]); }
  if (k === "flux") { const f = SCALES.flux[v]; const light = document.documentElement.dataset.theme === "light"; return f ? grad([rgb(f[light ? "light" : "dark"]), rgb(f[light ? "light" : "dark"])]) : ""; }
  if (k === "comp") { const c = SCALES.comp[v]; if (!c) return ""; const p = c[document.documentElement.dataset.theme === "light" ? "light" : "dark"]; return `<span class="lk-sw">${["c", "m", "e", "r", "x", "l", "g", "n"].map((x) => `<i style="background:${p[x]}"></i>`).join("")}</span>`; }
  return "";
}

/**
 * The Appearance dialog. onChange(look) is called after every change (the app redraws the map).
 */
export function openLookDialog(onChange) {
  let dlg = document.getElementById("lookDialog");
  if (!dlg) {
    dlg = document.createElement("dialog");
    dlg.id = "lookDialog"; dlg.className = "editor look";
    document.body.appendChild(dlg);
  }
  const look = loadLook();
  const row = (k) => `<label class="lk-row"><span>${t("look." + k)}</span><select data-k="${k}">${OPTIONS[k].map((v) => `<option value="${v}"${look[k] === v ? " selected" : ""}>${t(`look.${k}.${v}`)}</option>`).join("")}</select><span class="lk-prev" data-p="${k}">${preview(k, look[k])}</span></label>`;
  dlg.innerHTML = `<form method="dialog"><header><h3>${t("look.title")}</h3><button class="icon" value="cancel" aria-label="${t("h.close")}">✕</button></header>
    <p class="hint">${t("look.intro")}</p>
    <h4>${t("look.hSurface")}</h4>${row("surfaceDark")}${row("surfaceLight")}${row("accent")}
    <h4>${t("look.hMap")}</h4>${row("flux")}${row("enrich")}${row("delta")}${row("energy")}${row("comp")}
    <p class="hint">${t("look.cbNote")}</p>
    <footer><button type="button" data-reset>${t("look.reset")}</button><span style="flex:1"></span><button value="ok" class="primary">${t("look.done")}</button></footer></form>`;
  const update = () => {
    const now = loadLook();
    dlg.querySelectorAll("select[data-k]").forEach((s) => { now[s.dataset.k] = s.value; });
    saveLook(now); applyLook(now);
    dlg.querySelectorAll("[data-p]").forEach((el) => { el.innerHTML = preview(el.dataset.p, now[el.dataset.p]); });
    onChange?.(now);
  };
  dlg.querySelectorAll("select[data-k]").forEach((s) => { s.onchange = update; });
  dlg.querySelector("[data-reset]").onclick = () => { dlg.querySelectorAll("select[data-k]").forEach((s) => { s.value = LOOK_DEFAULT[s.dataset.k]; }); update(); };
  dlg.showModal();
}

