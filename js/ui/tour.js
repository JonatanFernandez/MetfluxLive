// Walkthrough: a step-by-step tour of the interface and of each worked example.
// Each step highlights one element and explains it. Texts live in js/i18n.js (and js/i18n/<code>.js)
// under tour.<step>.t (title) and tour.<step>.b (body).

import { t } from "../i18n.js";

// Main desktop walkthrough: top bar -> overview of the 3 analysis tabs -> each tab top-to-bottom
// paired with where its results appear -> editing, export, examples & docs.
export const TOUR_STEPS = [
  { id: "welcome" },
  { id: "model", sel: "#modelSelect" },
  { id: "search", sel: "#topbar .search, #search" },
  { id: "mode", sel: "#modeToggle" },
  { id: "run", sel: "#runBtn" },
  // 3 main analysis tabs overview
  { id: "taskTabs", sel: "#taskTabs", task: "sim" },
  // Tab 1: Simulate (inputs top-to-bottom)
  { id: "context", sel: "#secContext", task: "sim" },
  { id: "medium", sel: "#secMedium", task: "sim" },
  { id: "tracers", sel: "#trLib", task: "sim" },
  { id: "measured", sel: "#secMeasured", task: "sim" },
  { id: "objective", sel: "#secObjective", task: "sim" },
  { id: "perturb", sel: "#secPerturb", task: "sim" },
  // Results of Simulate (map, controls, right-hand results panel)
  { id: "map", sel: "#map", task: "sim" },
  { id: "nav", sel: "#navBar", task: "sim" },
  { id: "view", sel: "#viewOpts", task: "sim" },
  { id: "lines", sel: "#legendBox", task: "sim" },
  { id: "details", sel: "#details", task: "sim" },
  // Tab 2: Compare (inputs alternating with results)
  { id: "compare", sel: "#secCompare", task: "cmp" },
  { id: "cmpResult", sel: "#details", task: "cmp" },
  { id: "diffScreens", sel: "#secDiffScreens", task: "cmp" },
  { id: "design", sel: "#secDesign", task: "cmp" },
  // Tab 3: Interpret (experimental omics inputs alternating with network results)
  { id: "dataExo", sel: "#secExo", task: "data" },
  { id: "dataMtb", sel: "#secMtb", task: "data" },
  { id: "dataRna", sel: "#secRna", task: "data" },
  { id: "dataResult", sel: "#map", task: "data" },
  // Tools, guided examples & help
  { id: "edit", sel: "#editBtn" },
  { id: "files", sel: "#exportBtn" },
  { id: "demos", sel: "#demoBtn" },
  { id: "docs", sel: "#docsBtn" },
  { id: "again", sel: "#tourBtn" },
  { id: "end" },
];

// The same logical walkthrough on a phone (js/ui/mobile.js): `sheet` opens the matching drawer ("" closes them).
export const TOUR_STEPS_MOBILE = [
  { id: "welcome", sheet: "" },
  { id: "tabs", sel: "#mTabs", sheet: "" },
  { id: "model", sel: "#modelSelect", sheet: "" },
  { id: "search", sel: "#topbar .search", sheet: "" },
  { id: "run", sel: "#runBtn", sheet: "" },
  { id: "taskTabs", sel: "#taskTabs", sheet: "left", task: "sim" },
  { id: "context", sel: "#secContext", sheet: "left", task: "sim" },
  { id: "medium", sel: "#secMedium", sheet: "left", task: "sim" },
  { id: "measured", sel: "#secMeasured", sheet: "left", task: "sim" },
  { id: "objective", sel: "#secObjective", sheet: "left", task: "sim" },
  { id: "perturb", sel: "#secPerturb", sheet: "left", task: "sim" },
  { id: "gestures", sel: "#map", sheet: "" },
  { id: "nav", sel: "#navBar", sheet: "" },
  { id: "view", sel: "#viewOpts", sheet: "" },
  { id: "lines", sel: "#legendBox .qty", sheet: "" },
  { id: "details", sel: "#details", sheet: "right" },
  { id: "compare", sel: "#secCompare", sheet: "left", task: "cmp" },
  { id: "diffScreens", sel: "#secDiffScreens", sheet: "left", task: "cmp" },
  { id: "design", sel: "#secDesign", sheet: "left", task: "cmp" },
  { id: "dataExo", sel: "#secExo", sheet: "left", task: "data" },
  { id: "dataMtb", sel: "#secMtb", sheet: "left", task: "data" },
  { id: "dataRna", sel: "#secRna", sheet: "left", task: "data" },
  { id: "more", sel: "#mMore", sheet: "mMore" },
  { id: "mode", sel: "#modeToggle", sheet: "mMore" },
  { id: "demos", sel: "#demoBtn", sheet: "mMore" },
  { id: "files", sel: "#exportBtn", sheet: "mMore" },
  { id: "again", sel: "#tourBtn", sheet: "mMore" },
  { id: "end", sheet: "" },
];

const CSS = `
.tour-shade { position: fixed; inset: 0; z-index: 1000; pointer-events: auto; }
.tour-hole { position: fixed; z-index: 1001; border: 2px solid var(--accent); border-radius: 8px; box-shadow: 0 0 0 9999px rgba(4, 8, 18, .62); pointer-events: none; transition: all .2s; }
:root[data-theme="light"] .tour-hole { box-shadow: 0 0 0 9999px rgba(40, 48, 68, .45); }
.tour-pop { position: fixed; z-index: 1002; width: min(390px, calc(100vw - 24px)); background: var(--panel); color: var(--text); border: 1px solid var(--accent); border-radius: 10px; padding: 14px 16px 12px; box-shadow: 0 10px 30px rgba(0,0,0,.35); font-size: 13.5px; line-height: 1.5; }
.tour-pop h3 { margin: 0 0 6px; font-size: 15px; color: var(--accent); }
.tour-pop p { margin: 0 0 10px; }
.tour-pop .tour-nav { display: flex; gap: 8px; align-items: center; }
.tour-pop .tour-nav span { flex: 1; color: var(--muted); font-size: 12px; }
.tour-pop button { background: var(--panel2); border: 1px solid var(--line); border-radius: 6px; color: var(--text); padding: 4px 10px; cursor: pointer; font: inherit; font-size: 12.5px; }
.tour-pop button.primary { border-color: var(--accent); color: var(--accent); }
`;

let styled = false;

function taskOf(sel) {
  if (!sel) return null;
  const el = document.querySelector(sel);
  return el?.closest("section[data-task]")?.dataset.task || null;
}

/**
 * Start the walkthrough.
 * opts.sheet(name) opens a phone drawer before a step with `sheet`.
 * opts.task(name) switches the left-panel tab (sim | cmp | data).
 * opts.onStep(step) handles per-step dialog transitions (`step.open`: dialog key or "" to close)
 *                   and collapsible format-help expansion (`step.expand`).
 */
export function startTour(customSteps, opts = {}) {
  if (!styled) { const st = document.createElement("style"); st.textContent = CSS; document.head.appendChild(st); styled = true; }
  document.querySelectorAll(".tour-shade").forEach((n) => n.remove());
  const initialTask = document.getElementById("left")?.dataset.task || null;
  const shade = document.createElement("div"); shade.className = "tour-shade";
  const hole = document.createElement("div"); hole.className = "tour-hole";
  const pop = document.createElement("div"); pop.className = "tour-pop"; pop.setAttribute("role", "dialog");
  shade.append(hole, pop);
  document.body.appendChild(shade);

  // Keep steps whose target is currently visible, inside another task tab, inside a phone sheet,
  // or inside a modal dialog that `step.open` will display.
  const steps = (Array.isArray(customSteps) ? customSteps : TOUR_STEPS).filter((s) => {
    if (!s.sel) return true;
    if (s.open !== undefined) return !!document.querySelector(s.sel);
    if (s.sheet) return !!document.querySelector(s.sel);
    if (visibleEl(s.sel)) return true;
    if (opts.task && (s.task || taskOf(s.sel))) {
      const el = document.querySelector(s.sel);
      return !!el && !el.closest("[hidden]");
    }
    return false;
  });

  let i = 0, seq = 0, timer = null;
  const close = () => {
    seq++;
    clearTimeout(timer);
    if (steps.some((s) => s.sheet !== undefined)) opts.sheet?.("");
    if (opts.task && initialTask && !Array.isArray(customSteps)) opts.task(initialTask);
    shade.remove();
    window.removeEventListener("keydown", key);
    window.removeEventListener("resize", place);
  };
  const key = (ev) => {
    if (ev.key === "Escape") close();
    else if (ev.key === "ArrowRight" || ev.key === "Enter") go(1);
    else if (ev.key === "ArrowLeft") go(-1);
    else return;
    ev.preventDefault();
  };
  const go = (d) => { const k = i + d; if (k < 0) return; if (k >= steps.length) { close(); return; } i = k; show(); };

  function mountShade(el) {
    // A modal <dialog> opened with showModal() sits in the browser top layer above document.body.
    // Mounting the overlay inside the active open <dialog> paints the spotlight and popover cleanly above it.
    const dlg = el?.closest("dialog[open]") || document.querySelector("dialog[open]");
    const host = dlg || document.body;
    if (shade.parentElement !== host) host.appendChild(shade);
  }

  function place() {
    const s = steps[i], el = s?.sel ? visibleEl(s.sel) : null;
    mountShade(el);
    const vw = window.innerWidth, vh = window.innerHeight;
    if (!el) {
      hole.style.cssText = `left:${vw / 2}px;top:${vh / 2}px;width:0;height:0;border-width:0`;
      pop.style.left = `${(vw - pop.offsetWidth) / 2}px`; pop.style.top = `${(vh - pop.offsetHeight) / 2}px`;
      return;
    }
    const r = el.getBoundingClientRect(), pad = 4;
    const box = { l: Math.max(2, r.left - pad), t: Math.max(2, r.top - pad), w: Math.min(r.width + 2 * pad, vw - 4), h: Math.min(r.height + 2 * pad, vh - 4) };
    hole.style.cssText = `left:${box.l}px;top:${box.t}px;width:${box.w}px;height:${box.h}px`;
    const pw = pop.offsetWidth, ph = pop.offsetHeight, gap = 12;
    let x, y;
    if (box.l + box.w + gap + pw < vw) { x = box.l + box.w + gap; y = box.t; }
    else if (box.l - gap - pw > 0) { x = box.l - gap - pw; y = box.t; }
    else if (box.t + box.h + gap + ph < vh) { x = box.l; y = box.t + box.h + gap; }
    else if (box.t - gap - ph > 0) { x = box.l; y = box.t - gap - ph; }
    else { x = box.l + 16; y = box.t + 16; }
    pop.style.left = `${Math.max(8, Math.min(x, vw - pw - 8))}px`;
    pop.style.top = `${Math.max(8, Math.min(y, vh - ph - 8))}px`;
  }

  async function show() {
    const my = ++seq;
    const s = steps[i];
    if (opts.onStep) await opts.onStep(s);
    if (my !== seq) return;
    const tk = s.task || taskOf(s.sel);
    if (tk && opts.task) opts.task(tk);
    if (s.sheet !== undefined && opts.sheet) opts.sheet(s.sheet);
    if (s.expand) {
      const det = document.querySelector(s.expand);
      if (det && det.tagName === "DETAILS") det.open = true;
    }
    const el = s.sel ? visibleEl(s.sel) : null;
    if (el) {
      const sec = el.closest("section.fold"); if (sec?.classList.contains("folded")) sec.classList.remove("folded");
      const det = el.closest("details"); if (det && !det.open) det.open = true;
      el.scrollIntoView({ block: "nearest", inline: "nearest" });
    }
    mountShade(el);
    const last = i === steps.length - 1;
    pop.innerHTML = `<h3>${t(`tour.${s.id}.t`)}</h3><p>${t(`tour.${s.id}.b`)}</p><div class="tour-nav"><span>${i + 1} / ${steps.length}</span>
      <button data-a="close">${t("tour.close")}</button>${i ? `<button data-a="back">${t("tour.back")}</button>` : ""}<button class="primary" data-a="next">${t(last ? "tour.finish" : "tour.next")}</button></div>`;
    pop.querySelector('[data-a="next"]').onclick = () => go(1);
    pop.querySelector('[data-a="close"]').onclick = close;
    const b = pop.querySelector('[data-a="back"]'); if (b) b.onclick = () => go(-1);
    requestAnimationFrame(place);
    clearTimeout(timer);
    if (s.sheet !== undefined || s.open !== undefined) {
      timer = setTimeout(() => { const e = s.sel ? visibleEl(s.sel) : null; e?.scrollIntoView({ block: "nearest" }); place(); }, 260);
    }
    pop.querySelector('[data-a="next"]').focus();
  }

  window.addEventListener("keydown", key);
  window.addEventListener("resize", place);
  show();
}

function visibleEl(sel) {
  for (const el of document.querySelectorAll(sel)) if (!el.hidden && el.getClientRects().length && (el.offsetParent !== null || getComputedStyle(el).position === "fixed")) return el;
  return null;
}
