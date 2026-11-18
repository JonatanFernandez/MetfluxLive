// Walkthrough: a step-by-step tour of the interface. Each step highlights one element and explains it.
// Texts live in the i18n files under tour.<step>.t (title) and tour.<step>.b (body).

import { t } from "../i18n.js";

export const TOUR_STEPS = [
  { id: "welcome" },
  { id: "model", sel: "#modelSelect" },
  { id: "search", sel: "#topbar .search, #search" },
  { id: "mode", sel: "#modeToggle" },
  { id: "run", sel: "#runBtn" },
  { id: "context", sel: "#secContext" },
  { id: "medium", sel: "#secMedium" },
  { id: "tracers", sel: "#trLib" },
  { id: "design", sel: "#designBtn" },
  { id: "measured", sel: "#secMeasured" },
  { id: "objective", sel: "#secObjective" },
  { id: "perturb", sel: "#secPerturb" },
  { id: "compare", sel: "#secCompare" },
  { id: "map", sel: "#map" },
  { id: "nav", sel: "#navBar" },
  { id: "view", sel: "#groupSel" },
  { id: "lines", sel: "#qtySel" },
  { id: "details", sel: "#details" },
  { id: "edit", sel: "#editBtn" },
  { id: "files", sel: "#exportBtn" },
  { id: "docs", sel: "#docsBtn" },
  { id: "again", sel: "#tourBtn" },
  { id: "end" },
];

// The same tour on a phone (js/ui/mobile.js): `sheet` is the panel to open before the step ("" closes them).
export const TOUR_STEPS_MOBILE = [
  { id: "welcome", sheet: "" },
  { id: "tabs", sel: "#mTabs", sheet: "" },
  { id: "model", sel: "#modelSelect", sheet: "" },
  { id: "search", sel: "#topbar .search", sheet: "" },
  { id: "run", sel: "#runBtn", sheet: "" },
  { id: "gestures", sel: "#map", sheet: "" },
  { id: "nav", sel: "#navBar", sheet: "" },
  { id: "view", sel: "#viewOpts", sheet: "" },
  { id: "lines", sel: "#legendBox .qty", sheet: "" },
  { id: "context", sel: "#secContext", sheet: "left" },
  { id: "medium", sel: "#secMedium", sheet: "left" },
  { id: "measured", sel: "#secMeasured", sheet: "left" },
  { id: "objective", sel: "#secObjective", sheet: "left" },
  { id: "perturb", sel: "#secPerturb", sheet: "left" },
  { id: "compare", sel: "#secCompare", sheet: "left" },
  { id: "details", sel: "#details", sheet: "right" },
  { id: "more", sel: "#mMore", sheet: "mMore" },
  { id: "mode", sel: "#modeToggle", sheet: "mMore" },
  { id: "files", sel: "#exportBtn", sheet: "mMore" },
  { id: "again", sel: "#tourBtn", sheet: "mMore" },
  { id: "end", sheet: "" },
];

const CSS = `
.tour-shade { position: fixed; inset: 0; z-index: 1000; pointer-events: auto; }
.tour-hole { position: fixed; z-index: 1001; border: 2px solid var(--accent); border-radius: 8px; box-shadow: 0 0 0 9999px rgba(4, 8, 18, .62); pointer-events: none; transition: all .2s; }
:root[data-theme="light"] .tour-hole { box-shadow: 0 0 0 9999px rgba(40, 48, 68, .45); }
.tour-pop { position: fixed; z-index: 1002; width: min(380px, calc(100vw - 24px)); background: var(--panel); color: var(--text); border: 1px solid var(--accent); border-radius: 10px; padding: 14px 16px 12px; box-shadow: 0 10px 30px rgba(0,0,0,.35); font-size: 13.5px; line-height: 1.5; }
.tour-pop h3 { margin: 0 0 6px; font-size: 15px; color: var(--accent); }
.tour-pop p { margin: 0 0 10px; }
.tour-pop .tour-nav { display: flex; gap: 8px; align-items: center; }
.tour-pop .tour-nav span { flex: 1; color: var(--muted); font-size: 12px; }
.tour-pop button { background: var(--panel2); border: 1px solid var(--line); border-radius: 6px; color: var(--text); padding: 4px 10px; cursor: pointer; font: inherit; font-size: 12.5px; }
.tour-pop button.primary { border-color: var(--accent); color: var(--accent); }
`;

let styled = false;

/**
 * Start the walkthrough. opts.sheet(name) opens a panel of the phone layout before a step that has `sheet`
 * (the panel slides in, so the step is placed once it has arrived).
 */
export function startTour(customSteps, opts = {}) {
  if (!styled) { const st = document.createElement("style"); st.textContent = CSS; document.head.appendChild(st); styled = true; }
  document.querySelector(".tour-shade")?.remove();
  const shade = document.createElement("div"); shade.className = "tour-shade";
  const hole = document.createElement("div"); hole.className = "tour-hole";
  const pop = document.createElement("div"); pop.className = "tour-pop"; pop.setAttribute("role", "dialog");
  shade.append(hole, pop);
  document.body.appendChild(shade);
  // steps inside a closed panel are not visible yet: keep them if their element exists
  const steps = (Array.isArray(customSteps) ? customSteps : TOUR_STEPS).filter((s) => !s.sel || (s.sheet ? document.querySelector(s.sel) : visibleEl(s.sel)));
  let i = 0;
  const close = () => { if (steps.some((s) => s.sheet !== undefined)) opts.sheet?.(""); shade.remove(); window.removeEventListener("keydown", key); window.removeEventListener("resize", place); };
  const key = (ev) => {
    if (ev.key === "Escape") close();
    else if (ev.key === "ArrowRight" || ev.key === "Enter") go(1);
    else if (ev.key === "ArrowLeft") go(-1);
    else return;
    ev.preventDefault();
  };
  const go = (d) => { const k = i + d; if (k < 0) return; if (k >= steps.length) { close(); return; } i = k; show(); };
  function place() {
    const s = steps[i], el = s.sel ? visibleEl(s.sel) : null;
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
    // beside the element if there is room (right, then left), else below, else above, else inside it
    let x, y;
    if (box.l + box.w + gap + pw < vw) { x = box.l + box.w + gap; y = box.t; }
    else if (box.l - gap - pw > 0) { x = box.l - gap - pw; y = box.t; }
    else if (box.t + box.h + gap + ph < vh) { x = box.l; y = box.t + box.h + gap; }
    else if (box.t - gap - ph > 0) { x = box.l; y = box.t - gap - ph; }
    else { x = box.l + 16; y = box.t + 16; }
    pop.style.left = `${Math.max(8, Math.min(x, vw - pw - 8))}px`; pop.style.top = `${Math.max(8, Math.min(y, vh - ph - 8))}px`;
  }
  let timer = null;
  function show() {
    const s = steps[i];
    if (s.sheet !== undefined && opts.sheet) opts.sheet(s.sheet);
    const el = s.sel ? visibleEl(s.sel) : null;
    if (el) {
      const sec = el.closest("section.fold"); if (sec?.classList.contains("folded")) sec.classList.remove("folded");
      el.scrollIntoView({ block: "nearest", inline: "nearest" });
    }
    const last = i === steps.length - 1;
    pop.innerHTML = `<h3>${t(`tour.${s.id}.t`)}</h3><p>${t(`tour.${s.id}.b`)}</p><div class="tour-nav"><span>${i + 1} / ${steps.length}</span>
      <button data-a="close">${t("tour.close")}</button>${i ? `<button data-a="back">${t("tour.back")}</button>` : ""}<button class="primary" data-a="next">${t(last ? "tour.finish" : "tour.next")}</button></div>`;
    pop.querySelector('[data-a="next"]').onclick = () => go(1);
    pop.querySelector('[data-a="close"]').onclick = close;
    const b = pop.querySelector('[data-a="back"]'); if (b) b.onclick = () => go(-1);
    requestAnimationFrame(place);
    clearTimeout(timer); if (s.sheet !== undefined) timer = setTimeout(() => { const e = s.sel ? visibleEl(s.sel) : null; e?.scrollIntoView({ block: "nearest" }); place(); }, 260);
    pop.querySelector('[data-a="next"]').focus();
  }
  window.addEventListener("keydown", key);
  window.addEventListener("resize", place);
  show();
}

function visibleEl(sel) {
  // offsetParent is null for hidden elements, and also for position: fixed ones (the phone tab bar and sheets)
  for (const el of document.querySelectorAll(sel)) if (!el.hidden && el.getClientRects().length && (el.offsetParent !== null || getComputedStyle(el).position === "fixed")) return el;
  return null;
}
