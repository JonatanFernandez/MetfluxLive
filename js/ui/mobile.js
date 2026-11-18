// Phone layout. On a narrow screen (or a phone in landscape) the same page is rearranged instead of rebuilt:
// the map fills the screen, a tab bar at the bottom opens the left panel (Setup), the right panel (Results) and a
// "More" panel as sheets that slide up over the map, and the header keeps only the model, the search and Simulate.
// Controls are moved (not copied) into the More sheet, so every handler keeps working; they go back on a wide screen.

import { t } from "../i18n.js";

const MQ = "(max-width: 760px), (max-height: 520px) and (pointer: coarse)";
const $ = (id) => document.getElementById(id);
const svg = (d) => `<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${d}</svg>`;
const ICONS = {
  map: svg('<circle cx="6" cy="6" r="2.4"/><circle cx="18" cy="8" r="2.4"/><circle cx="9" cy="18" r="2.4"/><path d="M8.2 7.2l7.6.6M16.6 10l-5.9 6M6.6 8.3l1.8 7.4"/>'),
  setup: svg('<path d="M4 6h10M18 6h2M4 12h4M12 12h8M4 18h12M20 18h0"/><circle cx="16" cy="6" r="2"/><circle cx="10" cy="12" r="2"/><circle cx="18" cy="18" r="2"/>'),
  results: svg('<path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/>'),
  more: svg('<circle cx="5" cy="12" r="1.3" fill="currentColor"/><circle cx="12" cy="12" r="1.3" fill="currentColor"/><circle cx="19" cy="12" r="1.3" fill="currentColor"/>'),
  full: svg('<path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5"/>'),
};
// what goes into the More sheet, by group (element ids; labels of checkboxes are moved with their <label>)
const MORE = [
  ["m.gMode", ["modeToggle"]],
  ["m.gMap", ["optInactive", "optParticles", "optAdaptive"]],
  ["m.gTools", ["tourBtn", "methodsBtn", "docsBtn", "editBtn", "importBtn", "exportBtn"]],
  ["m.gLook", ["themeBtn", "lookBtn", "langSel"]],
];
const SHEETS = { left: "m.setup", right: "m.results", mMore: "m.more" };

let on = false, hooks = {}, built = false;
const homes = []; // [element, placeholder comment] to put things back on a wide screen

export const isMobile = () => on;

/** hooks.onLayout(): called after switching layouts (redraw the map, fit the header). */
export function initMobile(h = {}) {
  hooks = h;
  const mq = matchMedia(MQ);
  const apply = () => setMobile(mq.matches);
  mq.addEventListener("change", apply);
  apply();
}

/** Open a sheet ("left", "right", "mMore"); full = taller. On a wide screen it does nothing. */
export function showSheet(id, full = false) {
  if (!on) return;
  document.body.dataset.sheet = id;
  document.body.classList.toggle("sheet-full", full);
  markTabs();
}
export function hideSheet() {
  if (!on) return;
  delete document.body.dataset.sheet;
  document.body.classList.remove("sheet-full");
  markTabs();
}

function markTabs() {
  const cur = document.body.dataset.sheet || "map";
  document.querySelectorAll("#mTabs button").forEach((b) => b.classList.toggle("on", b.dataset.tab === cur));
}

function build() {
  built = true;
  const nav = document.createElement("nav");
  nav.id = "mTabs";
  nav.innerHTML = [["map", "m.map"], ["left", "m.setup"], ["right", "m.results"], ["mMore", "m.more"]]
    .map(([k, l]) => `<button type="button" data-tab="${k}">${ICONS[{ left: "setup", right: "results", mMore: "more" }[k] || k]}<span data-i18n="${l}">${t(l)}</span></button>`).join("");
  document.body.appendChild(nav);
  nav.onclick = (ev) => {
    const b = ev.target.closest("[data-tab]");
    if (!b) return;
    const k = b.dataset.tab;
    if (k === "map" || document.body.dataset.sheet === k) hideSheet(); else showSheet(k, k === "left");
  };

  const more = document.createElement("aside");
  more.id = "mMore";
  more.innerHTML = MORE.map(([h], i) => `<section class="m-group"><h4 data-i18n="${h}">${t(h)}</h4><div class="m-row" data-g="${i}"></div></section>`).join("")
    + `<section class="m-group"><div class="m-row"><button type="button" id="mFull">${ICONS.full}<span data-i18n="m.fullscreen">${t("m.fullscreen")}</span></button></div><p class="hint" id="mInstall" data-i18n="m.install">${t("m.install")}</p></section>`;
  document.querySelector("main").appendChild(more);

  for (const [id, key] of Object.entries(SHEETS)) {
    const head = document.createElement("div");
    head.className = "m-head";
    head.innerHTML = `<span class="m-grab"></span><b data-i18n="${key}">${t(key)}</b><span class="spacer"></span><button type="button" class="icon m-exp" data-i18n-aria="m.expand" aria-label="${t("m.expand")}">⤢</button><button type="button" class="icon m-x" data-i18n-aria="m.close" aria-label="${t("m.close")}">✕</button>`;
    $(id).prepend(head);
    head.querySelector(".m-x").onclick = hideSheet;
    head.querySelector(".m-exp").onclick = () => showSheet(id, !document.body.classList.contains("sheet-full"));
    dragToClose(head, id);
  }

  // the legend takes room on a phone: it opens with a button next to the line selector
  const leg = document.createElement("button");
  leg.type = "button"; leg.className = "m-leg"; leg.dataset.i18n = "m.legend"; leg.textContent = t("m.legend");
  leg.onclick = (ev) => { ev.preventDefault(); $("legendBox").classList.toggle("open"); };
  $("legendBox").querySelector(".qty")?.appendChild(leg);

  const full = $("mFull");
  full.onclick = () => {
    if (document.fullscreenElement) document.exitFullscreen?.();
    else document.documentElement.requestFullscreen?.({ navigationUI: "hide" }).catch(() => {});
  };
  if (!document.documentElement.requestFullscreen) full.hidden = true; // iPhone: only "Add to Home Screen"
  document.addEventListener("fullscreenchange", () => {
    full.querySelector("span").textContent = t(document.fullscreenElement ? "m.exitFull" : "m.fullscreen");
  });
}

// pull the header of a sheet down to close it, up to make it taller
function dragToClose(head, id) {
  let y0 = null;
  head.addEventListener("pointerdown", (ev) => { if (ev.target.closest("button")) return; y0 = ev.clientY; head.setPointerCapture(ev.pointerId); });
  head.addEventListener("pointerup", (ev) => {
    if (y0 === null) return;
    const dy = ev.clientY - y0; y0 = null;
    if (dy > 50) { if (document.body.classList.contains("sheet-full")) showSheet(id, false); else hideSheet(); }
    else if (dy < -50) showSheet(id, true);
    else if (Math.abs(dy) < 6) showSheet(id, !document.body.classList.contains("sheet-full"));
  });
  head.addEventListener("pointercancel", () => { y0 = null; });
}

function moveInto(el, target) {
  if (!el) return;
  const node = el.closest("label.check") || el;
  const mark = document.createComment("m-home");
  node.parentNode.insertBefore(mark, node);
  homes.push([node, mark]);
  target.appendChild(node);
}

function setMobile(want) {
  if (want === on) return;
  on = want;
  if (on && !built) build();
  document.body.classList.toggle("mobile", on);
  if (on) {
    MORE.forEach(([, ids], i) => { const row = document.querySelector(`#mMore [data-g="${i}"]`); for (const id of ids) moveInto($(id), row); });
    hint();
  } else {
    for (const [node, mark] of homes.splice(0).reverse()) { mark.parentNode.insertBefore(node, mark); mark.remove(); }
    hideSheet(); delete document.body.dataset.sheet; document.body.classList.remove("sheet-full");
  }
  markTabs();
  hooks.onLayout?.(on);
}

// once per browser: suggest full screen / home screen, unless the page already runs as an installed app
function hint() {
  let seen = true;
  try { seen = !!localStorage.getItem("metflux.mHint"); localStorage.setItem("metflux.mHint", "1"); } catch { /* ignore */ }
  if (seen || matchMedia("(display-mode: standalone), (display-mode: fullscreen)").matches) return;
  const box = document.createElement("div");
  box.id = "mHint";
  const canFull = !!document.documentElement.requestFullscreen;
  box.innerHTML = `<span>${t(canFull ? "m.hint" : "m.hintIos")}</span>${canFull ? `<button type="button" class="primary" data-a="full">${t("m.fullscreen")}</button>` : ""}<button type="button" data-a="ok">${t("m.dismiss")}</button>`;
  $("stage").appendChild(box);
  box.onclick = (ev) => {
    const a = ev.target.closest("[data-a]")?.dataset.a;
    if (!a) return;
    if (a === "full") document.documentElement.requestFullscreen?.().catch(() => {});
    box.remove();
  };
}
