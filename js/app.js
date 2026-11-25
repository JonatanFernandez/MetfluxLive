// MetfluxLive — application shell: state, panels, navigation and simulation control.
import { Simulator } from "./sim.js";
import { MEDIA, presetMedium, exportMedium, importMedium, uptakeCapacity, kineticsFor } from "./core/medium.js";
import { MEASURED_SETS, DEFAULT_TOL, measuredPreset, measuredNgam, measuredSetsFor } from "./core/measured.js";
import { parseExoTable, groupForRates, ratesFromReplicates, growthRate, toGdw, CELL_MASS_PG } from "./core/exodata.js";
import { fitBounds, exchangeBalance } from "./core/fitexchange.js";
import { buildMetIndex, resolveMetabolite, suggestMetabolites } from "./core/metnames.js";
import { DEMOS, demoById, runDemo } from "./ui/demos.js";
import { parseWideTable, splitByPattern, contrast, normaliseByMedian, metaboliteNetwork, observability,
  bottlenecks, pathwayShifts, ratioChanges, permutationNull, deltaDeltaG } from "./core/metcontrast.js";
import { parseRnaDiffTable, inferRegulatorsMultiOmic } from "./core/reginfer.js";
import { gprActivity } from "./core/gpr.js";
import { loadContexts, offGenes, blockedReactions, offGenesOf, ContextIndex, taskName } from "./core/contexts.js";
import { ModelIndex, fmtFlux, fmtTime, escapeHtml as esc } from "./modelindex.js";
import { MapView, compColor, setCompAliases, enrichColor, deltaColor, energyColor, setMapTheme, revColor } from "./ui/mapview.js";
import { fluxChange, FLUX_EPS } from "./core/change.js";
import { loadLook, applyLook, openLookDialog } from "./ui/look.js";
import { OBJECTIVES, OBJECTIVE_GROUPS, objectiveIndex, isGrowthRxn } from "./core/objectives.js";
import { SearchIndex, attachSearch } from "./ui/search.js";
import { renderMolecule, tracerName } from "./ui/molecule.js";
import { buildCellLayout } from "./celllayout.js";
import { metDepths, cascadeGlobal, cascadeSub } from "./cascade.js";
import { IsotopologueSampler, naturalMid, withNaturalAbundance } from "./core/isotopologues.js";
import { DATASETS, buildResults } from "./export/results.js";
import { makeZip, readStoredZip } from "./export/zip.js";
import { t, initLang, setLang, getLang, docsLang, applyDom, LANGS } from "./i18n.js";
import { applyEdits, editedLayout, editsFile, readEditsFile, modelLookups, EDIT_FORMAT } from "./core/edits.js";
import { createEditor } from "./ui/editor.js";
import { createCompare } from "./ui/compare.js";
import { renderCtxTable, CTT_CSS } from "./ui/ctxtable.js";
import { startTour, TOUR_STEPS, TOUR_STEPS_MOBILE } from "./ui/tour.js";
import { initMobile, isMobile, showSheet, hideSheet } from "./ui/mobile.js";
import { createDesign } from "./ui/design.js";
import { loadTracers, tracerLabel } from "./core/tracerlib.js";
import { QUANTITIES, ATOM_Q, COFACTOR_Q, REDOX_PAIRS, carrierBases, excludedPools, carrierShare, transferableAtoms, cofactorWeights, groupEnergy, dgRunning } from "./core/flows.js";

const SESSION_FORMAT = "metfluxlive-session";

const $ = (id) => document.getElementById(id);
const S = {
  slug: null, model: null, structures: null, layout: null, index: null, search: null, sim: null,
  context: { id: null, mode: "complex" }, ctxData: null, ctxBlock: null, ctxIndex: null, // cell-type context (genes off)
  supplies: [], perturb: [], events: [], measured: { set: "nci60", tol: DEFAULT_TOL, items: [], ngam: 0, edited: false }, cfg: { objective: 0, maximize: true, parsimonious: true },
  mode: "steady", result: null, frameIdx: 0, stale: false,
  auto: { steady: true, dynamic: false }, // re-run automatically after a change, per mode
  grouping: "cascade", filter: "all", cmpView: "b", quantity: "carbon", // what the lines between groups carry
  view: { kind: "global", ss: -1 }, sel: null, runSeq: 0, playing: null,
  scenes: {}, subScenes: new Map(), cell: undefined, statusFn: null,
  base: null, edits: [], edited: null, editMode: false, // model editor: published model + edit operations
  scenarios: [], compare: null, // comparison mode: saved scenarios, id of the one compared with
};
let map, editor, compare;
const small = (s) => ` <small style="color:var(--muted);font-weight:400">${s}</small>`;
// dG'm (kJ/mol, low end of the estimate) above which a direction is impossible in any cell
const IMPOSSIBLE_DG = 100;

// ------------------------------------------------------------------ boot ----
async function boot() {
  initLang();
  const ls = $("langSel");
  for (const [code] of LANGS) ls.add(new Option(code.toUpperCase(), code));
  ls.value = getLang();
  bindFolds(); bindResizers();
  applyDom(); initMobile({ onLayout: () => fitHeader() }); fitHeader();
  let fitTimer = null;
  window.addEventListener("resize", () => { clearTimeout(fitTimer); fitTimer = setTimeout(fitHeader, 120); });
  $("docsBtn").href = "docs.html?lang=" + docsLang();
  document.querySelectorAll("a[data-docs]").forEach((a) => { a.href = `docs.html?lang=${docsLang()}#${docsLang()}-${a.dataset.docs}`; });
  // "metflux.view" replaces "metflux.grouping" (2026-11-14), so that the new default (cascade) is seen once
  try { const g = localStorage.getItem("metflux.view"); if (g === "cell" || g === "pathway" || g === "cascade") S.grouping = g; } catch { /* storage unavailable */ }
  try { const a = JSON.parse(localStorage.getItem("metflux.auto") || "null"); if (a) S.auto = { steady: a.steady !== false, dynamic: !!a.dynamic }; } catch { /* storage unavailable */ }
  setTheme(document.documentElement.dataset.theme === "light" ? "light" : "dark", false);
  try { const q = localStorage.getItem("metflux.quantity"); if (QUANTITIES.includes(q)) S.quantity = q; } catch { /* storage unavailable */ }
  window.__metflux = { S, get map() { return map; } }; // for diagnostics and automated tests
  map = new MapView($("map"), { onSelect: onMapSelect, onOpen: onMapOpen, onHover: onMapHover, onContext: openCtxMenu, onNav: navGo });
  editor = createEditor({ S, setEdits, gotoReaction, gotoMet, refreshDetails: renderDetails });
  compare = createCompare({ S, capture, opsKey, load: (sc) => loadScenario(sc), show: showScenario, redraw: () => { applyFrame(); renderDetails(); }, mediumName, frame });
  bindUi();
  editor.bind();
  let models;
  try {
    models = await (await fetch("data/models.json")).json();
    S.models = models;
  } catch {
    $("loadingText").textContent = t("load.missing");
    return;
  }
  const sel = $("modelSelect");
  for (const m of models) sel.add(new Option(`${m.name} ${m.version}`, m.slug));
  let wanted = models[0].slug;
  try { const saved = localStorage.getItem("metflux.model"); if (models.some((m) => m.slug === saved)) wanted = saved; } catch { /* storage unavailable */ }
  const urlModel = new URLSearchParams(location.search).get("model"); // links from the cell-type catalogue
  if (models.some((m) => m.slug === urlModel)) wanted = urlModel;
  sel.value = wanted;
  const url = new URLSearchParams(location.search), vs = url.get("vs"), ctxA = url.get("context");
  await loadModel(wanted, { noRun: !!vs });
  if (vs) await compareContexts(ctxA, vs);
  // first visit in this browser: open the walkthrough once (closing it early also counts)
  let seen = true;
  try { seen = !!localStorage.getItem("metflux.tourSeen"); if (!seen) localStorage.setItem("metflux.tourSeen", "1"); } catch { /* no storage: never auto-open */ }
  if (!seen && !ctxA) tour();
}

/** Switch the left-panel task tab ("sim" | "cmp" | "data"). */
function setTask(task) {
  const left = $("left");
  if (!left || !["sim", "cmp", "data"].includes(task)) return;
  left.dataset.task = task;
  document.querySelectorAll("#taskTabs button[data-task]").forEach((b) => {
    const on = b.dataset.task === task;
    b.classList.toggle("on", on);
    b.setAttribute("aria-selected", String(on));
  });
  left.scrollTop = 0;
}

/** The walkthrough of the layout on screen (desktop or phone). */
function tour() {
  if (isMobile()) startTour(TOUR_STEPS_MOBILE, { sheet: (s) => (s ? showSheet(s, s === "mMore") : hideSheet()), task: setTask });
  else startTour(TOUR_STEPS, { task: setTask });
}

async function loadModel(slug, opts = {}) {
  const loading = $("loading");
  loading.classList.remove("done");
  $("loadingText").textContent = t("load.model");
  const get = async (f) => {
    const r = await fetch(`data/${slug}/${f}`);
    if (!r.ok) throw new Error(`${f}: ${r.status}`);
    return r.json();
  };
  try {
    const optional = (f) => fetch(`data/${slug}/${f}`).then((r) => (r.ok ? r.json() : null)).catch(() => null);
    const [model, structures, atommaps, layout, thermo, ctxData] = await Promise.all([get("model.json"), get("structures.json"), get("atommaps.json"), get("layout.json"), optional("thermo.json"), loadContexts(slug)]);
    model.meta = { ...model.meta, slug };
    Object.assign(S, { slug, base: { model, structures, atommaps, layout, thermo }, result: null, sel: null, frameIdx: 0 });
    S.ctxData = ctxData || { meta: {}, taskNames: [], contexts: [], byId: new Map() };
    mergeUserContexts(slug);
    S.context = storedContext(slug);
    const urlCtx = new URLSearchParams(location.search).get("context");
    if (urlCtx && ctxData?.byId.has(urlCtx)) {
      S.context = { id: urlCtx, mode: S.context.mode };
      try { localStorage.setItem("metflux.context." + slug, JSON.stringify(S.context)); } catch { /* ignore */ }
      history.replaceState(null, "", location.pathname);
    }
    S.edits = opts.edits ?? storedEdits(slug);
    $("loadingText").textContent = t("load.solver");
    mtbClear(false);
    regClear(false);
    updateRegButton();
    rebuildModel();
    S.supplies = []; S.events = [];
    loadMedium(storedMediumId(), false);
    S.perturb = []; S.events = [];
    loadMeasured(storedMeasuredId(), false);
    S.cfg = { objective: Math.max(0, S.index.biomassRxn), maximize: true, parsimonious: true };
    S.scenes = {}; S.subScenes = new Map(); S.cell = undefined; S.depth = null;
    setCompAliases(S.index.compRole, S.index.membraneOf);
    try { localStorage.setItem("metflux.model", slug); } catch { /* ignore */ }
    $("groupSel").querySelector('[value="cell"]').disabled = !cellLayout();
    if (!cellLayout() && S.grouping === "cell") S.grouping = "pathway";
    $("groupSel").value = S.grouping;
    renderContext(); renderSupplies(); renderMeasured(); renderPerturb(); renderEvents(); renderObjective(); renderSecondary(); openGlobal(); renderDetails();
    editor.render(); compare.render();
    loading.classList.add("done");
    navReset();
    if (!opts.noRun) run();
  } catch (err) {
    console.error(err);
    $("loadingText").textContent = t("load.error", { msg: err.message });
  }
}

// ------------------------------------------------------------ model edits ----
function storedEdits(slug) {
  try { const o = JSON.parse(localStorage.getItem("metflux.edits." + slug) || "null"); return o ? readEditsFile(o).ops : []; } catch { return []; }
}
function storeEdits() {
  try {
    if (S.edits.length) localStorage.setItem("metflux.edits." + S.slug, JSON.stringify(editsFile(S.base.model, S.edits)));
    else localStorage.removeItem("metflux.edits." + S.slug);
  } catch { setStatus(() => t("ed.storageError"), true); }
}
const opsKey = () => JSON.stringify(S.edits);

/** Published model + edit operations -> the model every view and the simulator work on. */
function rebuildModel() {
  const B = S.base, E = S.edits.length ? applyEdits(B, S.edits) : null;
  S.edited = E;
  S.model = E ? E.model : B.model;
  S.structures = E ? E.structures : B.structures;
  S.atommaps = E ? E.atommaps : B.atommaps;
  S.layout = E ? editedLayout(B.layout, S.model) : B.layout;
  S.index = new ModelIndex(S.model, S.layout);
  // what the lines can carry: carriers (recycled moieties), pools left out per element, cofactor weights, dG'm
  const carriers = carrierBases(S.model, S.index.currency);
  const th = B.thermo?.rxns || {};
  S.flowData = {
    carriers, excl: { C: excludedPools(S.model, S.index.currency, carriers, "C"), N: excludedPools(S.model, S.index.currency, carriers, "N") },
    cof: {}, noSkip: new Uint8Array(S.model.bases.length),
    // reactions added by an edit have no dG'm (their conditions and identifiers were not computed)
    dG: Float64Array.from(S.model.rxns, (r) => (!r.user && th[r.id] ? th[r.id][0] : NaN)),
    dGsd: Float64Array.from(S.model.rxns, (r) => (!r.user && th[r.id] ? th[r.id][1] : NaN)),
    hasDG: !!B.thermo,
  };
  S.search = new SearchIndex(S.model, S.index);
  S.sim?.dispose();
  S.sim = new Simulator(S.model, S.structures, S.atommaps);
  computeContextBlock();
  S.scenes = {}; S.subScenes = new Map(); S.cell = undefined; S.depth = null; S.depthKey = null;
  S.result = null;
  MTB.net = null; MTB.index = null;
  renderEditBadge();
}

function renderEditBadge() {
  const n = S.edits.length, bad = S.edited ? S.edited.results.filter((r) => !r.ok).length : 0;
  $("editBadge").hidden = !n;
  $("editBadge").innerHTML = t("ed.badge", { n }) + (bad ? ` <b class="err">${t("ed.badgeErr", { n: bad })}</b>` : "");
}

/** Replace the edit list: rebuild the model and carry every setting over by id. */
function setEdits(ops, focusRxn = null) {
  const snap = capture(), view = S.view, sel = S.sel;
  S.edits = ops;
  storeEdits();
  rebuildModel();
  const lost = applySettings(snap);
  editor.render(); compare.attach(); compare.render();
  $("groupSel").querySelector('[value="cell"]').disabled = !cellLayout();
  if (view.kind === "sub" && S.layout.subs[view.ss]) openSubsystem(view.ss, true); else openGlobal();
  const okSel = sel && ((sel.type === "rxn" && S.model.rxns[sel.rxn] && !S.model.rxns[sel.rxn].removed) || (sel.type === "met" && S.model.mets[sel.met] && !S.model.mets[sel.met].removed) || sel.type === "sub" || sel.type === "gene");
  S.sel = okSel ? sel : null;
  renderDetails();
  run().then(() => {
    if (focusRxn) { const j = modelLookups(S.model).rxn.get(focusRxn); if (j !== undefined) gotoReaction(j); }
    if (lost) { const prev = S.statusFn; setStatus(() => prev() + " " + t("imp.lost", { n: lost })); }
  });
}

// ------------------------------------------------ settings by id (sessions) ----
const labelIdx = (label) => (label ? Array.from(label, (x, a) => (x > 0 ? a : -1)).filter((a) => a >= 0) : null);

/** Everything that defines the current situation, with ids instead of indices (portable across edits and sessions). */
function capture() {
  const M = S.model, mid = (m) => M.mets[m].id;
  const savedMedium = (id) => (id.startsWith(USER) ? userMedia()[id.slice(USER.length)] || null : null);
  return {
    mode: S.mode,
    medium: {
      id: S.mediumId, name: mediumName(S.mediumId), saved: savedMedium(S.mediumId),
      components: S.supplies.map((it) => ({ met: mid(it.met), conc: it.conc, conc0: it.conc0, vmax: it.vmax, km: it.km, unlimited: !!it.unlimited, hold: !!it.hold, label: labelIdx(it.label), fraction: it.fraction ?? 1 })),
    },
    measured: { set: S.measured.set, tol: S.measured.tol, ngam: S.measured.ngam, edited: S.measured.edited, items: S.measured.items.map((x) => ({ met: mid(x.met), rate: x.rate })) },
    context: { id: S.context.id, mode: S.context.mode, user: S.context.id?.startsWith("user:") ? currentContext() : undefined },
    perturbations: S.perturb.map((p) => ({ type: p.type, target: p.type === "gene" ? p.ref : M.rxns[p.ref].id, activity: p.a })),
    objective: { reaction: M.rxns[S.cfg.objective].id, maximize: S.cfg.maximize, parsimonious: S.cfg.parsimonious,
      secondary: S.cfg.secondary ? { reaction: M.rxns[S.cfg.secondary.rxn].id, maximize: S.cfg.secondary.maximize !== false, keep: S.cfg.secondary.frac } : null },
    dynamic: { hours: +$("dynHours").value || 24, biomass: +$("dynBiomass").value || 0.5, pool: +$("dynPool").value || 0.5 },
    events: S.events.map((ev) => (ev.type === "medium" ? { t: ev.t, type: "medium", medium: ev.mediumId, saved: savedMedium(ev.mediumId) } : { t: ev.t, type: "add", met: mid(ev.met), conc: ev.conc, label: labelIdx(ev.label), fraction: ev.fraction ?? 1 })),
  };
}

/** Inverse of capture() on the current model. Returns how many entries had no counterpart in it. */
function applySettings(o) {
  const L = modelLookups(S.model);
  let lost = 0;
  const met = (id) => { const m = L.met.get(id); if (m === undefined || S.model.mets[m].removed) { lost++; return undefined; } return m; };
  const label = (m, idx) => {
    if (!idx || !idx.length) return null;
    const st = supplyStruct({ met: m }), n = st ? st.e.length : 1, a = new Float64Array(n);
    for (const i of idx) if (i < n) a[i] = 1;
    return a.some((x) => x > 0) ? a : null;
  };
  const ensureMedium = (id, saved) => {
    if (!id.startsWith(USER) || mediumExists(id) || !Array.isArray(saved)) return mediumExists(id) ? id : "default";
    const all = userMedia(); all[id.slice(USER.length)] = saved;
    try { localStorage.setItem("metflux.media", JSON.stringify(all)); } catch { return "default"; }
    return id;
  };
  setMode(o.mode === "dynamic" ? "dynamic" : "steady", false);
  S.mediumId = ensureMedium(o.medium.id, o.medium.saved);
  savePref("medium", S.mediumId);
  S.supplies = [];
  for (const c of o.medium.components) {
    const m = met(c.met);
    if (m === undefined) continue;
    S.supplies.push({ met: m, conc: +c.conc, conc0: +(c.conc0 ?? c.conc), vmax: +c.vmax, km: +c.km, unlimited: !!c.unlimited, hold: !!c.hold, label: label(m, c.label), fraction: +c.fraction || 1 });
  }
  const set = MEASURED_SETS.some((x) => x.id === o.measured.set) ? o.measured.set : "none";
  S.measured = { set, tol: +o.measured.tol || 0, ngam: +o.measured.ngam || 0, edited: !!o.measured.edited, items: [] };
  for (const x of o.measured.items) { const m = met(x.met); if (m !== undefined && S.sim.exchanges.has(m)) S.measured.items.push({ met: m, rate: +x.rate }); }
  if (o.context?.user && !S.ctxData.byId.has(o.context.id)) addUserContext(o.context.user); // a session carries its own RNA-seq cell type
  if (o.context && o.context.id && !S.ctxData?.byId.has(o.context.id)) lost++;
  setContext(o.context?.id && S.ctxData?.byId.has(o.context.id) ? o.context.id : null, o.context?.mode || "complex", false); // setContext validates the mode
  S.perturb = [];
  for (const p of o.perturbations) {
    if (p.type === "gene") { if (S.search.geneRxns.has(p.target)) S.perturb.push({ type: "gene", ref: p.target, a: +p.activity }); else lost++; }
    else { const j = L.rxn.get(p.target); if (j !== undefined && !S.model.rxns[j].removed) S.perturb.push({ type: "rxn", ref: j, a: +p.activity }); else lost++; }
  }
  const oj = L.rxn.get(o.objective.reaction);
  if (oj === undefined || S.model.rxns[oj].removed) lost++;
  S.cfg = { objective: oj !== undefined && !S.model.rxns[oj].removed ? oj : Math.max(0, S.index.biomassRxn), maximize: o.objective.maximize !== false, parsimonious: o.objective.parsimonious !== false };
  { const s2 = o.objective.secondary, sj = s2 ? L.rxn.get(s2.reaction) : undefined;
    S.cfg.secondary = sj !== undefined && !S.model.rxns[sj].removed && sj !== S.cfg.objective ? { rxn: sj, maximize: s2.maximize !== false, frac: Math.min(1, Math.max(0, +s2.keep || 0)) } : null; }
  $("dynHours").value = o.dynamic.hours; $("dynBiomass").value = o.dynamic.biomass; $("dynPool").value = o.dynamic.pool;
  S.events = [];
  for (const ev of o.events) {
    if (ev.type === "medium") { S.events.push({ type: "medium", t: +ev.t, mediumId: ensureMedium(ev.medium, ev.saved) }); continue; }
    const m = met(ev.met);
    if (m !== undefined) S.events.push({ type: "add", t: +ev.t, met: m, conc: +ev.conc, label: label(m, ev.label), fraction: +ev.fraction || 1 });
  }
  renderContext(); renderMediumSel(); renderSupplies(); renderMeasured(); renderPerturb(); renderEvents(); renderObjective(); renderSecondary();
  return lost;
}

/** Make a saved scenario the current situation (its model edits included) and run it. */
async function loadScenario(sc, ask = true) {
  if (ask && !confirm(t("cmp.loadConfirm", { name: sc.name }))) return;
  if (JSON.stringify(sc.ops) !== opsKey()) {
    S.edits = sc.ops.map((op) => ({ ...op }));
    storeEdits();
    rebuildModel();
    editor.render();
    openGlobal();
  }
  const lost = applySettings(sc.settings);
  S.sel = null;
  compare.render(); renderDetails();
  await run();
  S.shown = sc.id; compare.render(); applyFrame(); renderDetails();
  if (lost) { const prev = S.statusFn; setStatus(() => prev() + " " + t("imp.lost", { n: lost })); }
}

/**
 * Put a saved scenario on screen again (the "Show" side of a comparison). With the same model edits its stored
 * result is reused as it is; otherwise the scenario is loaded and recomputed. Replacing an unsaved situation asks first.
 * @returns whether the scenario is now shown
 */
async function showScenario(sc) {
  if (!sc || sc.ctx.slug !== S.slug) return false;
  if (!S.shown && S.result && !confirm(t("cmp.loadConfirm", { name: sc.name }))) return false;
  if (JSON.stringify(sc.ops) !== opsKey()) { await loadScenario(sc, false); return true; }
  clearTimeout(autoTimer); S.runSeq++; stopPlay();
  applySettings(sc.settings);
  S.result = sc.result; S.frameIdx = Math.min(sc.frameIdx ?? sc.result.frames.length - 1, sc.result.frames.length - 1);
  S.stale = false; S.shown = sc.id; S.sel = null;
  $("runBtn").classList.remove("pending");
  compare.attach(); compare.render();
  setupTimeline(); applyFrame(); renderDetails();
  setStatus(() => t("status.shown", { name: sc.name }), false, "done");
  return true;
}

function setMode(mode, rerun = true) {
  S.mode = mode;
  renderAuto();
  $("modeToggle").querySelectorAll("button").forEach((x) => x.classList.toggle("on", x.dataset.mode === mode));
  $("dynSection").hidden = $("secEvents").hidden = mode !== "dynamic";
  if (!rerun) return;
  if (S.auto[mode]) run();
  else { S.stale = true; clearTimeout(autoTimer); setStatus(() => t("status.changed")); $("runBtn").classList.add("pending"); }
}

// ------------------------------------------------- compartments and groups ----
function compName(c) {
  const role = S.index.compRole[c];
  if (role === "peri" && !/periplasm/i.test(S.model.compartments[c])) return t("comp.wall"); // yeast cell envelope
  return role ? t("comp." + role) : S.index.compName(c);
}

/** Name of a location in the cell view: a compartment, or the membrane of one. */
function locName(loc) {
  if (!loc.startsWith("mem:")) return compName(loc);
  const c = loc.slice(4), role = S.index.compRole[c], peri = S.index.roleComp.peri;
  // with a periplasm or cell wall the plasma membrane is the inner one (drawn as "mem:" + that layer)
  if (peri && role === "ext") return t(/periplasm/i.test(S.model.compartments[peri]) ? "loc.outer" : "loc.wall");
  if (peri && role === "peri") return t("loc.plasma");
  if (role === "ext") return t("loc.plasma");
  if (role === "inner") return t("loc.mitoInner");
  return t("loc.membrane", { c: compName(c) });
}

function cellLayout() {
  if (S.cell === undefined) S.cell = buildCellLayout(S.model, S.index);
  return S.cell;
}

/** Reaction grouping behind the global map. */
function groups() {
  if (S.grouping === "cell" && cellLayout()) {
    const c = cellLayout();
    return c.G || (c.G = { key: "cell", n: c.groups.length, groupOf: c.groupOf, skip: null, perMet: true });
  }
  return S.index.pathwayGroups;
}
const isCell = () => groups().key === "cell";

// ---------------------------------------------------------------- cascade ----
const isCascade = () => S.grouping === "cascade";
const depthKey = () => S.supplies.filter((it) => it.unlimited || it.conc > 0).map((it) => it.met).sort((a, b) => a - b).join(",");

/** Steps of every metabolite from the current medium; cascade layouts are rebuilt when the medium changes. */
function depths() {
  const key = depthKey();
  if (!S.depth || S.depthKey !== key) {
    S.depth = metDepths(S.model, S.index, key ? key.split(",").map(Number) : []);
    S.depthKey = key;
    delete S.scenes.cascade;
    for (const k of [...S.subScenes.keys()]) if (String(k).startsWith("c")) S.subScenes.delete(k);
  }
  return S.depth;
}

function stepLabel(from, to) {
  if (from > S.depth.max) return t("cascade.unreach");
  if (to <= 0) return t("cascade.medium");
  return from === to ? t("cascade.step", { a: from }) : t("cascade.steps", { a: from, b: Math.min(to, S.depth.max) });
}

/** After a medium change: redraw the cascade if its order moved. */
function refreshCascade() {
  if (!S.model || !isCascade() || !S.depth || depthKey() === S.depthKey) return;
  if (S.view.kind === "global") { map.setScene(globalScene(), true); applyFrame(); }
  else if (S.view.kind === "sub") { const sc = subScene(S.view.ss); if (sc) { map.setScene(sc, true); applyFrame(); } }
}

// ----------------------------------------------------------------- scenes ----
function globalScene() {
  const key = isCascade() ? "cascade" : groups().key;
  if (key === "cascade") depths();
  if (S.scenes[key]) return S.scenes[key];
  const listOnly = new Set(S.layout.listOnly);
  let sc;
  if (key === "cell") {
    const c = cellLayout();
    const nodes = c.nodes.map((n) => ({ ...n, label: S.model.subsystems[n.ss], listOnly: listOnly.has(n.ss) }));
    const regions = c.regions.map((r) => ({ ...r, label: locName(r.loc), color: compColor(r.comp) }));
    sc = { kind: "global", cell: true, nodes, edges: [], regions };
  } else {
    const g = S.layout.global;
    // the cascade also shows the transport pathway, which the other layouts leave out
    const gn = key === "cascade" ? [...g.nodes, ...S.model.subsystems.map((_, ss) => ss).filter((ss) => S.index.isTransportSub[ss] && !g.nodes.some((n) => n.ss === ss)).map((ss) => ({ ss, x: 0, y: 0, n: S.index.rxnsOfSub[ss].length, r: 0.6 }))] : g.nodes;
    const C = key === "cascade" ? cascadeGlobal(S.model, S.index, gn, g.edges, depths()) : null;
    const nodes = gn.map((n) => ({ type: 2, ref: n.ss, ss: n.ss, x: C ? C.pos.get(n.ss)[0] : n.x, y: C ? C.pos.get(n.ss)[1] : n.y, size: n.n, r: n.r, label: S.model.subsystems[n.ss], listOnly: listOnly.has(n.ss) }));
    const at = new Map(nodes.map((n, i) => [n.ref, i]));
    // in the cascade the rows already carry the structure: only the flows are drawn
    const edges = C ? [] : g.edges.filter((e) => at.has(e[0]) && at.has(e[1])).map((e) => ({ a: at.get(e[0]), b: at.get(e[1]) }));
    sc = { kind: "global", nodes, edges };
    if (C) { sc.cascade = true; sc.guides = C.guides.map((gd) => ({ y: gd.y, label: gd.kind ? t("cascade." + gd.kind) : stepLabel(gd.from, gd.to) })); }
  }
  return (S.scenes[key] = sc);
}

function subScene(ss) {
  const casc = isCascade(), key = casc ? "c" + ss : ss;
  if (casc) depths();
  if (S.subScenes.has(key)) return S.subScenes.get(key);
  const L0 = S.layout.subs[ss];
  if (!L0) return null;
  const { model } = S;
  const C = casc ? cascadeSub(model, L0, depths(), S.index) : null;
  const L = C ? { m: C.m, mx: C.mx, my: C.my, r: C.r, rx: C.rx, ry: C.ry } : L0;
  const nodes = [], at = new Map();
  const seen = new Map();
  for (const m of L.m) seen.set(model.mets[m].b, (seen.get(model.mets[m].b) || 0) + 1);
  L.m.forEach((m, k) => {
    const met = model.mets[m];
    at.set(m, nodes.length);
    // the same metabolite in several compartments gets its compartment in the label
    nodes.push({ type: 0, ref: m, x: L.mx[k], y: L.my[k], label: model.bases[met.b].n + (seen.get(met.b) > 1 ? ` [${met.c}]` : ""), comp: met.c });
  });
  const edges = [];
  L.r.forEach((j, k) => {
    const r = model.rxns[j], ri = nodes.length;
    nodes.push({ type: 1, ref: j, x: L.rx[k], y: L.ry[k], label: r.n.length <= 26 ? r.n : r.id, transport: r.ss !== ss });
    r.m.forEach((m, q) => { if (at.has(m)) edges.push({ r: ri, m: at.get(m), coef: r.c[q] }); });
  });
  const sc = { kind: "sub", ss, nodes, edges };
  if (C) sc.guides = C.guides.map((gd) => ({ y: gd.y, label: gd.kind ? t("cascade." + gd.kind) : gd.unreachable ? t("cascade.unreach") : gd.level === 0 ? t("cascade.entry") : t("cascade.local", { a: gd.level + 1 }) }));
  S.subScenes.set(key, sc);
  return sc;
}

function openGlobal() {
  if (S.view?.kind !== "global") navPush();
  S.view = { kind: "global", ss: -1 };
  $("listView").hidden = true;
  map.setScene(globalScene());
  renderCrumbs(); applyFrame();
  if (S.filter !== "all") map.fit(false, true);
}

/** Open a pathway map; `grp` restricts a list view to one cell-view group. */
function openSubsystem(ss, keepSel = false, grp = null) {
  const sc = subScene(ss);
  if (S.view?.kind !== (sc ? "sub" : "list") || S.view.ss !== ss || (S.view.grp ?? null) !== grp) navPush();
  S.view = { kind: sc ? "sub" : "list", ss, grp: sc ? null : grp };
  if (!keepSel) S.sel = grp !== null && !sc ? { type: "grp", g: grp } : { type: "sub", ss };
  if (sc) { $("listView").hidden = true; map.setScene(sc); }
  else map.setScene({ kind: "empty", nodes: [], edges: [] });
  renderCrumbs(); applyFrame(); renderDetails();
  if (sc) map.fit(false, true);
}

const openGroup = (g) => openSubsystem(cellLayout().groups[g].ss, false, g);

function renderCrumbs() {
  const c = $("crumbs");
  c.textContent = "";
  const a = document.createElement("a");
  a.textContent = t(isCascade() ? "crumb.cascade" : isCell() ? "crumb.cell" : "crumb.global"); a.onclick = () => { S.sel = null; openGlobal(); renderDetails(); };
  c.appendChild(a);
  if (S.view.kind === "focus") {
    const sep = document.createElement("span"); sep.className = "sep"; sep.textContent = "›";
    const cur = document.createElement("span"), cn = S.view.center;
    cur.textContent = t("crumb.focus", { n: cn.type === "met" ? S.index.metName(cn.ref) : S.model.rxns[cn.ref].n });
    c.append(sep, cur);
  } else if (S.view.kind !== "global") {
    const sep = document.createElement("span"); sep.className = "sep"; sep.textContent = "›";
    const cur = document.createElement("span");
    cur.textContent = S.model.subsystems[S.view.ss] + (S.view.grp != null ? " · " + locName(cellLayout().groups[S.view.grp].loc) : "");
    c.append(sep, cur);
  }
}

function renderListView(mask) {
  const box = $("listView"), ss = S.view.ss, f = frame();
  let all = S.view.grp != null ? cellLayout().groups[S.view.grp].rxns : S.index.rxnsOfSub[ss];
  if (mask) all = all.filter((j) => mask.rxn[j]);
  const rows = all.map((j) => [f ? Math.max(Math.abs(f.v[j]), f.ref ? Math.abs(f.ref.v[j]) : 0) : 0, j]).sort((a, b) => b[0] - a[0]).slice(0, 400);
  const ref = f?.ref;
  box.hidden = false;
  box.innerHTML = `<p class="hint">${t("list.hint", { k: rows.length, n: S.index.rxnsOfSub[ss].length })}</p>
    <table class="list"><thead><tr><th>ID</th><th>${t("th.rxn")}</th><th>${t("th.eq")}</th>${ref ? `<th>${t("th.ref")}</th>` : ""}<th>${t("th.flux")}</th></tr></thead><tbody>${rows.map(([, j]) => {
    const v = f ? f.v[j] : 0;
    return `<tr data-rxn="${j}"><td>${S.model.rxns[j].id}</td><td>${esc(S.model.rxns[j].n)}</td><td>${esc(S.index.equation(j, v || (ref ? ref.v[j] : 0)))}</td>${ref ? `<td class="num">${fmtFlux(ref.v[j])}</td>` : ""}<td class="num">${fmtFlux(v)}</td></tr>`;
  }).join("")}</tbody></table>`;
  box.querySelectorAll("tr[data-rxn]").forEach((tr) => { tr.onclick = () => { S.sel = { type: "rxn", rxn: +tr.dataset.rxn }; renderDetails(); }; });
}

// ------------------------------------------------------------- navigation ----
const drawable = (ss) => !!S.layout.subs[ss];

// History of views (pathway, global, centred view) with their selection and camera: back / forward.
const NAV = { back: [], fwd: [], restoring: false };
const navState = () => ({ view: { ...S.view }, sel: S.sel ? { ...S.sel } : null, cam: { ...map.cam } });
function navPush() {
  if (NAV.restoring || !S.model || !S.view) return;
  NAV.back.push(navState());
  if (NAV.back.length > 60) NAV.back.shift();
  NAV.fwd = [];
  renderNavBtns();
}
function navGo(dir) {
  const from = dir < 0 ? NAV.back : NAV.fwd, to = dir < 0 ? NAV.fwd : NAV.back;
  if (!from.length) return;
  to.push(navState());
  const st = from.pop();
  NAV.restoring = true;
  try {
    const v = st.view;
    if (v.kind === "global") openGlobal();
    else if (v.kind === "focus") openFocus(v.center);
    else openSubsystem(v.ss, true, v.grp ?? null);
    S.sel = st.sel;
    map.cam = { ...st.cam }; map.camTarget = null;
    applyGhosts();
    if (st.sel?.type === "met" || st.sel?.type === "rxn") map.selected = map.findNode(st.sel.type === "met" ? 0 : 1, st.sel.type === "met" ? st.sel.met : st.sel.rxn);
    renderDetails();
  } finally { NAV.restoring = false; }
  renderNavBtns();
}
function navReset() { NAV.back = []; NAV.fwd = []; renderNavBtns(); }
function renderNavBtns() { if (!$("navBack")) return; $("navBack").disabled = !NAV.back.length; $("navFwd").disabled = !NAV.fwd.length; }

/** Open the pathway of a reaction (a reaction of another pathway clicked on the map) and select it there. */
function goToPathwayOf(j) {
  S.sel = { type: "rxn", rxn: j };
  openSubsystem(S.model.rxns[j].ss, true);
  const i = map.findNode(1, j);
  if (i >= 0) map.focusNode(i);
  renderDetails();
}

/**
 * Inside a pathway, a selected metabolite also shows, around it and for as long as it is selected, the reactions
 * of other pathways that make or use it with flux (up to 8, dashed ring; click one to go to its pathway).
 */
function applyGhosts(force = false) {
  const cur = map.scene, base = cur.ghostBase || cur, f = frame();
  let m = null;
  if (S.view.kind === "sub" && S.sel?.type === "met" && f && base.nodes.some((n) => n.type === 0 && n.ref === S.sel.met)) m = S.sel.met;
  if (m === null) { if (cur.ghostBase) { map.setScene(base, true); map.selected = -1; applyFrame(); } return; }
  if (!force && cur.ghostBase && cur.ghostOf === m && cur.ghostResult === S.result && cur.ghostFrame === S.frameIdx) return;
  const { index, model } = S, inScene = new Set(base.nodes.filter((n) => n.type === 1).map((n) => n.ref));
  const list = [];
  for (let p = index.rxnStart[m]; p < index.rxnStart[m + 1]; p++) {
    const j = index.rxnList[p], x = f.v[j] * index.rxnCoef[p];
    if (Math.abs(x) > 1e-9 && !inScene.has(j) && !model.rxns[j].removed) list.push({ j, x, coef: index.rxnCoef[p] });
  }
  list.sort((a, b) => Math.abs(b.x) - Math.abs(a.x));
  const top = list.slice(0, 8), mi = base.nodes.findIndex((n) => n.type === 0 && n.ref === m), c = base.nodes[mi];
  if (!top.length) { if (cur.ghostBase) { map.setScene(base, true); applyFrame(); } map.selected = mi; return; }
  const nodes = base.nodes.slice(), edges = base.edges.slice();
  top.forEach((g, k) => {
    const a = -Math.PI / 2 + ((k + 0.5) * 2 * Math.PI) / top.length, R = 3.4;
    const r = model.rxns[g.j], name = r.n.length <= 22 ? r.n : r.id;
    edges.push({ r: nodes.length, m: mi, coef: g.coef });
    nodes.push({ type: 1, ref: g.j, x: c.x + R * Math.cos(a), y: c.y + R * Math.sin(a), label: `${name} → ${model.subsystems[r.ss]}`, ghost: true });
  });
  map.setScene({ ...base, nodes, edges, labelOrder: undefined, ghostBase: base, ghostOf: m, ghostResult: S.result, ghostFrame: S.frameIdx }, true);
  map.selected = mi;
  applyFrame();
}

/**
 * A map arranged around one metabolite or reaction. Metabolite: the reactions that make it on the left, those that
 * use it on the right, inactive ones below, and their other metabolites further out. Reaction: its substrates on the
 * left, products on the right, and the reactions with flux that make or use them further out.
 */
function focusScene(center) {
  const { model, index } = S, f = frame(), cur = index.currency;
  const nodes = [], edges = [], metAt = new Map(), rxnAt = new Map();
  const metLabel = (m) => model.bases[model.mets[m].b].n + ` [${model.mets[m].c}]`;
  const addMet = (m, x, y) => { if (metAt.has(m)) return metAt.get(m); metAt.set(m, nodes.length); nodes.push({ type: 0, ref: m, x, y, label: metLabel(m), comp: model.mets[m].c }); return nodes.length - 1; };
  const addRxn = (j, x, y) => { if (rxnAt.has(j)) return rxnAt.get(j); rxnAt.set(j, nodes.length); const r = model.rxns[j]; nodes.push({ type: 1, ref: j, x, y, label: r.n.length <= 26 ? r.n : r.id }); return nodes.length - 1; };
  const rxnsOf = (m) => { const out = []; for (let p = index.rxnStart[m]; p < index.rxnStart[m + 1]; p++) { const j = index.rxnList[p]; if (!model.rxns[j].removed) out.push({ j, coef: index.rxnCoef[p], x: f ? f.v[j] * index.rxnCoef[p] : 0 }); } return out; };
  const fan = (items, center0, R, step) => items.map((it, k) => { const a = center0 + (k - (items.length - 1) / 2) * step; return { ...it, x: R * Math.cos(a), y: R * Math.sin(a), a }; });
  if (center.type === "met") {
    const m = center.ref, ci = addMet(m, 0, 0);
    const all = rxnsOf(m).sort((a, b) => Math.abs(b.x) - Math.abs(a.x));
    const prod = all.filter((r) => r.x > 1e-9).slice(0, 12), cons = all.filter((r) => r.x < -1e-9).slice(0, 12), idle = all.filter((r) => Math.abs(r.x) <= 1e-9).slice(0, 8);
    const R1 = 3.2, step = 0.32;
    for (const g of [fan(prod, Math.PI, R1, step), fan(cons, 0, R1, step), fan(idle, Math.PI / 2, R1 + 0.8, step)]) for (const it of g) {
      const ri = addRxn(it.j, it.x, it.y);
      edges.push({ r: ri, m: ci, coef: it.coef });
      const r = model.rxns[it.j], others = r.m.map((mm, q) => [mm, r.c[q]]).filter(([mm]) => mm !== m && !cur[model.mets[mm].b]);
      others.forEach(([mm, cc], k) => {
        const a = it.a + (k - (others.length - 1) / 2) * 0.11, R2 = R1 + 3;
        const mi = addMet(mm, R2 * Math.cos(a), R2 * Math.sin(a));
        edges.push({ r: ri, m: mi, coef: cc });
      });
    }
  } else {
    const j = center.ref, r = model.rxns[j], ri = addRxn(j, 0, 0), v = f ? f.v[j] : 0, dir = v < 0 ? -1 : 1;
    const mets = r.m.map((mm, q) => ({ m: mm, coef: r.c[q] })).filter((x) => !cur[model.mets[x.m].b]);
    const subs = mets.filter((x) => x.coef * dir < 0), prods = mets.filter((x) => x.coef * dir > 0), R1 = 3, step = 0.45;
    for (const g of [fan(subs, Math.PI, R1, step), fan(prods, 0, R1, step)]) for (const it of g) {
      const mi = addMet(it.m, it.x, it.y);
      edges.push({ r: ri, m: mi, coef: it.coef });
      const near = rxnsOf(it.m).filter((x) => x.j !== j && Math.abs(x.x) > 1e-9).sort((a, b) => Math.abs(b.x) - Math.abs(a.x)).slice(0, 5);
      near.forEach((nx, k) => {
        const a = it.a + (k - (near.length - 1) / 2) * 0.16, R2 = R1 + 3;
        const rj = addRxn(nx.j, R2 * Math.cos(a), R2 * Math.sin(a));
        edges.push({ r: rj, m: mi, coef: nx.coef });
      });
    }
  }
  return { kind: "sub", ss: -1, focus: true, nodes, edges };
}

// ---------------------------------------------------------------- worked examples ----
// The demo library (js/ui/demos.js). A demo is replayed through the application's own functions, so it
// cannot drift from what the application really does, and then handed to the walkthrough.

/** Everything a demo is allowed to do, each one the function a click would reach. */
function demoApi() {
  const settle = () => new Promise((r) => requestAnimationFrame(() => setTimeout(r, 0)));
  const DLG_IDS = { exo: "exoDialog", mtb: "mtbDialog", reg: "regDialog", rna: "rnaDialog" };
  const closeAllDialogs = () => { for (const id of Object.values(DLG_IDS)) if ($(id)?.open) $(id).close(); };
  // Non-destructive modal switcher for tour Back/Next: re-opens the already-populated dialog without clearing results.
  const onStep = async (step) => {
    if (step.open === undefined) return;
    if (!step.open) { closeAllDialogs(); await settle(); return; }
    const targetId = DLG_IDS[step.open];
    if (!targetId) return;
    for (const [k, id] of Object.entries(DLG_IDS)) if (k !== step.open && $(id)?.open) $(id).close();
    const dlg = $(targetId);
    if (dlg && !dlg.open) dlg.showModal();
    await settle();
  };
  let lastScId = null;
  return {
    note: (msg) => console.warn(msg),
    task: async (name) => { setTask(name); await settle(); },
    model: async (slug) => { if (S.slug !== slug) await loadModel(slug); },
    medium: async (id) => { if (mediumExists(id)) loadMedium(id, false); await settle(); },
    measured: async (id) => { loadMeasured(id, false); await settle(); },
    context: async (id, mode) => { setContext(id, mode, false); await settle(); },
    objective: async (objId) => {
      const o = OBJECTIVES.find((x) => x.id === objId);
      const j = o ? objectiveIndex(S.model, S.index, o) : -1;
      if (j >= 0) { S.cfg.objective = j; renderObjective(); renderSecondary(); }
      await settle();
    },
    perturb: async (type, target, activity) => {
      addPerturb(type, type === "gene" ? target : S.index.rxnIndex.get(target));
      if (activity !== undefined) { const p = S.perturb[S.perturb.length - 1]; if (p) p.a = +activity; }
      renderPerturb(); await settle();
    },
    clearPerturb: async () => { S.perturb = []; renderPerturb(); renderMeasured(); await settle(); },
    tracer: async (id) => { await applyLibraryTracer(id); await settle(); },
    setConc: async (name, conc) => {
      const low = String(name).toLowerCase();
      const it = S.supplies.find((s) => S.model.bases[S.model.mets[s.met].b].n.toLowerCase() === low);
      if (it) { it.conc = +conc; it.unlimited = false; renderSupplies(); }
      await settle();
    },
    selectMet: async (name) => {
      const low = String(name).toLowerCase();
      // Prefer mitochondrial pool when available (e.g. citrate[m] in TCA tracing), else cytosolic or first match
      const cand = S.model.mets.map((m, i) => [i, m]).filter(([, m]) => !m.removed && S.model.bases[m.b].n.toLowerCase() === low);
      const pick = cand.find(([, m]) => m.c === "m") || cand.find(([, m]) => m.c === "c") || cand[0];
      if (pick) { S.sel = { type: "met", met: pick[0] }; renderDetails(); }
      await settle();
    },
    run: async () => { await run(); },
    saveScenario: async (name) => {
      let nm = name || "WT";
      if (S.scenarios.some((x) => x.name === nm)) {
        let k = 2; while (S.scenarios.some((x) => x.name === `${nm} ${k}`)) k++;
        nm = `${nm} ${k}`;
      }
      const sc = compare.save(nm);
      if (sc) { lastScId = sc.id; S.shown = sc.id; compare.render(); }
      await settle();
    },
    compare: async (id) => {
      const target = id === "last" ? lastScId : id;
      if (target !== undefined) compare.setCompare(target);
      await settle();
    },
    open: async (which) => {
      const fn = which === "exo" ? openExoDialog : which === "reg" ? openRegDialog : which === "rna" ? openRnaDialog : openMtbDialog;
      await fn(); await settle();
    },
    closeDialogs: async () => { closeAllDialogs(); await settle(); },
    fill: async (id, value) => { const el = $(id); if (el) { el.value = value; el.dispatchEvent(new Event("input", { bubbles: true })); } await settle(); },
    click: async (id) => { const el = $(id); if (el) el.click(); await settle(); await settle(); },
    loadRnaText: async (text, name) => { readRnaText(text, name || "sample.tsv"); await settle(); },
    setOverlay: async (on) => {
      const cb = $("mtbOverlay");
      if (cb) { cb.checked = !!on; cb.dispatchEvent(new Event("change", { bubbles: true })); }
      await settle();
    },
    markTopTf: async () => {
      const top = REG.result?.tfs.find((x) => x.metRxns?.size);
      if (top) regMarkTf(top.tf);
      await settle();
    },
    tour: (steps) => startTour(steps, { task: setTask, onStep }),
  };
}

/** The picker: one line per example, linked to its corresponding section in docs.html. */
function openDemoDialog() {
  const list = $("demoList");
  const dl = docsLang();
  list.innerHTML = DEMOS.map((d) => `<div class="demo-row"><div class="row"><button type="button" class="link" data-demo="${esc(d.id)}">${esc(t(`demo.${d.id}.title`))}</button>`
    + (d.docs ? `<span class="spacer"></span><a class="link" href="docs.html?lang=${dl}#${dl}-${esc(d.docs)}" target="_blank" rel="noopener">${esc(t("obj.help"))}</a>` : "")
    + `</div><p class="hint">${esc(t(`demo.${d.id}.what`))}</p><p class="hint cite">${esc(d.cite)}</p></div>`).join("");
  list.querySelectorAll("[data-demo]").forEach((b) => {
    b.onclick = async () => {
      const d = demoById(b.dataset.demo);
      if (!d) return;
      $("demoDialog").close();
      if (d.needs?.model && S.slug !== d.needs.model) {
        if (!confirm(t("demo.switchModel", { model: d.needs.model }))) return;
      }
      $("demoBtn").disabled = true;
      try { await runDemo(d, demoApi()); }
      catch (err) { alert(t("demo.failed", { msg: err?.message || String(err) })); }
      finally { $("demoBtn").disabled = false; }
    };
  });
  $("demoDialog").showModal();
}

// ---------------------------------------------------- intracellular metabolomics ----
// A contrast between two conditions placed on the network (js/core/metcontrast.js). What is shown here is
// what the validation kept: the metabolites that changed, the candidate steps with their permutation null,
// the ratio changes, and the two things that decide whether any of it means anything — whether the panel
// had to be normalised, and which reactions the panel can see at all.

const MTB = { table: null, net: null, index: null, result: null, overlay: false };

const PANEL_SHIFT = 0.3;   // log2: beyond this the whole panel moved and the samples have to be normalised
const RATIO_PAIRS = [      // only as a CHANGE between the conditions: see metcontrast.js
  ["ATP", "AMP", "rat.energy"], ["ATP", "ADP", "rat.atpAdp"],
  ["L-lactate", "pyruvate", "rat.lacPyr"], ["GSH", "GSSG", "rat.gshGssg"],
  ["NADPH", "NADP+", "rat.nadph"], ["glutamate", "AKG", "rat.gluAkg"],
];

function openMtbDialog() {
  MTB.index = null;
  if (!MTB.result) {
    MTB.table = null;
    $("mtbFile").value = ""; $("mtbText").value = "";
    $("mtbOut").hidden = true; $("mtbOut").textContent = ""; $("mtbStatus").textContent = "";
    $("mtbUnmappedBox").hidden = true;
  } else {
    $("mtbOut").hidden = false;
    mtbRender();
  }
  $("mtbDialog").showModal();
}

function mtbClear(redraw = true) {
  MTB.table = null; MTB.result = null; MTB.overlay = false;
  if ($("mtbOverlay")) $("mtbOverlay").checked = false;
  if ($("mtbOverlayWrap")) $("mtbOverlayWrap").hidden = true;
  if ($("mtbNote")) $("mtbNote").textContent = "";
  if ($("mtbText")) $("mtbText").value = "";
  if ($("mtbOut")) { $("mtbOut").hidden = true; $("mtbOut").textContent = ""; }
  if (redraw && REG.rnaMap) regRun();
  if (redraw) { applyFrame(); renderDetails(); }
}

/** Per-node metabolomics overlay data for MapView (pathway or global scene). */
function mtbMapData(kind) {
  if (!MTB.overlay || !MTB.result || !S.model) return null;
  const R = MTB.result;
  if (kind === "sub") {
    if (!R.subOverlay) {
      const fcByMet = new Map(), sigMets = new Set();
      S.model.mets.forEach((m, i) => {
        const fc = R.fcByBase.get(m.b);
        if (fc !== undefined) {
          fcByMet.set(i, fc);
          if ((R.qByBase.get(m.b) ?? 1) < 0.05) sigMets.add(i);
        }
      });
      R.subOverlay = { fcByMet, sigMets, obsRxns: R.obsRxns, topSteps: R.topSteps };
    }
    return R.subOverlay;
  }
  const G = groups();
  R.globalCache ??= new Map();
  if (!R.globalCache.has(G.key)) {
    const medFc = new Float32Array(G.n).fill(NaN);
    const hasObs = new Uint8Array(G.n), hasTop = new Uint8Array(G.n);
    const byG = Array.from({ length: G.n }, () => new Set());
    const cur = MTB.net?.currency || new Set();
    S.model.rxns.forEach((r, j) => {
      if (r.removed) return;
      const g = G.groupOf[j];
      if (g < 0 || g >= G.n) return;
      if (R.obsRxns.has(j)) hasObs[g] = 1;
      if (R.topSteps.has(j)) hasTop[g] = 1;
      for (const m of r.m) {
        const b = S.model.mets[m].b;
        if (!cur.has(b) && R.fcByBase.has(b)) byG[g].add(b);
      }
    });
    for (let g = 0; g < G.n; g++) {
      const vals = [...byG[g]].map((b) => R.fcByBase.get(b)).sort((a, b) => a - b);
      if (vals.length) medFc[g] = vals.length % 2 ? vals[(vals.length - 1) / 2] : (vals[vals.length / 2 - 1] + vals[vals.length / 2]) / 2;
    }
    R.globalCache.set(G.key, { medFc, hasObs, hasTop });
  }
  return R.globalCache.get(G.key);
}

/** Close the loop: knock out a candidate bottleneck in the model, compare against baseline, and open Compare. */
async function mtbTestBlock(j) {
  $("mtbDialog").close();
  if (S.stale || !S.result) { await run(); if (S.stale || !S.result) return; }
  let baseId = S.compare;
  if (!baseId) {
    let nm = t("mtb.baseline");
    if (S.scenarios.some((x) => x.name === nm)) {
      let k = 2; while (S.scenarios.some((x) => x.name === `${nm} ${k}`)) k++;
      nm = `${nm} ${k}`;
    }
    const sc = compare.save(nm);
    if (sc) baseId = sc.id;
  }
  const ex = S.perturb.find((p) => p.type === "rxn" && p.ref === j);
  if (ex) ex.a = 0; else S.perturb.push({ type: "rxn", ref: j, a: 0 });
  renderPerturb(); renderMeasured();
  await run();
  if (baseId) compare.setCompare(baseId);
  openSubsystem(S.model.rxns[j].ss, true);
  S.sel = { type: "rxn", rxn: j };
  const ni = map.findNode(1, j);
  if (ni >= 0) map.focusNode(ni);
  renderDetails();
  setTask("cmp");
}

/** The index for intracellular data covers every metabolite of the model, not only the medium. */
function mtbResolve(label) {
  if (!MTB.index) {
    MTB.index = buildMetIndex(S.model);
    MTB.baseById = new Map(S.model.bases.map((b, i) => [b.id, i]));
    MTB.manual = loadMetMap(S.slug);   // the same hand mapping the medium importer remembers
  }
  const key = String(label).trim().toLowerCase();
  const byHand = MTB.manual.get(key);
  if (byHand !== undefined) {
    if (byHand === "") return { base: undefined, via: "ignored" };
    const b = MTB.baseById.get(byHand);
    if (b !== undefined) return { base: b, via: "manual" };
  }
  return resolveMetabolite(label, MTB.index);
}

async function mtbRun() {
  const text = $("mtbText").value.trim();
  const status = $("mtbStatus"), out = $("mtbOut");
  if (!text) { status.textContent = t("mtb.errEmpty"); return; }
  const table = parseWideTable(text);
  if (table.errors.length) { out.hidden = true; status.innerHTML = `<span class="err">${table.errors.map(esc).join("<br>")}</span>`; return; }
  MTB.table = table;
  // if the table named the groups, offer them; otherwise the patterns the user typed decide
  const named = [...new Set(table.groups.filter(Boolean))];
  if (named.length >= 2 && !$("mtbPatA").value && !$("mtbPatB").value) { $("mtbPatA").value = named[0]; $("mtbPatB").value = named[1]; }
  const split = splitByPattern(table, $("mtbPatA").value, $("mtbPatB").value);
  const warn = table.warnings.length ? `<details><summary>${t("mtb.nWarn", { n: table.warnings.length })}</summary>${table.warnings.map(esc).join("<br>")}</details>` : "";
  if (!split.nA || !split.nB) {
    out.hidden = true;
    status.innerHTML = `<span class="err">${t("mtb.errSplit", { a: split.nA, b: split.nB, samples: esc(table.samples.slice(0, 8).join(", ")) })}</span>${warn}`;
    return;
  }
  if (split.overlap) { status.innerHTML = `<span class="err">${t("mtb.errOverlap", { n: split.overlap })}</span>${warn}`; out.hidden = true; return; }
  status.innerHTML = warn;

  // normalise only when the panel as a whole has moved, and never silently
  const raw = contrast(split.rows);
  const needed = Math.abs(raw.panelMedian) > PANEL_SHIFT;
  const norm = needed ? normaliseByMedian(split.rows) : { rows: split.rows, factors: [] };
  const c = needed ? contrast(norm.rows) : raw;

  // place the metabolites on the network
  MTB.net ??= metaboliteNetwork(S.model, S.layout);
  const fcByBase = new Map(), qByBase = new Map(), unresolved = [];
  const rows = [];
  for (const r of c.rows) {
    const { base, via } = mtbResolve(r.label);
    if (base === undefined) { unresolved.push({ ...r, via }); continue; }
    rows.push({ ...r, bases: [base], via });
    fcByBase.set(base, r.log2fc); qByBase.set(base, r.q);
  }
  const obs = observability(MTB.net, fcByBase.keys());
  const thermo = S.base?.thermo?.rxns || null;  // [dG, uncertainty] per reaction id, when the model has it
  const curFlux = frame()?.v || null;
  const steps = bottlenecks(MTB.net, fcByBase, qByBase, { thermo, flux: curFlux });
  const shifts = pathwayShifts(MTB.net, rows, { panelMedian: c.panelMedian });
  const byName = new Map(rows.map((r) => [S.model.bases[r.bases[0]].n, r.log2fc]));
  const ratios = ratioChanges(RATIO_PAIRS.map(([a, b, k]) => [a, b, t(k)]), byName);

  // can noise do as well? Shuffling the sample labels keeps the correlation between metabolites.
  out.hidden = false;
  out.innerHTML = `<p class="hint">${t("mtb.busyPerm")}</p>`;
  await new Promise((r) => setTimeout(r, 0));
  const perm = steps.length
    ? permutationNull(needed ? norm.rows : split.rows, (rr) => {
        const cc = contrast(rr);
        const fc = new Map(), qq = new Map();
        for (const x of cc.rows) { const { base } = mtbResolve(x.label); if (base !== undefined) { fc.set(base, x.log2fc); qq.set(base, x.q); } }
        const b = bottlenecks(MTB.net, fc, qq, { thermo, flux: curFlux });
        return b.length ? b[0].score : 0;
      }, { rounds: 60 })
    : null;

  MTB.result = {
    c, rawMedian: raw.panelMedian, rows, steps, shifts, ratios, obs, perm, needed, norm, split,
    fcByBase, qByBase,
    obsRxns: new Set(obs.bothSides.map((r) => r.rxn)),
    topSteps: new Set(steps.slice(0, 8).map((s) => s.rxn)),
    stepByRxn: new Map(steps.map((s) => [s.rxn, s])),
  };
  MTB.overlay = true;
  if ($("mtbOverlay")) $("mtbOverlay").checked = true;
  if ($("mtbOverlayWrap")) $("mtbOverlayWrap").hidden = false;
  mtbRender();
  mtbRenderUnmapped(unresolved);
  if (REG.rnaMap) await regRun();
  applyFrame();
  renderDetails();
}

function mtbRender() {
  const { c, rawMedian, rows, steps, shifts, ratios, obs, perm, needed, norm, split, fcByBase } = MTB.result;
  const name = (b) => S.model.bases[b].n;
  const fmtq = (q) => (q < 1e-4 ? q.toExponential(0) : q.toFixed(3));
  const top = [...rows].sort((a, b) => Math.abs(b.log2fc) - Math.abs(a.log2fc)).slice(0, 18);
  const factors = norm.factors.length
    ? `${Math.min(...norm.factors.map((f) => f.factor)).toFixed(2)}–${Math.max(...norm.factors.map((f) => f.factor)).toFixed(2)}` : "";
  const sig = c.rows.filter((x) => x.q < 0.05).length;

  $("mtbOut").innerHTML =
    `<div class="note">${t("mtb.summary", { a: split.nA, b: split.nB, n: rows.length, total: c.rows.length, sig })}</div>`
    + `<div class="note${needed ? " warnbox" : ""}">${needed
        ? t("mtb.normApplied", { med: c.panelMedian.toFixed(2), raw: rawMedian.toFixed(2), f: factors })
        : t("mtb.normNot", { med: c.panelMedian.toFixed(2) })}</div>`
    + `<p class="hint">${t("mtb.observability", { both: obs.nBothSides, one: obs.nOneSide, paths: obs.pathways.size })}</p>`
    + `<details class="scr-group" open><summary>${t("mtb.changed")} (${sig})</summary><div class="scr-list">`
      + top.map((r) => `<div class="mtb-row"><span class="linkish" data-mtbmet="${r.bases[0]}" title="${esc(name(r.bases[0]))}">${esc(r.label)}</span>`
          + `<span class="val">${r.log2fc > 0 ? "+" : ""}${r.log2fc.toFixed(2)}</span><span class="q">q ${fmtq(r.q)}</span></div>`).join("")
      + `</div></details>`
    + (ratios.length ? `<details class="scr-group" open><summary>${t("mtb.ratios")}</summary><div class="scr-list">`
        + ratios.map((x) => `<div class="mtb-row"><span title="${esc(x.what)}">${esc(x.a)}/${esc(x.b)}</span>`
          + `<span class="val">${x.dlog2 > 0 ? "+" : ""}${x.dlog2.toFixed(2)}</span><span class="q">×${x.fold.toFixed(2)}</span></div>`).join("")
        + `</div><p class="hint">${t("mtb.ratioNote")}</p></details>` : "")
    + (steps.length ? `<details class="scr-group" open><summary>${t("mtb.steps")} (${steps.length})</summary><div class="scr-list">`
        + steps.slice(0, 8).map((b) => {
            const ddg = deltaDeltaG(S.model, b.rxn, fcByBase, { direction: b.direction });
            const ddgTxt = ddg ? ` · ${t(ddg.partial ? "mtb.ddgPartial" : "mtb.ddg", { x: (ddg.ddg > 0 ? "+" : "") + ddg.ddg.toFixed(1), m: ddg.measured, n: ddg.total })}` : "";
            const cls = REG.result?.classifiedSteps?.find((x) => x.rxn === b.rxn);
            const mechBadge = cls?.mechanism === "transcriptional"
              ? `<span class="reg-tag tx">${t("reg.mechTx")}</span>`
              : cls?.mechanism === "postTranscriptional"
                ? `<span class="reg-tag ptx">${t("reg.mechPtx")}</span>` : "";
            return `<div class="mtb-step"><span class="linkish" data-mtbrxn="${b.rxn}">${esc(b.name)}</span>${mechBadge}`
              + `<span class="meta">${esc(b.ss)} · ${t("mtb.stepScore", { s: b.score.toFixed(2) })} · ${t("mtb.stepSides", {
                  sub: esc(b.measured.sub.map(name).join(", ")), up: b.subUp.toFixed(2),
                  prod: esc(b.measured.prod.map(name).join(", ")), down: b.prodDown.toFixed(2) })}${ddgTxt}`
              + (b.couldBeReversal ? ` · <span class="warn">${t("mtb.couldReverse")}</span>` : "")
              + (b.carriesFlux === false ? ` · <span class="warn">${t("mtb.noFlux")}</span>` : "") + `</span>`
              + `<div class="mtb-step-acts"><button type="button" class="link" data-mtbopen="${b.rxn}">${t("mtb.openPath")}</button><button type="button" class="link" data-mtbtest="${b.rxn}">${t("mtb.testBlock")}</button></div></div>`;
          }).join("")
        + `</div>` + (perm ? `<p class="hint${perm.p > 0.05 ? " warn" : ""}">${t("mtb.perm", { p: perm.p.toFixed(3), better: perm.better, rounds: perm.rounds })}</p>` : "")
        + (REG_MODELS.has(S.slug) ? `<p class="hint"><button type="button" class="link" id="mtbCrossRna">${t("mtb.crossRna")}</button></p>` : "")
        + `</details>` : `<p class="hint">${t("mtb.noSteps")}</p>`)
    + (shifts.length ? `<details class="scr-group"><summary>${t("mtb.classes")}</summary><div class="scr-list">`
        + shifts.slice(0, 6).map((p) => `<div class="mtb-row"><span title="${esc(p.ss)}">${esc(p.ss)}</span>`
          + `<span class="val">${p.median > 0 ? "+" : ""}${p.median.toFixed(2)}</span><span class="q">q ${fmtq(p.q)}</span></div>`).join("")
        + `</div><p class="hint">${t("mtb.classNote")}</p></details>` : "");

  $("mtbOut").querySelectorAll("[data-mtbmet]").forEach((el) => {
    el.onclick = () => { const b = +el.dataset.mtbmet;
      const m = S.model.mets.findIndex((x) => x.b === b);
      if (m >= 0) { S.sel = { type: "met", met: m }; renderDetails(); $("mtbDialog").close(); } };
  });
  $("mtbOut").querySelectorAll("[data-mtbrxn]").forEach((el) => {
    el.onclick = () => { S.sel = { type: "rxn", rxn: +el.dataset.mtbrxn }; renderDetails(); $("mtbDialog").close(); };
  });
  $("mtbOut").querySelectorAll("[data-mtbopen]").forEach((el) => {
    el.onclick = () => {
      const j = +el.dataset.mtbopen;
      $("mtbDialog").close();
      MTB.overlay = true;
      if ($("mtbOverlay")) $("mtbOverlay").checked = true;
      openSubsystem(S.model.rxns[j].ss, true);
      S.sel = { type: "rxn", rxn: j };
      const ni = map.findNode(1, j);
      if (ni >= 0) map.focusNode(ni);
      applyFrame(); renderDetails();
    };
  });
  $("mtbOut").querySelectorAll("[data-mtbtest]").forEach((el) => {
    el.onclick = () => mtbTestBlock(+el.dataset.mtbtest);
  });
  const cross = $("mtbCrossRna");
  if (cross) cross.onclick = () => { $("mtbDialog").close(); openRegDialog(); };
  $("mtbNote").textContent = t("mtb.loaded", { n: rows.length, sig });
}

/** The labels nothing resolved, offered for hand mapping exactly as in the medium importer. */
function mtbRenderUnmapped(rows) {
  const box = $("mtbUnmappedBox"), out = $("mtbUnmapped");
  box.hidden = !rows.length;
  if (!rows.length) { out.textContent = ""; return; }
  $("mtbUnmappedH").textContent = t("exo.unmappedH", { n: rows.length, ignored: rows.filter((r) => r.via === "ignored").length });
  out.innerHTML = rows.map((r) => {
    const sug = suggestMetabolites(r.label, MTB.index, 10);
    const opts = [`<option value="">${esc(t("exo.pick"))}</option>`]
      .concat(sug.map((c) => `<option value="${esc(S.model.bases[c.base].id)}">${esc(c.name)} · ${Math.round(100 * c.score)} %</option>`))
      .concat([`<option value="__skip">${esc(t("exo.skip"))}</option>`]);
    return `<div class="exo-map"><span class="lbl" title="${esc(r.label)}">${esc(r.label)}</span>`
      + (sug.length ? `<select data-mtbmap="${esc(r.label)}">${opts.join("")}</select>` : `<span class="absent">${esc(t("exo.noCandidate"))}</span>`)
      + `<span class="val meta">${r.log2fc > 0 ? "+" : ""}${r.log2fc.toFixed(2)}</span></div>`;
  }).join("");
  out.querySelectorAll("[data-mtbmap]").forEach((sel) => {
    sel.onchange = () => {
      const key = sel.dataset.mtbmap.trim().toLowerCase();
      if (!sel.value) MTB.manual.delete(key); else MTB.manual.set(key, sel.value === "__skip" ? "" : sel.value);
      saveMetMap(S.slug, MTB.manual);
      mtbRun();
    };
  });
}

// ------------------------------------------------ regulatory network inference ----
// Signed TF activity via ULM (js/core/reginfer.js) from user differential RNA-seq (A vs B), optionally
// combined with intracellular metabolomics for 3-step causal chains and bottleneck mechanism classification.
// Validated on E. coli single & double TF knockouts (GSE153906 / GSE195954); metabolomics-only TF inference
// is intentionally omitted because whole-sample permutation testing showed it is underpowered.

const REG_MODELS = new Set(["human-gem", "mouse-gem", "ecoli-gem"]);
const REG = { data: null, slug: null, rnaMap: null, result: null, markedTf: null, markedRxns: null };

function updateRegButton() {
  const btn = $("regOpen");
  if (!btn) return;
  const ok = REG_MODELS.has(S.slug);
  btn.disabled = !ok;
  btn.title = ok ? t("reg.openTitle") : t("reg.noModel");
}

async function loadRegulons() {
  if (REG.data && REG.slug === S.slug) return REG.data;
  if (!REG_MODELS.has(S.slug)) return null;
  const r = await fetch(`data/${S.slug}/regulons.json`);
  if (!r.ok) return null;
  REG.data = await r.json();
  REG.slug = S.slug;
  return REG.data;
}

function regClear(redraw = true) {
  REG.rnaMap = null; REG.result = null; REG.markedTf = null; REG.markedRxns = null;
  if ($("regBar")) $("regBar").hidden = true;
  if ($("regNote")) $("regNote").textContent = "";
  if ($("regMarkTxt")) $("regMarkTxt").textContent = "";
  if ($("regText")) $("regText").value = "";
  if ($("regOut")) { $("regOut").hidden = true; $("regOut").textContent = ""; }
  if (map && S.sel?.type !== "gene") map.marks = null;
  if (MTB.result) mtbRender();
  if (redraw) { applyFrame(); renderDetails(); }
}

async function openRegDialog() {
  if (!REG_MODELS.has(S.slug)) return;
  if (!REG.result) {
    $("regFile").value = "";
    $("regText").value = "";
    $("regOut").hidden = true; $("regOut").textContent = ""; $("regStatus").textContent = "";
  }
  $("regMeta").textContent = t("reg.loading");
  $("regDialog").showModal();
  const data = await loadRegulons();
  if (!data) { $("regMeta").textContent = t("reg.noModel"); return; }
  $("regMeta").textContent = t("reg.meta", { src: data.meta.source, n: data.meta.nTFs });
  // If metabolomics state changed since the last run, re-run automatically to refresh concordance
  if (REG.rnaMap && (!REG.result || REG.result.hasMet !== !!MTB.result)) await regRun();
  else if (REG.result) { $("regOut").hidden = false; regRender(); }
}

async function regRun() {
  const text = $("regText").value.trim();
  const status = $("regStatus"), out = $("regOut");
  if (!text) { status.textContent = t("reg.errEmpty"); return; }
  const parsed = parseRnaDiffTable(text);
  if (parsed.map.size < 20) {
    out.hidden = true;
    status.innerHTML = `<span class="err">${t("reg.errFew", { n: parsed.map.size })}</span>`;
    return;
  }
  const data = await loadRegulons();
  if (!data) { status.innerHTML = `<span class="err">${t("reg.noModel")}</span>`; return; }
  status.textContent = "";
  const ctx = currentContext();
  const offSet = ctx && S.base?.model?.genes ? new Set([...offGenes(ctx, S.base.model.genes)].map((g) => g.toLowerCase())) : null;
  const hasMtb = !!MTB.result;
  if (hasMtb) MTB.net ??= metaboliteNetwork(S.model, S.layout);
  const res = inferRegulatorsMultiOmic(
    S.model,
    hasMtb ? MTB.net : null,
    data,
    hasMtb ? MTB.result.fcByBase : null,
    hasMtb ? MTB.result.qByBase : null,
    parsed.map,
    {
      thermo: S.base?.thermo?.rxns || null,
      flux: frame()?.v || null,
      offGenes: offSet,
      bottleneckSteps: hasMtb ? MTB.result.steps.slice(0, 12) : [],
    },
  );
  REG.rnaMap = parsed.map;
  REG.result = res;
  out.hidden = false;
  regRender();
  if (MTB.result) mtbRender();
}

function regMarkTf(tfName) {
  const entry = REG.result?.tfs.find((x) => x.tf === tfName);
  if (!entry || !entry.metRxns?.size) return;
  REG.markedTf = entry.tf;
  REG.markedRxns = entry.metRxns;
  $("regMarkTxt").textContent = t("reg.marked", { tf: entry.tf, n: entry.metRxns.size });
  $("regBar").hidden = false;
  $("regDialog").close();
  // Jump to the pathway containing the most regulated reactions if we are in global view
  if (S.view.kind === "global") {
    const counts = new Map();
    for (const j of entry.metRxns) {
      const ss = S.model.rxns[j]?.ss;
      if (ss >= 0 && drawable(ss)) counts.set(ss, (counts.get(ss) || 0) + 1);
    }
    const best = [...counts].sort((a, b) => b[1] - a[1])[0];
    if (best) openSubsystem(best[0], true);
  }
  S.sel = null;
  map.marks = REG.markedRxns;
  applyFrame();
  renderDetails();
}

async function regTestTf(tfName) {
  const entry = REG.result?.tfs.find((x) => x.tf === tfName);
  if (!entry) return;
  // Map concordantly downregulated metabolic target genes to canonical model gene refs
  const symToRef = new Map();
  for (const g of S.model.genes) {
    const ref = g[1] || g[0];
    if (g[1]) symToRef.set(g[1].toLowerCase(), ref);
    if (g[0] && !symToRef.has(g[0].toLowerCase())) symToRef.set(g[0].toLowerCase(), ref);
  }
  const downs = entry.metGenes
    .filter((mg) => mg.log2fc <= -0.35 && symToRef.has(mg.gene.toLowerCase()))
    .sort((a, b) => a.log2fc - b.log2fc)
    .slice(0, 8);
  if (!downs.length) return;
  $("regDialog").close();
  if (S.stale || !S.result) { await run(); if (S.stale || !S.result) return; }
  let baseId = S.compare;
  if (!baseId) {
    let nm = t("mtb.baseline");
    if (S.scenarios.some((x) => x.name === nm)) {
      let k = 2; while (S.scenarios.some((x) => x.name === `${nm} ${k}`)) k++;
      nm = `${nm} ${k}`;
    }
    const sc = compare.save(nm);
    if (sc) baseId = sc.id;
  }
  for (const mg of downs) {
    const ref = symToRef.get(mg.gene.toLowerCase());
    // Convert mRNA fold change into fractional activity cap (full KO if <= -2 log2FC)
    const a = mg.log2fc <= -2 ? 0 : Math.max(0.05, Math.min(0.5, Number(Math.pow(2, mg.log2fc).toFixed(2))));
    const ex = S.perturb.find((p) => p.type === "gene" && p.ref === ref);
    if (ex) ex.a = Math.min(ex.a, a); else S.perturb.push({ type: "gene", ref, a });
  }
  renderPerturb(); renderMeasured();
  await run();
  if (baseId) compare.setCompare(baseId);
  REG.markedTf = entry.tf;
  REG.markedRxns = entry.metRxns;
  $("regMarkTxt").textContent = t("reg.marked", { tf: entry.tf, n: entry.metRxns.size });
  $("regBar").hidden = false;
  map.marks = REG.markedRxns;
  setTask("cmp");
  applyFrame();
  renderDetails();
}

function regRender() {
  const res = REG.result;
  if (!res) return;
  const fmtq = (q) => (q < 1e-4 ? q.toExponential(1) : q.toFixed(3));
  const sig = res.tfs.filter((x) => x.qRna < 0.05).length;
  const top = res.tfs.slice(0, 14);
  const symSet = new Set(S.model.genes.flatMap((g) => [g[0]?.toLowerCase(), g[1]?.toLowerCase()]).filter(Boolean));

  const tfHtml = top.map((x) => {
    const up = x.combinedScore >= 0;
    const arrow = `<span class="reg-dir ${up ? "up" : "down"}">${up ? "↑" : "↓"}</span>`;
    const sample = x.metGenes.slice(0, 4).map((g) => `${esc(g.gene)}(${g.log2fc > 0 ? "+" : ""}${g.log2fc.toFixed(1)})`).join(", ");
    const chainTxt = res.hasMet && x.concordant.length
      ? ` · <b>${t("reg.chains", { n: x.concordant.length })}</b>` : "";
    const hasDown = x.metGenes.some((g) => g.log2fc <= -0.35 && symSet.has(g.gene.toLowerCase()));
    return `<div class="mtb-step">${arrow}<b>${esc(x.tf)}</b>`
      + ` <span class="val">t = ${x.zRna > 0 ? "+" : ""}${x.zRna.toFixed(2)}</span>`
      + ` <span class="q">q ${fmtq(x.qRna)}</span>`
      + `<span class="meta">${t("reg.tfMeta", { obs: x.nObsRna, tot: x.nTotalRna, met: x.metGenes.length, rxns: x.metRxns.size })}${chainTxt}`
      + (sample ? `<br>${t("reg.topMet")}: ${sample}` : "") + `</span>`
      + `<div class="mtb-step-acts">`
      + (x.metRxns.size ? `<button type="button" class="link" data-regmark="${esc(x.tf)}">${t("reg.markMap")}</button>` : "")
      + (hasDown ? `<button type="button" class="link" data-regtest="${esc(x.tf)}">${t("reg.testKd")}</button>` : "")
      + `</div></div>`;
  }).join("");

  const mechHtml = res.hasMet && res.classifiedSteps.length
    ? `<details class="scr-group" open><summary>${t("reg.mechTitle")} (${res.classifiedSteps.length})</summary><div class="scr-list">`
      + res.classifiedSteps.slice(0, 8).map((s) => {
          const tagCls = s.mechanism === "transcriptional" ? "tx" : s.mechanism === "postTranscriptional" ? "ptx" : "";
          const tagKey = s.mechanism === "transcriptional" ? "reg.mechTx" : s.mechanism === "postTranscriptional" ? "reg.mechPtx" : "reg.mechUnk";
          const gTxt = s.rnaGenes.slice(0, 3).map((g) => `${esc(g.gene)} (${g.log2fc > 0 ? "+" : ""}${g.log2fc.toFixed(2)})`).join(", ");
          const tfList = [...new Set(s.rnaGenes.flatMap((g) => g.tfs.map((u) => u.tf)))].slice(0, 4).join(", ");
          return `<div class="mtb-step"><span class="linkish" data-regrxn="${s.rxn}">${esc(s.name)}</span>`
            + `<span class="reg-tag ${tagCls}">${t(tagKey)}</span>`
            + `<span class="meta">${gTxt || t("reg.noRnaGene")}${tfList ? ` · TFs: ${esc(tfList)}` : ""}</span></div>`;
        }).join("") + `</div></details>`
    : "";

  $("regOut").innerHTML =
    `<div class="note">${t("reg.summary", { g: res.nRnaGenes, n: res.tfs.length, sig })} `
    + `${res.hasMet ? t("reg.linkedMet", { rxns: res.nObservableRxns }) : t("reg.rnaOnlyNote")}</div>`
    + (top.length
      ? `<details class="scr-group" open><summary>${t("reg.topTfs")} (${sig})</summary><div class="scr-list">${tfHtml}</div></details>`
      : `<p class="hint">${t("reg.noTfs")}</p>`)
    + mechHtml;

  $("regOut").querySelectorAll("[data-regmark]").forEach((b) => { b.onclick = () => regMarkTf(b.dataset.regmark); });
  $("regOut").querySelectorAll("[data-regtest]").forEach((b) => { b.onclick = () => regTestTf(b.dataset.regtest); });
  $("regOut").querySelectorAll("[data-regrxn]").forEach((el) => {
    el.onclick = () => {
      const j = +el.dataset.regrxn;
      $("regDialog").close();
      openSubsystem(S.model.rxns[j].ss, true);
      S.sel = { type: "rxn", rxn: j };
      const ni = map.findNode(1, j);
      if (ni >= 0) map.focusNode(ni);
      renderDetails();
    };
  });
  $("regNote").textContent = t("reg.loaded", { n: res.tfs.length, sig });
}

// ---------------------------------------------------------- exometabolomics ----
// Concentrations measured in the spent medium -> exchange fluxes (js/core/exodata.js), and the fit of
// those rates to the network (js/core/fitexchange.js). Everything runs in this browser.

const EXO = { groups: null, rates: null, unit: null, index: null, baseToMet: null, baseById: null, manual: null };

function openExoDialog() {
  EXO.groups = null; EXO.rates = null; EXO.index = null; EXO.baseToMet = null; EXO.baseById = null; EXO.manual = null;
  $("exoFile").value = ""; $("exoText").value = "";
  $("exoOut").hidden = true; $("exoStatus").textContent = ""; $("exoFit").textContent = "";
  $("exoGdw").value = CELL_MASS_PG;
  $("exoCond").textContent = "";
  $("exoDialog").showModal();
}

/**
 * What the user mapped by hand, per model, remembered so that the same table does not have to be mapped
 * twice. Stored by the metabolite's own identifier (MAM…), not by its index, so it survives a rebuild of the
 * model files or an edit of the network.
 */
function loadMetMap(slug) {
  try {
    const o = JSON.parse(localStorage.getItem("metflux.metmap." + slug) || "{}");
    return new Map(Object.entries(o));
  } catch { return new Map(); }
}
function saveMetMap(slug, map) {
  try { localStorage.setItem("metflux.metmap." + slug, JSON.stringify(Object.fromEntries(map))); } catch { /* storage unavailable */ }
}

/**
 * A metabolite of the medium from the label in the user's table. In order: what the user mapped by hand,
 * then an identifier, the model's own name, one of the model's abbreviations, and the same compound written
 * by another convention (js/core/metnames.js). A hand mapping wins, so that a wrong automatic match can be
 * corrected as well as a missing one.
 * @returns { met, via } — via tells the interface how it was resolved; met is undefined when nothing did
 */
function exoResolve(label) {
  if (!EXO.index) {
    EXO.index = buildMetIndex(S.model, [...S.sim.exchanges.keys()]);
    EXO.baseToMet = new Map();
    for (const [met] of S.sim.exchanges) { const b = S.model.mets[met].b; if (!EXO.baseToMet.has(b)) EXO.baseToMet.set(b, met); }
    EXO.manual = loadMetMap(S.slug);
    EXO.baseById = new Map(S.model.bases.map((b, i) => [b.id, i]));
  }
  const key = String(label).trim().toLowerCase();
  const byHand = EXO.manual.get(key);
  if (byHand !== undefined) {
    if (byHand === "") return { met: undefined, via: "ignored" }; // the user said: leave this one out
    const b = EXO.baseById.get(byHand);
    if (b !== undefined && EXO.baseToMet.has(b)) return { met: EXO.baseToMet.get(b), via: "manual" };
  }
  const { base, via } = resolveMetabolite(label, EXO.index);
  return { met: base === undefined ? undefined : EXO.baseToMet.get(base), via };
}

/** Candidates offered for a label nothing resolved, best first (js/core/metnames.js). */
function exoSuggest(label) {
  return suggestMetabolites(label, EXO.index, 10).filter((c) => EXO.baseToMet.has(c.base));
}

function exoParse() {
  const text = $("exoText").value.trim();
  if (!text) { $("exoStatus").textContent = t("exo.errEmpty"); return; }
  const gdw = Math.max(0, +$("exoGdw").value || CELL_MASS_PG) * 1e-12;
  const parsed = parseExoTable(text, { gdwPerCell: gdw });
  if (parsed.errors.length) { $("exoOut").hidden = true; $("exoStatus").innerHTML = `<span class="err">${parsed.errors.map(esc).join("<br>")}</span>`; return; }
  EXO.groups = groupForRates(parsed);
  EXO.unit = parsed.biomassUnit;
  const conds = [...new Set(EXO.groups.map((g) => g.condition))];
  const sel = $("exoCond"), keep = sel.value;
  sel.textContent = "";
  for (const c of conds) sel.add(new Option(c, c));
  sel.value = conds.includes(keep) ? keep : conds[0];
  $("exoStatus").innerHTML = parsed.warnings.length
    ? `<details><summary>${t("exo.nWarn", { n: parsed.warnings.length })}</summary>${parsed.warnings.map(esc).join("<br>")}</details>` : "";
  exoRender();
}

function exoRender() {
  const cond = $("exoCond").value;
  const groups = EXO.groups.filter((g) => g.condition === cond);
  const rows = groups.map((g) => {
    const r = ratesFromReplicates(g);
    const hit = exoResolve(g.metabolite);
    return { ...r, name: g.metabolite, met: hit.met, via: hit.via };
  }).filter((r) => Number.isFinite(r.rate)).sort((a, b) => a.rate - b.rate);
  EXO.rates = rows;
  const FLAG = { twoPoints: "exo.flag.twoPoints", noBlank: "exo.flag.noBlank", depleted: "exo.flag.depleted",
    blankDominates: "exo.flag.blankDominates", noDecayFit: "exo.flag.noDecayFit", badReplicate: "exo.flag.badReplicate" };
  $("exoRates").innerHTML = rows.length ? rows.map((r) => {
    const flags = r.flags.filter((f) => FLAG[f]);
    const title = flags.map((f) => t(FLAG[f])).join("\n");
    const via = r.met === undefined ? "" :
      `<span class="via${r.via === "rule" || r.via === "manual" ? " weak" : ""}" title="${esc(t("exo.via." + r.via))}">${esc(t("exo.viaShort." + r.via))}</span>`;
    return `<div class="exo-row${r.met === undefined ? " unmapped" : ""}"><span title="${esc(r.met === undefined ? t("exo.unmapped") : S.model.bases[S.model.mets[r.met].b].n)}">${esc(r.name)}${r.met === undefined ? " ?" : ""}${via}</span>`
      + `<span class="val">${fmtFlux(r.rate)}${r.sd > 0 ? ` ± ${fmtFlux(r.sd)}` : ""}</span>`
      + `<span class="val meta">n=${r.n}</span>`
      + `<span class="flags" title="${esc(title)}">${flags.length ? "⚠" : ""}</span></div>`;
  }).join("") : `<p class="hint">${t("exo.noRates")}</p>`;
  // growth rate from the biomass series of this condition, if it is there
  const g0 = groups[0];
  if (g0) {
    const mus = g0.replicates.map((r) => growthRate(r.times, r.biomass).mu).filter(Number.isFinite);
    if (mus.length && !$("exoMu").value) {
      const mu = mus.reduce((a, b) => a + b, 0) / mus.length;
      $("exoMu").value = mu.toPrecision(3);
      $("exoMuSd").value = mus.length > 1 ? (Math.sqrt(mus.reduce((a, x) => a + (x - mu) ** 2, 0) / (mus.length - 1))).toPrecision(2) : "";
    }
  }
  const mapped = rows.filter((r) => r.met !== undefined).length;
  $("exoOut").hidden = false;
  $("exoApply").disabled = $("exoCheck").disabled = !mapped;
  $("exoRates").insertAdjacentHTML("afterbegin", `<p class="hint">${t("exo.mapped", { n: mapped, total: rows.length, unit: EXO.unit })}</p>`);
  exoRenderUnmapped(rows.filter((r) => r.met === undefined));
}

/**
 * The labels nothing resolved. They are not dropped silently: each one is listed with the closest
 * metabolites of the medium and their similarity, so the user decides. Choices are remembered per model.
 */
function exoRenderUnmapped(rows) {
  const box = $("exoUnmappedBox"), out = $("exoUnmapped");
  box.hidden = !rows.length;
  if (!rows.length) { out.textContent = ""; return; }
  const ignored = rows.filter((r) => r.via === "ignored").length;
  $("exoUnmappedH").textContent = t("exo.unmappedH", { n: rows.length, ignored });
  out.innerHTML = rows.map((r) => {
    const sug = exoSuggest(r.name);
    const opts = [`<option value="">${esc(t("exo.pick"))}</option>`]
      .concat(sug.map((c) => `<option value="${esc(S.model.bases[c.base].id)}">${esc(c.name)} · ${Math.round(100 * c.score)} %</option>`))
      .concat([`<option value="__skip">${esc(t("exo.skip"))}</option>`]);
    const note = sug.length ? "" : `<span class="absent">${esc(t("exo.noCandidate"))}</span>`;
    return `<div class="exo-map"><span class="lbl" title="${esc(r.name)}">${esc(r.name)}</span>`
      + (sug.length ? `<select data-map="${esc(r.name)}">${opts.join("")}</select>` : note)
      + `<span class="val meta">${fmtFlux(r.rate)}</span></div>`;
  }).join("");
  out.querySelectorAll("[data-map]").forEach((sel) => {
    sel.onchange = () => {
      const key = sel.dataset.map.trim().toLowerCase();
      if (!sel.value) EXO.manual.delete(key);
      else EXO.manual.set(key, sel.value === "__skip" ? "" : sel.value);
      saveMetMap(S.slug, EXO.manual);
      exoRender();
    };
  });
}

/** The rates of the chosen condition become the measured exchange fluxes. */
function exoApply() {
  const rows = (EXO.rates || []).filter((r) => r.met !== undefined);
  if (!rows.length) return;
  S.measured = { set: "user", tol: S.measured.tol ?? DEFAULT_TOL, ngam: S.measured.ngam, trace: S.measured.trace,
    items: rows.map((r) => ({ met: r.met, rate: +r.rate.toPrecision(4) })), edited: false,
    userName: $("exoCond").value };
  renderMeasured(); renderSupplies(); renderObjective(); renderSecondary(); renderContext();
  $("exoDialog").close();
  changed();
}

/** The consistency fit: are these rates compatible with the network, and with the observed growth? */
async function exoCheck() {
  const out = $("exoFit");
  const rows = (EXO.rates || []).filter((r) => r.met !== undefined);
  if (!rows.length) return;
  const mu = +$("exoMu").value, muSd = +$("exoMuSd").value;
  const obj = S.model.rxns[S.cfg.objective];
  if (!isGrowthRxn(obj)) { out.innerHTML = `<div class="note">${t("exo.needGrowth")}</div>`; return; }
  out.innerHTML = `<p class="hint">${t("exo.fitBusy")}</p>`;
  const measurements = rows.map((r) => ({ rxn: S.sim.exchanges.get(r.met).rxn, dir: S.sim.exchanges.get(r.met).dir,
    met: r.met, rate: r.rate, sigma: r.sd > 0 ? r.sd : Math.max(1e-4, Math.abs(r.rate) * 0.1) }));
  if (mu > 0) measurements.push({ rxn: S.cfg.objective, dir: 1, met: -1, rate: mu, sigma: muSd > 0 ? muSd : Math.abs(mu) * 0.1 });
  // bounds: the medium and the cell type, then the measured exchanges freed and unmeasured secretion capped
  const lb0 = S.model.rxns.map((r) => r.lb), ub0 = S.model.rxns.map((r) => r.ub);
  // the cell type closes those reactions, except in "only make them costlier" mode, where it acts on the
  // parsimonious stage and not on the bounds (sim.js _solve does the same)
  if (S.context.mode !== "penalty") for (const j of S.ctxBlock || []) { lb0[j] = 0; ub0[j] = 0; }
  const { lb, ub } = fitBounds(S.model, S.sim.exchanges, lb0, ub0, {
    measuredMets: new Set(rows.map((r) => r.met)),
    presentMets: new Set(S.supplies.filter((it) => it.unlimited || it.conc > 0).map((it) => it.met)),
    openRxns: [S.cfg.objective],
  });
  let res;
  try { res = await S.sim.fitExchanges({ lb, ub, measurements }); }
  catch (err) { out.innerHTML = `<div class="note err">${esc(err.message)}</div>`; return; }
  if (res.status !== "optimal") { out.innerHTML = `<div class="note err">${t("exo.fitFailed", { status: esc(res.status) })}</div>`; return; }
  const bal = exchangeBalance(S.model, S.sim.exchanges, res.v);
  const name = (m) => (m === -1 ? t("exo.growth") : S.model.bases[S.model.mets[m].b].n);
  const off = res.residuals.filter((r) => Math.abs(r.residual) > 1e-6);
  const fitted = mu > 0 ? res.v[S.cfg.objective] : null;
  out.innerHTML = `<div class="note">${t("exo.fitSummary", { n: measurements.length, dev: res.deviation.toPrecision(3), off: off.length })}`
    + (fitted !== null ? "<br>" + t("exo.fitGrowth", { fit: fmtFlux(fitted), obs: fmtFlux(mu) }) : "") + "</div>"
    + (off.length ? `<details class="scr-group" open><summary>${t("exo.residuals")} (${off.length})</summary><div class="scr-list">`
        + off.map((r) => `<div class="exo-row"><span>${esc(name(r.met))}</span><span class="val">${fmtFlux(r.observed)} → ${fmtFlux(r.fitted)}</span>`
          + `<span class="val meta">${Math.round(100 * r.share)} %</span><span></span></div>`).join("") + "</div></details>"
      : `<p class="hint good">${t("exo.allFit")}</p>`)
    + `<div class="note">${t("exo.balance", { rq: Number.isFinite(bal.rq) ? bal.rq.toFixed(2) : "—", c: Number.isFinite(bal.closure.C) ? Math.round(100 * bal.closure.C) : "—" })}</div>`
    + bal.warnings.map((w) => `<p class="hint bad">⚠ ${esc(w)}</p>`).join("");
}

function openFocus(center) {
  if (!(S.view?.kind === "focus" && S.view.center.type === center.type && S.view.center.ref === center.ref)) navPush();
  S.view = { kind: "focus", ss: -1, center: { ...center } };
  $("listView").hidden = true;
  map.setScene(focusScene(center));
  S.sel = center.type === "met" ? { type: "met", met: center.ref } : { type: "rxn", rxn: center.ref };
  renderCrumbs(); applyFrame();
  map.selected = map.findNode(center.type === "met" ? 0 : 1, center.ref);
  renderDetails();
}

/** Right-click menu on a map node. */
function openCtxMenu(node, x, y) {
  const menu = $("ctxMenu"), { model } = S, items = [];
  let head = "";
  if (node.type === 0) {
    const m = node.ref, ppMet = S.supplies.find((it) => model.mets[it.met].b === model.mets[m].b && S.sim.exchanges.has(it.met))?.met;
    head = S.index.metName(m);
    items.push(["cm.focus", () => openFocus({ type: "met", ref: m })]);
    if (node.ghost !== true && S.view.kind !== "sub") items.push(["cm.openMet", () => gotoMet(m)]);
    items.push(["cm.details", () => { S.sel = { type: "met", met: m }; applyGhosts(); renderDetails(); }]);
    items.push(["cm.label", () => addSupply(m, true)]);
    if (ppMet !== undefined) items.push(["cm.phase", () => { S.sel = { type: "met", met: m }; renderDetails(); phasePlane(ppMet); }]);
    items.push(["cm.copy", () => navigator.clipboard?.writeText(model.mets[m].id)]);
  } else if (node.type === 1) {
    const j = node.ref;
    head = model.rxns[j].n;
    items.push(["cm.focus", () => openFocus({ type: "rxn", ref: j })]);
    if (node.ghost || S.view.kind !== "sub" || S.view.ss !== model.rxns[j].ss) items.push(["cm.openRxn", () => goToPathwayOf(j)]);
    items.push(["cm.details", () => { S.sel = { type: "rxn", rxn: j }; renderDetails(); }]);
    items.push(["cm.fva", () => { S.sel = { type: "rxn", rxn: j }; renderDetails(); fluxRange(j); }]);
    items.push(["cm.ko", () => addPerturb("rxn", j)]);
    items.push(["cm.objective", () => { S.cfg.objective = j; renderObjective(); renderSecondary(); changed(); }]);
    items.push(["cm.copy", () => navigator.clipboard?.writeText(model.rxns[j].id)]);
  } else {
    head = node.label;
    items.push(["cm.open", () => onMapOpen(node)]);
    if (!map.scene.cell) items.push(["cm.flex", () => { openSubsystem(node.ref); computeFlex(node.ref); }]);
  }
  menu.innerHTML = `<div class="cm-head">${esc(head)}</div>` + items.map(([k], i) => `<button type="button" role="menuitem" data-i="${i}">${t(k)}</button>`).join("");
  menu.hidden = false;
  const w = menu.offsetWidth, h = menu.offsetHeight;
  menu.style.left = Math.min(x, innerWidth - w - 8) + "px"; menu.style.top = Math.min(y, innerHeight - h - 8) + "px";
  menu.onclick = (ev) => {
    const b = ev.target.closest("[data-i]"); if (!b) return;
    const [k, fn] = items[+b.dataset.i];
    menu.hidden = true; fn();
    if (isMobile() && /^cm\.(details|fva|phase)$/.test(k)) showSheet("right");
  };
  menu.querySelector("button")?.focus();
}

function gotoReaction(j) {
  S.sel = { type: "rxn", rxn: j };
  let i = map.findNode(1, j);
  if (i >= 0 && map.scene.nodes[i].ghost) i = -1;
  if (i < 0) {
    openSubsystem(S.model.rxns[j].ss, true);
    i = map.findNode(1, j);
  }
  if (i >= 0) map.focusNode(i);
  renderDetails();
}

function bestSubsystemForMet(m) {
  const f = frame(), score = new Map();
  const { index, model } = S;
  for (let p = index.rxnStart[m]; p < index.rxnStart[m + 1]; p++) {
    const j = index.rxnList[p], ss = model.rxns[j].ss;
    if (!drawable(ss) || !S.layout.subs[ss].m.includes(m)) continue;
    score.set(ss, (score.get(ss) || 0) + 1e-6 + (f ? Math.abs(f.v[j] * index.rxnCoef[p]) : 0));
  }
  let best = -1, bs = 0;
  for (const [ss, sc] of score) if (sc > bs) { bs = sc; best = ss; }
  return best;
}

/** Show a gene: its panel, and the map of the pathway where its reactions carry most flux. */
function gotoGene(sym) {
  S.sel = { type: "gene", sym };
  const f = frame(), rx = S.search.geneRxns.get(sym) || [];
  let best = -1, bs = -1;
  for (const j of rx) {
    if (!drawable(S.model.rxns[j].ss) || !S.layout.subs[S.model.rxns[j].ss].r.includes(j)) continue;
    const sc = f ? Math.abs(f.v[j]) : 0;
    if (sc > bs) { bs = sc; best = j; }
  }
  if (best >= 0) {
    let i = map.findNode(1, best);
    if (i < 0) { openSubsystem(S.model.rxns[best].ss, true); i = map.findNode(1, best); }
    if (i >= 0) map.focusNode(i);
  }
  renderDetails();
}

function gotoMet(m) {
  S.sel = { type: "met", met: m };
  if (map.scene.ghostBase) { map.setScene(map.scene.ghostBase, true); applyFrame(); }
  let i = map.findNode(0, m);
  if (i < 0) {
    const ss = bestSubsystemForMet(m);
    if (ss >= 0) { openSubsystem(ss, true); i = map.findNode(0, m); }
  }
  if (i >= 0) map.focusNode(i);
  applyGhosts();
  if (i >= 0) map.focusNode(map.findNode(0, m));
  renderDetails();
}

function gotoBase(b) {
  const f = frame(), turnover = f ? frameTurnover(f) : null;
  const mets = S.index.metsOfBase[b];
  let best = mets[0], bs = -1;
  for (const m of mets) {
    const sc = (turnover ? turnover[m] : 0) + (S.model.mets[m].c === "c" ? 1e-9 : 0) + (bestSubsystemForMet(m) >= 0 ? 1e-12 : 0);
    if (sc > bs) { bs = sc; best = m; }
  }
  gotoMet(best);
}

function onSearchPick(it) {
  if (it.type === "sub") openSubsystem(it.ref);
  else if (it.type === "rxn") gotoReaction(it.ref);
  else if (it.type === "met") gotoBase(it.ref);
  else if (it.type === "gene") gotoGene(it.ref);
  if (isMobile()) { $("search").blur(); if (it.type === "sub") hideSheet(); else showSheet("right"); }
}

function onMapSelect(node) {
  if (node?.ghost) { goToPathwayOf(node.ref); return; } // a reaction of another pathway: go there
  // adaptive view: a click on a metabolite or reaction re-arranges the map around it
  if (S.adaptive && node && node.type < 2 && !(S.view.kind === "focus" && S.view.center.type === (node.type ? "rxn" : "met") && S.view.center.ref === node.ref)) { openFocus({ type: node.type ? "rxn" : "met", ref: node.ref }); return; }
  if (!node) S.sel = S.view.kind === "sub" ? { type: "sub", ss: S.view.ss } : null;
  else if (node.type === 0) S.sel = { type: "met", met: node.ref };
  else if (node.type === 1) S.sel = { type: "rxn", rxn: node.ref };
  else S.sel = map.scene.cell ? { type: "grp", g: node.ref } : { type: "sub", ss: node.ref };
  applyGhosts();
  renderDetails();
  if (isMobile()) { if (node) showSheet("right"); else hideSheet(); }
}

function onMapOpen(node) {
  if (node.type !== 2) return;
  if (map.scene.cell) openGroup(node.ref); else openSubsystem(node.ref);
}

function onMapHover(node, x, y) {
  const tip = $("tooltip");
  if (!node) { tip.hidden = true; return; }
  const f = frame();
  let html = `<b>${esc(node.type === 0 ? S.index.metName(node.ref) : node.type === 1 ? S.model.rxns[node.ref].n : node.label)}</b>`;
  if (node.type === 0) {
    html += `<span>${t("tip.turnover", { x: fmtFlux(node.flux) })}</span>`;
    if (f?.metE) html += `<span>${t("tip.label", { x: (100 * node.e).toFixed(1) })}${node.unc ? t("tip.uncertain") : ""}</span>`;
    if (f?.ref?.scen && (f.metE || f.ref.metE)) html += `<span>${t("tip.labelScen", { name: esc(f.ref.scen.name), x: (100 * (f.ref.metE ? f.ref.metE[node.ref] : 0)).toFixed(1) })}</span>`;
  } else if (node.type === 1) {
    const dg = S.flowData.dG[node.ref];
    if (S.quantity === "dg") html += `<span>${Number.isFinite(dg) ? t("tip.dg", { x: (dg > 0 ? "+" : "") + dg.toFixed(1), sd: S.flowData.dGsd[node.ref].toFixed(1) }) : t("dg.none")}</span>`;
    if (f?.ref) { // comparing: both conditions, whatever the map shows
      const nm = cmpNames(f), a = f.ref.v[node.ref], b = f.v[node.ref], c = fluxChange(a, b);
      html += `<span>${S.model.rxns[node.ref].id} · ${t("tip.ab", { a: esc(nm.a), x: fmtFlux(a), b: esc(nm.b), y: fmtFlux(b) })}${["rev", "on", "off"].includes(c.kind) ? `<br><b${c.kind === "rev" ? ` style="color:${revColor()}"` : ""}>${t("tip.ch." + c.kind)}</b>` : ""}${node.pert !== undefined ? t("tip.activity", { x: Math.round(100 * node.pert) }) : ""}</span>`;
    } else html += `<span>${S.model.rxns[node.ref].id} · ${t("tip.flux", { x: fmtFlux(f ? f.v[node.ref] : 0) })}${node.pert !== undefined ? t("tip.activity", { x: Math.round(100 * node.pert) }) : ""}</span>`;
  } else {
    const en = f && S.quantity === "dg" ? frameFlows(f).energy : null;
    if (en) html += `<span>${t("tip.dgGroup", { d: fmtFlux(en.diss[node.ref]), u: fmtFlux(en.up[node.ref]), c: Math.round(100 * en.cover[node.ref]) })}</span>`;
    html += `<span>${map.scene.cell ? esc(locName(node.loc)) + "<br>" : ""}${t("tip.group", { n: node.size, x: fmtFlux(en ? frameGroupFlux(f, node.ref) : node.flux) })}${f?.metE ? t("tip.label", { x: (100 * node.e).toFixed(1) }) : ""}<br>${t("tip.open")}</span>`;
  }
  tip.innerHTML = html; tip.hidden = false;
  tip.style.left = Math.min(window.innerWidth - 330, x + 14) + "px"; tip.style.top = y + 14 + "px";
}

/** Total absolute reaction flux of a group (node.flux holds the dissipation in the energy view). */
function frameGroupFlux(f, g) {
  const G = groups(); let s = 0;
  for (let j = 0; j < f.v.length; j++) if (G.groupOf[j] === g) s += Math.abs(f.v[j]);
  return s;
}

// ------------------------------------------------------------- simulation ----
const frame = () => (S.result ? S.result.frames[Math.min(S.frameIdx, S.result.frames.length - 1)] : null);
const frameTurnover = (f) => f.turnover || (f.turnover = S.index.turnover(f.v));

// ------------------------------------------------- comparison: A, B, A → B ----
// With a reference (a compared scenario, or the unperturbed run behind a perturbation) the map can show
// condition A (the reference), B (what is on screen) or the change A → B. The right panel always describes B.
/** View in force for a frame: "a", "b" or "ab" ("b" when there is nothing to compare with). */
const cmpView = (f) => (f?.ref ? S.cmpView : "b");
/** Condition A as a frame of its own, so the map can draw it like any result. */
function aFrame(f) {
  if (f.aFrame) return f.aFrame;
  const r = f.ref, rf = r.frame;
  return (f.aFrame = { t: r.t ?? f.t, v: r.v, metE: r.metE || null, status: r.status || "optimal", objective: r.objective,
    inputs: rf?.inputs || f.inputs, elements: rf?.elements || f.elements, isA: true });
}
const refTurnover = (f) => f.refTurn || (f.refTurn = S.index.turnover(f.ref.v));
/** Names of the two conditions, for the selector, the legend and the tooltip. */
function cmpNames(f) {
  if (f?.ref?.scen) return { a: f.ref.scen.name, b: compare.shownName() };
  return { a: t("cmpv.refAuto"), b: t("cmpv.pert") };
}
function setCmpView(v) {
  if (!frame()?.ref || S.cmpView === v) return;
  S.cmpView = v;
  applyFrame();
}
function renderCmpViews(f) {
  const box = $("cmpViews"), on = !!f?.ref;
  box.hidden = !on;
  if (!on) return;
  const nm = cmpNames(f), v = S.cmpView;
  const lab = { a: `<b>A</b> <span>${esc(nm.a)}</span>`, b: `<b>B</b> <span>${esc(nm.b)}</span>`, ab: `<b>A → B</b>` };
  const tip = { a: t("cmpv.aTitle", { name: nm.a }), b: t("cmpv.bTitle", { name: nm.b }), ab: t("cmpv.abTitle", { a: nm.a, b: nm.b }) };
  box.querySelectorAll("button").forEach((b) => {
    const k = b.dataset.v;
    b.innerHTML = lab[k]; b.title = tip[k];
    b.setAttribute("aria-checked", String(k === v)); b.classList.toggle("on", k === v);
  });
}

/** Weights of the current quantity for a frame: { w per metabolite, skipBase, lineLabel }. */
function quantitySpec(f, kind = S.quantity) {
  const D = S.flowData, el = ATOM_Q[kind];
  if (el) {
    const share = f.carrier || (f.carrier = carrierShare(S.sim.tracer, f.v, f.inputs || [], D.carriers));
    const w = (f.wAtoms ||= {})[el] || (f.wAtoms[el] = transferableAtoms(S.sim.tracer, share, el));
    return { w, skipBase: D.excl[el], lineLabel: !!f.metE && !!f.elements?.has(el) };
  }
  return { w: D.cof[kind] || (D.cof[kind] = cofactorWeights(S.model, kind)), skipBase: D.noSkip, lineLabel: false };
}

function frameFlows(f, kind = S.quantity, G = groups()) {
  const cache = f.flowsBy || (f.flowsBy = {}), key = G.key + ":" + kind;
  if (cache[key]) return cache[key];
  if (kind === "dg") { // no lines: groups sized by the free energy they dissipate
    const D = S.flowData, base = S.index.groupFlows(f.v, f.metE, G, f.ref?.v, { w: D.zeroW || (D.zeroW = new Float32Array(S.model.mets.length)), skipBase: D.noSkip });
    const en = groupEnergy(S.model, f.v, S.flowData.dG, G);
    return (cache[key] = { ...base, gFlux: en.diss, flows: [], energy: en });
  }
  return (cache[key] = S.index.groupFlows(f.v, f.metE, G, f.ref?.v, quantitySpec(f, kind)));
}

/** The filter actually in force for a frame (the chosen one may not be available). */
const canDlabel = (f) => !!(f?.ref?.scen && (f.metE || f.ref.metE));
function activeFilter(f) {
  if (S.filter === "label" && f?.metE) return "label";
  if ((S.filter === "delta" || S.filter === "rev") && f?.ref) return S.filter;
  if (S.filter === "dlabel" && canDlabel(f)) return "dlabel";
  return "all";
}

/** Metabolites whose label differs from the compared scenario, and the active reactions that touch them. */
function dlabelMask(f, thr = 0.01) {
  const { mets, rxns } = S.model, A = f.ref.metE, B = f.metE;
  const met = new Uint8Array(mets.length), rxn = new Uint8Array(rxns.length);
  for (let m = 0; m < mets.length; m++) if (Math.abs((B ? B[m] : 0) - (A ? A[m] : 0)) > thr && !S.index.currency[mets[m].b]) met[m] = 1;
  rxns.forEach((r, j) => { if ((f.v[j] || f.ref.v[j]) && r.m.some((m) => met[m])) rxn[j] = 1; });
  return { rxn, met };
}

function frameMask(f, kind) {
  const cache = f.masks || (f.masks = {});
  return cache[kind] || (cache[kind] = kind === "label" ? S.index.labelMask(f.v, f.metE) : kind === "dlabel" ? dlabelMask(f) : kind === "rev" ? revMask(f) : S.index.deltaMask(f.v, f.ref.v));
}

/** Reactions that run the other way in B than in A, and the metabolites they touch. */
function revMask(f) {
  const { mets, rxns } = S.model, met = new Uint8Array(mets.length), rxn = new Uint8Array(rxns.length);
  rxns.forEach((r, j) => {
    if (fluxChange(f.ref.v[j], f.v[j]).kind !== "rev") return;
    rxn[j] = 1;
    for (const m of r.m) met[m] = 1;
  });
  return { rxn, met };
}

/** Residual activity of every perturbed reaction (genes go through their GPR rule). */
function perturbActivities() {
  const out = new Map(), levels = new Map();
  for (const p of S.perturb) if (p.type === "gene") levels.set(p.ref, Math.min(levels.get(p.ref) ?? 1, p.a));
  const touched = new Set();
  for (const sym of levels.keys()) for (const j of S.search.geneRxns.get(sym) || []) touched.add(j);
  for (const j of touched) { const a = gprActivity(S.model.rxns[j].g, levels); if (a < 1) out.set(j, a); }
  for (const p of S.perturb) if (p.type === "rxn" && p.a < 1) out.set(p.ref, Math.min(out.get(p.ref) ?? 1, p.a));
  return out;
}

/** Status line, bottom right. kind: "busy" (amber, a calculation is running), "done" (green, result ready) or none. */
/**
 * Progress bar next to the status: null hides it, true = working without a known end (moving bar),
 * a number 0..1 = share done. Hidden again whenever the status stops being "busy".
 */
function setProgress(x) {
  const p = $("progress"), bar = p.firstElementChild;
  if (x === null || x === undefined || x === false) { p.hidden = true; return; }
  p.hidden = false;
  const indet = x === true;
  p.classList.toggle("indet", indet);
  if (!indet) { const pc = Math.round(100 * Math.min(1, Math.max(0, x))); bar.style.width = pc + "%"; p.setAttribute("aria-valuenow", pc); p.title = pc + " %"; }
  else { bar.style.width = ""; p.removeAttribute("aria-valuenow"); p.title = ""; }
}

function setStatus(fn, err = false, kind = null) {
  S.statusFn = fn; S.statusErr = err; S.statusKind = kind;
  if (kind !== "busy") setProgress(null);
  const s = $("status"); s.textContent = fn(); s.classList.toggle("err", err);
  s.classList.toggle("busy", kind === "busy" && !err); s.classList.toggle("done", kind === "done" && !err);
}

/** Simulate button: "Simulating…" while a run is in progress. */
function setRunning(on) {
  const b = $("runBtn");
  b.disabled = on; b.classList.toggle("running", on);
  b.textContent = t(on ? "h.running" : "h.run");
}

const statusWhy = (st) => { const k = "st." + st, s = t(k); return s === k ? st : s; };

const SUPERSEDED = new Error("superseded");
async function run() {
  const seq = ++S.runSeq;
  clearTimeout(autoTimer);
  const btn = $("runBtn");
  setRunning(true); btn.classList.remove("pending");
  stopPlay();
  const t0 = performance.now();
  const pert = perturbActivities();
  const cfg = { ...S.cfg, perturb: [...pert], measured: { items: S.measured.items.map((x) => ({ met: x.met, rate: x.rate })), tol: S.measured.tol, ngam: S.measured.ngam, trace: S.measured.trace },
    context: S.ctxBlock ? { id: S.context.id, mode: S.context.mode, block: S.ctxBlock } : undefined };
  const mode = S.mode;
  try {
    const dyn = { hours: +$("dynHours").value || 24, biomass: +$("dynBiomass").value || 0.5, pool: (+$("dynPool").value || 0.5) / 1000, frames: 30, events: mode === "dynamic" ? resolveEvents() : [] };
    const evList = mode === "dynamic" ? S.events.map((ev) => ({ ...ev })) : [];
    let res;
    if (mode === "steady") {
      setStatus(() => t("status.fba"), false, "busy"); setProgress(true);
      res = await S.sim.runSteady(cfg, S.supplies, S.structures, (phase) => { if (seq === S.runSeq) setStatus(() => t(phase === "ref" ? "status.ref" : "status.fba"), false, "busy"); });
    } else {
      setStatus(() => t("status.dyn", { p: 0, t: fmtTime(0) }), false, "busy");
      res = await S.sim.runDynamic(cfg, S.supplies, S.structures, dyn, (p, fr, frames, phase) => {
        if (seq !== S.runSeq) throw SUPERSEDED; // a newer run started: stop computing this one
        const pc = Math.round(100 * p); setProgress(p);
        if (phase === "ref") { setStatus(() => t("status.dynRef", { p: pc }), false, "busy"); return; }
        setStatus(() => t("status.dyn", { p: pc, t: fmtTime(fr.t) }), false, "busy");
        // show frames as they are computed
        S.result = { frames, pert, evList }; S.frameIdx = frames.length - 1;
        compare.attach();
        setupTimeline(); applyFrame();
        if (!S.sel) renderDetails();
      });
    }
    if (seq !== S.runSeq) return;
    res.pert = pert; res.dyn = dyn; res.evList = evList;
    S.result = res; S.stale = false;
    compare.attach();
    S.frameIdx = res.frames.length - 1;
    const last = res.frames[res.frames.length - 1];
    const secs = ((performance.now() - t0) / 1000).toFixed(1);
    if (last.status !== "optimal") setStatus(() => t("status.nosol", { why: statusWhy(last.status) }), true);
    else setStatus(() => t("status.done", { mode: mode === "steady" ? t("status.steady") : t("status.dynamic", { n: res.solves }), s: secs }) + (last.converged === false ? t("status.notconv") : "") + (res.frames.some((f) => f.relaxed) ? t("status.relaxed") : ""), false, "done");
    setupTimeline();
    applyFrame(); applyGhosts(true); renderDetails();
    if (mode === "dynamic" && res.frames.length > 1) { S.frameIdx = 0; $("timeSlider").value = 0; applyFrame(); startPlay(); }
  } catch (err) {
    if (err === SUPERSEDED) return;
    if (seq === S.runSeq) setStatus(() => t("status.error", { msg: err.message }), true);
    console.error(err);
  } finally {
    if (seq === S.runSeq) setRunning(false);
  }
}

let autoTimer = null;
function changed() {
  S.stale = true;
  if (S.shown) { S.shown = null; compare.render(); } // what is on screen is no longer that scenario
  if (S.model) measuredFlags();
  refreshCascade();
  clearTimeout(autoTimer);
  if (S.auto[S.mode]) autoTimer = setTimeout(run, S.mode === "steady" ? 700 : 1500);
  else { setStatus(() => t("status.changed")); $("runBtn").classList.add("pending"); }
}

/** Automatic re-run after each change, remembered separately for the two modes. */
function renderAuto() {
  const on = !!S.auto[S.mode], b = $("autoBtn");
  b.classList.toggle("on", on); b.setAttribute("aria-checked", String(on));
}
function toggleAuto() {
  S.auto[S.mode] = !S.auto[S.mode];
  try { localStorage.setItem("metflux.auto", JSON.stringify(S.auto)); } catch { /* ignore */ }
  renderAuto();
  if (S.auto[S.mode] && S.stale) run();
}

// ------------------------------------------------------------------ theme ----
function setTheme(name, redraw = true) {
  if (name === "light") document.documentElement.dataset.theme = "light"; else delete document.documentElement.dataset.theme;
  setMapTheme(name);
  applyLook(loadLook()); // surfaces depend on the theme; the map scales are re-applied on top of it
  const b = $("themeBtn");
  b.setAttribute("aria-checked", String(name !== "light")); // the switch reads "dark mode: on"
  try { localStorage.setItem("metflux.theme", name); } catch { /* ignore */ }
  if (!redraw || !S.model) return;
  S.scenes = {}; // the cell backdrop carries its compartment colours
  if (S.view.kind === "global") map.setScene(globalScene(), true);
  applyFrame(); renderDetails();
}

function applyFrame() {
  const f = frame();
  // the filter options follow what the current result can answer
  const fs = $("filterSel");
  fs.querySelector('[value="label"]').disabled = !f?.metE;
  fs.querySelector('[value="delta"]').disabled = !f?.ref;
  fs.querySelector('[value="rev"]').disabled = !f?.ref;
  fs.querySelector('[value="dlabel"]').disabled = !canDlabel(f);
  const filt = activeFilter(f);
  fs.value = filt;
  const view = cmpView(f), mf = view === "a" ? aFrame(f) : f; // mf: the frame drawn on the map
  renderCmpViews(f);
  const mode = filt === "dlabel" ? "dlabel" : view === "ab" ? "change" : mf?.metE ? "tracer" : "flux";
  const mask = filt === "all" ? null : frameMask(f, filt);
  if (S.view.kind === "sub" || S.view.kind === "focus") {
    const pertA = f?.ref?.scen ? f.ref.scen.result.pert : null; // what A itself had knocked out (nothing for the unperturbed reference)
    map.setData(f ? { v: mf.v, turnover: frameTurnover(mf), metE: mf.metE, uncertain: view === "a" ? null : f.uncertain, mode, mask, ref: f.ref?.v, refE: f.ref?.metE, refTurnover: view === "ab" ? refTurnover(f) : null, perturb: view === "a" ? pertA : S.result.pert, dG: S.quantity === "dg" ? S.flowData.dG : null, blocked: S.ctxBlock ? (S.ctxBlockSet ??= new Set(S.ctxBlock)) : null, qflux: view === "ab" ? null : cofactorRxnFlux(mf, S.quantity), flex: view !== "a" && S.flex && S.flex.result === S.result && S.flex.frameIdx === S.frameIdx ? S.flex.map : null, mtb: mtbMapData("sub") } : {});
  } else if (S.view.kind === "global") {
    let gHas = null;
    if (mask) {
      const G = groups();
      gHas = new Uint8Array(G.n);
      for (let j = 0; j < mask.rxn.length; j++) if (mask.rxn[j] && G.groupOf[j] >= 0) gHas[G.groupOf[j]] = 1;
    }
    let fl = f ? frameFlows(mf) : null;
    if (f && mode === "dlabel") { // group colour: change of the flux-weighted label against the compared scenario
      const G = groups(), cache = f.flowsBy, k = "ref:" + G.key;
      const D = S.flowData, refFl = cache[k] || (cache[k] = S.index.groupFlows(f.ref.v, f.ref.metE || new Float32Array(S.model.mets.length), G, null, { w: D.zeroW || (D.zeroW = new Float32Array(S.model.mets.length)), skipBase: D.noSkip }));
      fl = { ...fl, gD: Float32Array.from(fl.gE, (e, g) => Math.max(-1, Math.min(1, 3 * ((f.metE ? e : 0) - refFl.gE[g])))) };
    }
    map.setData(f ? { ...fl, mode, gHas, minE: filt === "label" ? 0.005 : 0, energy: fl.energy ? fl.energy.g : null, mtbGlobal: mtbMapData("global") } : {});
  } else renderListView(mask);
  $("emptyNote").hidden = !(mask && S.view.kind !== "list" && map.visibleCount() === 0);
  renderLegend(mode, view);
  if (S.result && S.result.frames.length > 1 && f) $("timeLabel").textContent = fmtTime(f.t);
}

function setupTimeline() {
  const n = S.result ? S.result.frames.length : 0;
  $("timeline").hidden = n <= 1;
  const sl = $("timeSlider");
  sl.max = Math.max(0, n - 1); sl.value = S.frameIdx;
}
function startPlay() {
  stopPlay();
  $("playBtn").textContent = "❚❚";
  S.playing = setInterval(() => {
    if (S.frameIdx >= S.result.frames.length - 1) { stopPlay(); return; }
    S.frameIdx++; $("timeSlider").value = S.frameIdx; applyFrame(); renderDetails();
  }, 420);
}
function stopPlay() { if (S.playing) clearInterval(S.playing); S.playing = null; $("playBtn").textContent = "▶"; }

/** Legend of the A → B view: one line per visual channel, each with its own sample. */
function changeLegend(sub) {
  const nm = cmpNames(frame()), ramp = [-1, -0.33, 0, 0.33, 1].map((x) => deltaColor(x));
  const sw = (svg, txt) => `<div class="chl"><svg width="34" height="14" aria-hidden="true">${svg}</svg><span>${txt}</span></div>`;
  const line = (col, w, dash = "") => `<line x1="2" y1="7" x2="32" y2="7" stroke="${col}" stroke-width="${w}" stroke-linecap="${dash ? "butt" : "round"}"${dash ? ` stroke-dasharray="${dash}"` : ""}/>`;
  const sq = (fill, stroke = "none") => `<rect x="12" y="2" width="10" height="10" transform="rotate(45 17 7)" fill="${fill}" stroke="${stroke}" stroke-width="1.6"/>`;
  let h = `<div class="chhead">${t("legend.chTitle", { a: esc(nm.a), b: esc(nm.b) })}</div>`;
  h += `<div class="chsec"><b>${t("legend.chColour")}</b> ${t("legend.chColourHint")}</div>`;
  h += `<div class="ramp" style="background:linear-gradient(90deg,${ramp.join(",")})"></div><div class="scale"><span>÷8</span><span>÷2</span><span>${t("legend.same")}</span><span>×2</span><span>×8</span></div>`;
  if (!sub) return h + `<div class="chsec">${t("legend.chGlobal")}</div>`;
  h += `<div class="chsec"><b>${t("legend.chWidth")}</b> ${t("legend.chWidthHint")}</div>`;
  h += sw(`<line x1="2" y1="7" x2="12" y2="7" stroke="${deltaColor(0.5)}" stroke-width="1.5" stroke-linecap="round"/><line x1="19" y1="7" x2="31" y2="7" stroke="${deltaColor(0.5)}" stroke-width="5.5" stroke-linecap="round"/>`, t("legend.chWidthSample"));
  h += `<div class="chsec"><b>${t("legend.chMarks")}</b></div>`;
  h += sw(line(deltaColor(0.2), 3, "6 3.5") + `<circle cx="17" cy="7" r="5.2" fill="none" stroke="${revColor()}" stroke-width="1.8"/>`, `<b style="color:${revColor()}">⇄</b> ${t("legend.chRev")}`);
  h += sw(sq(deltaColor(1)) + `<circle cx="17" cy="7" r="6.3" fill="none" stroke="${deltaColor(1)}" stroke-width="1.5"/>`, t("legend.chOn", { b: esc(nm.b) }));
  h += sw(sq("var(--panel)", deltaColor(-1)), t("legend.chOff", { a: esc(nm.a) }));
  h += sw(line(deltaColor(0), 1), t("legend.chSame"));
  h += `<div class="chnote">${t("legend.chEps", { eps: FLUX_EPS })}</div>`;
  return h;
}

function renderLegend(mode, view = "b") {
  const sub = S.view.kind === "sub" || S.view.kind === "focus";
  const comps = sub ? [...new Set(map.scene.nodes.filter((n) => n.type === 0).map((n) => n.comp))] : [];
  const ramp = (colors, labels) => `<div class="ramp" style="background:linear-gradient(90deg,${colors.join(",")})"></div><div class="scale">${labels.map((l) => `<span>${l}</span>`).join("")}</div>`;
  const q = S.quantity, energy = q === "dg";
  let h = `<div><b style="color:var(--text)">${t(sub ? "legend.rxnflux" : "legend.q." + q)}</b>${t(!sub && energy ? "legend.dgScale" : "legend.scale")}</div>`;
  if (!sub && !energy) h += `<div>${t("legend.unit." + q)}</div>`;
  if (energy) {
    h += `<div style="margin-top:6px">${t(sub ? "legend.dgSub" : "legend.dgGlobal")}</div>${ramp([-1, -0.4, 0, 0.5, 1].map((x) => energyColor(x)), sub ? ["+40", "0", "−40 kJ/mol"] : [t("legend.dgUp"), t("legend.dgDown")])}`;
    h += `<div><i style="display:inline-block;width:9px;height:9px;border-radius:2px;background:${energyColor(NaN)};margin-right:4px"></i>${t("legend.dgUnknown")}</div>`;
    if (!S.flowData.hasDG) h += `<div class="err">${t("legend.dgMissing")}</div>`;
  } else if (sub && (COFACTOR_Q[q] || q === "redox")) h += `<div>${t("legend.qSubCof", { q: esc(t("qty." + q)) })}</div>`;
  else if (sub && q !== "carbon") h += `<div>${t("legend.qSubOnly")}</div>`;
  if (mode === "tracer" && !energy) h += `<div style="margin-top:6px">${t("legend.enrich")}</div>${ramp([0, 0.05, 0.2, 0.5, 1].map((x) => enrichColor(x)), ["0 %", "5", "20", "50", "100 %"])}<div>${t("legend.uncertain")}</div>`;
  if (mode === "dlabel" && !energy) h += `<div style="margin-top:6px">${t("legend.dlabel", { name: esc(frame()?.ref?.scen?.name || ""), cur: esc(compare.shownName()) })}</div>${ramp([-1, -0.3, 0, 0.3, 1].map((x) => deltaColor(x)), [t("legend.lessLabel"), t("legend.same"), t("legend.moreLabel")])}`;
  if (mode === "change" && !energy) h += `<div class="chleg">${changeLegend(sub)}</div>`;
  if (MTB.overlay && MTB.result) {
    h += `<div style="margin-top:6px"><b style="color:var(--text)">${t("mtb.legendTitle")}</b></div>`
      + ramp([-1, -0.5, 0, 0.5, 1].map((x) => deltaColor(x)), ["÷4 (−2)", "÷2", "0", "×2", "×4 (+2)"])
      + `<div class="chl"><svg width="16" height="12" aria-hidden="true"><circle cx="8" cy="6" r="4.5" fill="var(--panel2)" stroke="var(--muted)" stroke-width="1.2" stroke-dasharray="2.5 2"/></svg><span>${t("mtb.legendUnmeas")}</span></div>`
      + (sub ? `<div class="chl"><svg width="16" height="12" aria-hidden="true"><rect x="4.5" y="2.5" width="7" height="7" transform="rotate(45 8 6)" fill="var(--panel)" stroke="var(--muted)" stroke-width="1.2" stroke-dasharray="2.2 1.8"/></svg><span>${t("mtb.legendUnobs")}</span></div>` : "")
      + `<div class="chl"><svg width="16" height="12" aria-hidden="true"><circle cx="8" cy="6" r="4.8" fill="none" stroke="var(--hot)" stroke-width="2"/></svg><span>${t("mtb.legendTop")}</span></div>`;
  }
  if (view === "a") h += `<div class="chnote">${t("legend.viewA", { a: esc(cmpNames(frame()).a), b: esc(cmpNames(frame()).b) })}</div>`;
  if (sub && S.result?.pert?.size) h += `<div>${t("legend.pert")}</div>`;
  if (sub && map.scene.ghostBase) h += `<div style="margin-top:4px">${t("legend.ghost")}</div>`;
  if (S.view.kind === "focus") h += `<div style="margin-top:4px">${t("legend.focus")}</div>`;
  if (sub && S.flex && S.flex.result === S.result && S.view.ss === S.flex.ss) h += `<div style="margin-top:4px">${t("flex.legend", { frac: Math.round(S.flex.frac * 100) })}<br>${["fixed", "required", "optional", "loop"].map((c) => `<span class="fx-dot fx-${c}"></span>${t("flex.c." + c)}`).join(" ")}</div>`;
  if (sub && S.ctxBlock?.length) h += `<div><svg width="26" height="10" style="vertical-align:middle;margin-right:4px"><line x1="1" y1="5" x2="25" y2="5" stroke="var(--muted)" stroke-width="1.5" stroke-dasharray="4 3"/></svg>${t(S.context.mode === "penalty" ? "legend.ctxPenal" : "legend.ctxBlocked", { ctx: esc(currentContext()?.name || "") })}</div>`;
  if (comps.length) h += `<div class="comps">${comps.map((c) => `<span><i style="border-color:${compColor(c)}"></i>${esc(compName(c))}</span>`).join("")}</div>`;
  h += `<div style="margin-top:4px">${sub ? t("legend.subHint") : t("legend.globalHint") + (map.scene.cell ? "<br>" + t("legend.cellHint") : "")}</div>`;
  if (map.scene.guides) h += `<div>${t(sub ? "legend.cascadeSub" : "legend.cascadeHint")}</div>`;
  $("legend").innerHTML = h;
}

// ------------------------------------------------------------------ media ----
// Built-in media have plain ids ("plasmax"); media saved by the user are "user:<name>" and live in localStorage.
const USER = "user:";
function userMedia() {
  try { const o = JSON.parse(localStorage.getItem("metflux.media") || "{}"); return o && typeof o === "object" && !Array.isArray(o) ? o : {}; } catch { return {}; }
}
const mediumExists = (id) => (id.startsWith(USER) ? Array.isArray(userMedia()[id.slice(USER.length)]) : MEDIA.some((m) => m.id === id));
// Medium and measured set are remembered per model. A model with its own defaults in data/models.json (the
// organisms other than human and mouse) starts from them; human and mouse also read the older key they shared.
const modelDefaults = () => S.models?.find((m) => m.slug === S.slug)?.defaults || {};
const isMicrobe = () => modelDefaults().kind === "microbe";
function storedPref(k) {
  try { return localStorage.getItem(`metflux.${k}.${S.slug}`) ?? (modelDefaults()[k] ? null : localStorage.getItem("metflux." + k)); } catch { return null; }
}
function savePref(k, v) { try { localStorage.setItem(`metflux.${k}.${S.slug}`, v); } catch { /* ignore */ } }
function storedMediumId() {
  const id = storedPref("medium");
  return id && mediumExists(id) ? id : modelDefaults().medium || "default";
}
const mediumName = (id) => (id.startsWith(USER) ? id.slice(USER.length) : t("medium.name." + id));

/** Replace the medium, keeping the isotope labels of metabolites present in both. */
function loadMedium(id, rerun = true) {
  if (!mediumExists(id)) id = "default";
  const items = id.startsWith(USER) ? importMedium(S.model, userMedia()[id.slice(USER.length)]) : presetMedium(S.model, id);
  const old = new Map(S.supplies.map((it) => [it.met, it]));
  S.supplies = items.map((it) => { const o = old.get(it.met); return { ...it, label: o?.label ?? null, fraction: o?.fraction ?? 1 }; });
  S.mediumId = id;
  savePref("medium", id);
  renderMediumSel(); renderSupplies();
  if (rerun) changed();
}

function renderMediumSel() {
  const sel = $("mediumSel");
  sel.textContent = "";
  const group = (label, ids) => {
    if (!ids.length) return;
    const g = document.createElement("optgroup"); g.label = label;
    for (const id of ids) g.appendChild(new Option(mediumName(id), id));
    sel.appendChild(g);
  };
  group(t("medium.builtin"), MEDIA.filter((m) => (m.org ? m.org === S.slug : !isMicrobe())).map((m) => m.id)); // each organism its own media
  group(t("medium.saved"), Object.keys(userMedia()).sort((a, b) => a.localeCompare(b)).map((n) => USER + n));
  sel.value = S.mediumId;
  const mine = S.mediumId.startsWith(USER);
  $("deleteMedium").hidden = !mine;
  $("mediumNote").innerHTML = t(mine ? "medium.note.user" : "medium.note." + S.mediumId);
  renderEvents(); // medium-change events list the same media
}

function saveMedium() {
  const mine = S.mediumId.startsWith(USER);
  const asked = prompt(t("medium.savePrompt"), mine ? mediumName(S.mediumId) : t("medium.copyOf", { name: mediumName(S.mediumId) }));
  const name = (asked || "").trim().slice(0, 60);
  if (!name) return;
  const all = userMedia();
  if (name in all && USER + name !== S.mediumId && !confirm(t("medium.overwrite", { name }))) return;
  all[name] = exportMedium(S.model, S.supplies);
  try { localStorage.setItem("metflux.media", JSON.stringify(all)); } catch { alert(t("medium.storageError")); return; }
  for (const it of S.supplies) it.conc0 = it.conc;
  S.mediumId = USER + name;
  savePref("medium", S.mediumId);
  renderMediumSel(); renderSupplies();
}

function deleteMedium() {
  if (!S.mediumId.startsWith(USER)) return;
  const name = S.mediumId.slice(USER.length);
  if (!confirm(t("medium.deleteConfirm", { name }))) return;
  const all = userMedia();
  delete all[name];
  try { localStorage.setItem("metflux.media", JSON.stringify(all)); } catch { /* ignore */ }
  loadMedium("default");
}

// ------------------------------------------------------- collapsible panel ----
function bindFolds() {
  let folded = [];
  try { folded = JSON.parse(localStorage.getItem("metflux.folded") || "[]"); } catch { /* storage unavailable */ }
  if (!Array.isArray(folded)) folded = [];
  document.querySelectorAll("section.fold").forEach((sec) => {
    const h = sec.querySelector("h2");
    const set = (on) => { sec.classList.toggle("folded", on); h.setAttribute("aria-expanded", String(!on)); };
    const toggle = () => {
      set(!sec.classList.contains("folded"));
      const ids = [...document.querySelectorAll("section.fold.folded")].map((x) => x.id);
      try { localStorage.setItem("metflux.folded", JSON.stringify(ids)); } catch { /* ignore */ }
    };
    h.tabIndex = 0; h.setAttribute("role", "button"); h.dataset.i18nTitle = "h.fold";
    set(folded.includes(sec.id));
    h.addEventListener("click", (ev) => { if (!ev.target.closest("button")) toggle(); });
    h.addEventListener("keydown", (ev) => { if (ev.target === h && (ev.key === "Enter" || ev.key === " ")) { ev.preventDefault(); toggle(); } });
  });
}

// ------------------------------------------------------- cell-type context ----
// Genes not detected in a cell line, cell type or tissue are switched off (js/core/contexts.js).
const ctxLabels = {
  group: (c) => t("ctx.group." + c.group),
  badge: (c) => t("ctx.badge." + c.group),
  badgeClass: (c) => ctxBadgeClass(c.group),
  sub: (c) => {
    const i = c.info || {};
    if (c.id === "nci60") return t("ctx.nci60Sub", { n: (i.lines || []).length });
    if (c.group === "user") return [t("ctx.src.user"), i.file].filter(Boolean).join(" · ");
    return [i.genotype || i.disease || (c.group === "lineOther" ? i.category : ""), i.site, t("ctx.src." + c.src)].filter(Boolean).join(" · ");
  },
};
const currentContext = () => (S.context.id && S.ctxData ? S.ctxData.byId.get(S.context.id) || null : null);

function storedContext(slug) {
  try {
    const o = JSON.parse(localStorage.getItem("metflux.context." + slug) || "null");
    if (o && (o.id === null || S.ctxData?.byId.has(o.id))) return { id: o.id, mode: (["block", "complex", "penalty"].includes(o.mode) ? o.mode : "complex") };
  } catch { /* storage unavailable */ }
  return { id: null, mode: "complex" };
}

/** Reactions with no detected enzyme in the current context, on the current (possibly edited) model. */
function computeContextBlock() {
  const ctx = currentContext();
  S.ctxBlock = ctx && S.model ? blockedReactions(S.model, offGenes(ctx, S.base.model.genes), { complexes: S.context.mode === "complex" }) : null;
  S.ctxBlockSet = null;
}

function setContext(id, mode = "complex", rerun = true) {
  S.context = { id: id && S.ctxData?.byId.has(id) ? id : null, mode: (["block", "complex", "penalty"].includes(mode) ? mode : "complex") };
  try { localStorage.setItem("metflux.context." + S.slug, JSON.stringify(S.context)); } catch { /* ignore */ }
  computeContextBlock();
  if (rerun) { renderContext(); renderDetails(); changed(); }
}

/** Collapsible table, in the knockout section, of the genes and reactions the cell type switches off. */
function renderCtxExplore() {
  const det = $("ctxExplore"), ctx = currentContext();
  det.hidden = !ctx || !S.ctxBlock;
  if (det.hidden) { det.open = false; return; }
  const off = offGenes(ctx, S.base.model.genes);
  det.querySelector("summary").textContent = t("ctt.summary", { off: off.size, rx: S.ctxBlock.length, ctx: ctx.name });
  if (!det.open) { $("ctxExploreBox").textContent = ""; return; }
  renderCtxTable($("ctxExploreBox"), S.model, off, S.ctxBlock, { name: ctx.name, onRxn: (j) => gotoReaction(j), onGene: (sym) => { S.sel = { type: "gene", sym }; renderDetails(); } });
}

function renderContext() {
  renderCtxExplore();
  const sec = $("secContext");
  sec.hidden = !S.ctxData;
  if (!S.ctxData) return;
  $("ctxBrowse").href = `contexts.html?model=${encodeURIComponent(S.slug)}`;
  const ctx = currentContext();
  $("ctxMode").value = S.context.mode;
  $("clearContext").hidden = !ctx;
  const cur = $("ctxCurrent"), note = $("ctxNote");
  if (!ctx) {
    cur.innerHTML = `<div class="chip ctx-chip none">${esc(t("ctx.none"))}</div>`;
    note.innerHTML = t("ctx.noneNote", { lang: docsLang() });
    return;
  }
  const i = ctx.info || {}, genes = S.base.model.genes;
  const extra = [];
  if (i.cellosaurus) extra.push(`<a href="https://www.cellosaurus.org/${encodeURIComponent(i.cellosaurus)}" target="_blank" rel="noopener">Cellosaurus ${esc(i.cellosaurus)}</a>`);
  if (i.entity) extra.push(`<a href="https://www.bgee.org/search/anat-entities?search=${encodeURIComponent(i.entity)}" target="_blank" rel="noopener">${esc(i.entity)}</a>`);
  if (i.category && ctx.group !== "lineCancer" && ctx.group !== "lineOther") extra.push(esc(i.category));
  if (i.note) extra.push(esc(i.note));
  if (ctx.group === "user") extra.push(t("rna.chipInfo", { file: esc(i.file), matched: i.matched, total: S.base.model.genes.length, thr: i.thr }) + ` <button class="link" id="rnaDelete">${t("rna.delete")}</button>`);
  cur.innerHTML = `<div class="chip ctx-chip"><span class="badge b-${ctxBadgeClass(ctx.group)}">${esc(t("ctx.badge." + ctx.group))}</span> <b>${esc(ctx.name)}</b>
    <div class="sub">${esc(ctxLabels.sub(ctx))}${extra.length ? "<br>" + extra.join(" · ") : ""}</div></div>`;
  const off = offGenes(ctx, genes);
  const parts = [t("ctx.summary", { off: off.size, n: genes.length, rx: S.ctxBlock ? S.ctxBlock.length : 0 })];
  if (ctx.rescued.length) {
    const byTask = new Map();
    for (const [g, ti] of ctx.rescued) { const task = taskName(S.ctxData, ti); if (!byTask.has(task)) byTask.set(task, []); byTask.get(task).push(genes[g][1]); }
    parts.push(`<details class="ctx-rescued"><summary>${t("ctx.rescued", { n: ctx.rescued.length })}</summary><ul>${[...byTask].map(([task, gs]) => `<li><b>${esc(gs.join(", "))}</b> ← ${esc(task)}</li>`).join("")}</ul></details>`);
  }
  if (ctx.failed.length) parts.push(`<span class="err">${t("ctx.failed", { list: esc(ctx.failed.map((x) => taskName(S.ctxData, x)).join("; ")) })}</span>`);
  if (i.problematic) parts.push(`<span class="warn">${esc(i.problematic)}</span>`);
  if (ctx.pairs.length && !ctx.pairs.includes(S.measured.set)) parts.push(t("ctx.pair", { sets: ctx.pairs.map((p) => `<button class="link" data-pair="${p}">${esc(t("meas.name." + p))}</button>`).join(", ") }));
  else if (!ctx.pairs.includes(S.measured.set) && S.measured.set !== "none") parts.push(`<span class="warn">${t("ctx.measOther", { set: esc(t("meas.name." + S.measured.set)) })}</span>`);
  if (S.context.mode === "penalty" && !S.cfg.parsimonious) parts.push(`<span class="warn">${t("ctx.penaltyNoPfba")}</span>`);
  parts.push(`<span class="ctx-src">${t("ctx.license." + (S.slug === "human-gem" ? "hpa" : ctx.src === "genotype" ? "genotype" : "bgee"), { lang: docsLang() })}</span>`);
  note.innerHTML = parts.join("<br>");
  $("rnaDelete")?.addEventListener("click", () => { if (confirm(t("rna.deleteConfirm", { name: ctx.name }))) { deleteUserContext(ctx.id); setContext(null, S.context.mode); } });
  note.querySelectorAll("[data-pair]").forEach((b) => { b.onclick = () => { loadMeasured(b.dataset.pair); renderObjective(); renderSecondary(); renderContext(); }; });
}
const ctxBadgeClass = (g) => ({ user: "sub", lineCancer: "cancer", lineOther: "gene", cellType: "met", tissue: "rxn", consensus: "sub" }[g] || "sub");

// ------------------------------------------------- cell type from the user's RNA-seq ----
// The table is parsed in the page, matched to the model genes, and the context is built in a worker with the same
// metabolic-task rescue as the catalogue (js/core/ctxbuild.js). Nothing leaves the browser; the result is kept in
// localStorage (metflux.userctx.<slug>) and inside exported sessions.
const userCtxKey = (slug) => "metflux.userctx." + slug;
function storedUserContexts(slug) {
  try { const a = JSON.parse(localStorage.getItem(userCtxKey(slug)) || "[]"); return Array.isArray(a) ? a : []; } catch { return []; }
}
function addUserContext(c, store = true) {
  const D = S.ctxData;
  if (!D.byId.has(c.id)) { D.contexts.unshift(c); D.byId.set(c.id, c); }
  if (store) {
    const all = storedUserContexts(S.slug).filter((x) => x.id !== c.id); all.unshift(c);
    try { localStorage.setItem(userCtxKey(S.slug), JSON.stringify(all)); } catch { setStatus(() => t("rna.storageFull"), true); }
  }
  S.ctxIndex = new ContextIndex(D, ctxLabels);
}
function deleteUserContext(id) {
  const D = S.ctxData;
  D.contexts = D.contexts.filter((c) => c.id !== id); D.byId.delete(id);
  try { localStorage.setItem(userCtxKey(S.slug), JSON.stringify(storedUserContexts(S.slug).filter((c) => c.id !== id))); } catch { /* ignore */ }
  S.ctxIndex = new ContextIndex(D, ctxLabels);
}
function mergeUserContexts(slug) {
  for (const c of storedUserContexts(slug).reverse()) addUserContext(c, false);
  S.ctxIndex = new ContextIndex(S.ctxData, ctxLabels);
}

const RNA = { table: null, file: "" };
function openRnaDialog() {
  RNA.table = null; $("rnaFile").value = ""; $("rnaParsed").hidden = true; $("rnaBuild").disabled = true; $("rnaStatus").textContent = "";
  $("rnaDialog").showModal();
}

/** Parse a delimited text table: delimiter, header, identifier and numeric columns are detected. */
function parseExpressionTable(text) {
  const lines = text.replace(/^\uFEFF/, "").split(/\r?\n/).filter((l) => l.trim() && !l.startsWith("#"));
  if (lines.length < 2) throw new Error(t("rna.errEmpty"));
  const first = lines[0];
  const delim = ["\t", ",", ";"].map((d) => [d, first.split(d).length]).sort((a, b) => b[1] - a[1])[0][0];
  const split = (l) => l.split(delim).map((x) => x.trim().replace(/^"(.*)"$/, "$1"));
  const rows = lines.map(split);
  const num = (x) => x !== "" && Number.isFinite(+x);
  const nCol = Math.max(...rows.slice(0, 50).map((r) => r.length));
  const header = rows[0].some((x, k) => !num(x) && rows.slice(1, 20).some((r) => num(r[k])));
  const body = header ? rows.slice(1) : rows;
  const names = Array.from({ length: nCol }, (_, k) => (header && rows[0][k]) || t("rna.column", { n: k + 1 }));
  const numeric = names.map((_, k) => body.slice(0, 500).filter((r) => num(r[k])).length >= 0.8 * Math.min(500, body.length));
  return { names, body, numeric };
}

/** Model gene (symbol used in the GPR rules) for an identifier: Ensembl gene ID (version stripped) or symbol. */
function geneMatcher() {
  const m = new Map();
  for (const g of S.base.model.genes) { m.set(g[1].toUpperCase(), g[1]); if (g[0]) m.set(String(g[0]).toUpperCase().replace(/\.\d+$/, ""), g[1]); }
  return (id) => m.get(String(id).toUpperCase().replace(/^(ENS[A-Z]*G\d+)\.\d+$/, "$1"));
}

function readRnaText(text, name = "expression.tsv") {
  $("rnaStatus").textContent = "";
  try {
    const tbl = parseExpressionTable(text);
    RNA.table = tbl; RNA.file = name;
    const match = geneMatcher();
    const hits = tbl.names.map((_, k) => tbl.body.slice(0, 2000).filter((r) => match(r[k] ?? "")).length);
    const idCol = hits.indexOf(Math.max(...hits));
    const fill = (sel, opts, val) => { sel.textContent = ""; for (const [v, l] of opts) sel.add(new Option(l, v)); sel.value = val; };
    fill($("rnaIdCol"), tbl.names.map((n, k) => [k, n]), idCol);
    const numCols = tbl.names.map((n, k) => [k, n]).filter(([k]) => tbl.numeric[k] && k !== idCol);
    if (!numCols.length) throw new Error(t("rna.errNoValues"));
    fill($("rnaValCol"), [...numCols, ...(numCols.length > 1 ? [["mean", t("rna.meanCols", { n: numCols.length })]] : [])], numCols[0][0]);
    const looksLog = numCols.every(([k]) => tbl.body.slice(0, 2000).every((r) => !num0(r[k]) || +r[k] < 25));
    $("rnaLog").checked = looksLog;
    $("rnaName").value = name.replace(/\.[^.]+$/, "").slice(0, 60);
    $("rnaParsed").hidden = false;
    rnaPreview();
  } catch (err) { RNA.table = null; $("rnaParsed").hidden = true; $("rnaBuild").disabled = true; $("rnaStatus").innerHTML = `<span class="err">${esc(err.message)}</span>`; }
}
async function readRnaFile(file) {
  if (!file) return;
  readRnaText(await file.text(), file.name);
}
const num0 = (x) => x !== undefined && x !== "" && Number.isFinite(+x);

/** Expression per model gene from the chosen columns (several rows for a gene: the highest). */
function rnaLevels() {
  const tbl = RNA.table, idCol = +$("rnaIdCol").value, vc = $("rnaValCol").value, log = $("rnaLog").checked;
  const cols = vc === "mean" ? tbl.names.map((_, k) => k).filter((k) => tbl.numeric[k] && k !== idCol) : [+vc];
  const match = geneMatcher(), level = new Map();
  let rows = 0;
  for (const r of tbl.body) {
    const g = match(r[idCol] ?? "");
    const xs = cols.map((k) => +r[k]).filter(Number.isFinite);
    if (!g || !xs.length) continue;
    rows++;
    let x = xs.reduce((s, v) => s + v, 0) / xs.length;
    if (log) x = Math.pow(2, x) - 1;
    level.set(g, Math.max(level.get(g) ?? -Infinity, x));
  }
  return { level, rows };
}

function rnaPreview() {
  if (!RNA.table) return;
  const { level, rows } = rnaLevels(), thr = Math.max(0, +$("rnaThr").value || 0), n = S.base.model.genes.length;
  const off = [...level.values()].filter((x) => x < thr).length;
  const low = level.size < 0.5 * n;
  $("rnaInfo").innerHTML = t("rna.preview", { rows: RNA.table.body.length, used: rows, matched: level.size, n, pct: Math.round(100 * level.size / n), off, thr })
    + (low ? `<br><span class="warn">${t("rna.lowMatch")}</span>` : "");
  $("rnaBuild").disabled = !level.size;
}

let rnaWorker = null;
async function buildRnaContext() {
  const { level } = rnaLevels(), thr = Math.max(0, +$("rnaThr").value || 0);
  const name = $("rnaName").value.trim() || RNA.file;
  $("rnaBuild").disabled = true;
  $("rnaStatus").textContent = t("rna.loading");
  const tasksText = await fetch("data/tasks/metabolicTasks_Essential.txt").then((r) => r.text());
  rnaWorker?.terminate();
  rnaWorker = new Worker(new URL("./core/ctxbuild.worker.js", import.meta.url), { type: "module" });
  const t0 = performance.now();
  rnaWorker.onmessage = (ev) => {
    const m = ev.data;
    if (m.type === "progress") { // shown in the dialog and in the status bar, so the dialog can be closed meanwhile
      const msg = () => `${esc(name)}: ${t("rna.progress", { i: m.i + 1, n: m.n, s: Math.round((performance.now() - t0) / 1000) })}`;
      $("rnaStatus").textContent = msg(); setStatus(msg, false, "busy"); setProgress(m.i / m.n);
      return;
    }
    rnaWorker.terminate(); rnaWorker = null; setProgress(null);
    if (m.type === "error") { $("rnaStatus").innerHTML = `<span class="err">${esc(m.message)}</span>`; $("rnaBuild").disabled = false; setStatus(() => t("status.error", { msg: m.message }), true); return; }
    const genes = S.base.model.genes, gi = new Map(genes.map((g, i) => [g[1], i]));
    const b = new Uint8Array(Math.ceil(genes.length / 8));
    for (const g of m.off) { const i = gi.get(g); if (i !== undefined) b[i >> 3] |= 1 << (i & 7); }
    let bin = ""; for (const x of b) bin += String.fromCharCode(x);
    const c = { id: "user:" + Date.now().toString(36), name, group: "user", src: "user",
      info: { file: RNA.file, column: $("rnaValCol").selectedOptions[0]?.text || "", matched: level.size, thr, log: $("rnaLog").checked, created: new Date().toISOString() },
      off: btoa(bin), nOff0: m.nOff0, rescued: m.rescued.map(([g, task]) => [gi.get(g), task]).filter(([i]) => i !== undefined), nBlocked: m.nBlocked, failed: m.failed, pairs: [] };
    addUserContext(c);
    $("rnaDialog").close();
    setContext(c.id, S.context.mode);
  };
  rnaWorker.postMessage({ model: S.base.model, levels: [...level], thr, tasksText });
}

/** From the catalogue's comparator: B is simulated and saved as the reference scenario, then A becomes current. */
async function compareContexts(a, b) {
  const D = S.ctxData;
  if (!D.byId.has(a) || !D.byId.has(b)) { run(); return; }
  setContext(b, S.context.mode, false); renderContext();
  await run();
  const scB = compare.save(D.byId.get(b).name);
  setContext(a, S.context.mode, false); renderContext();
  await run();
  if (scB) { compare.setCompare(scB.id); setTask("cmp"); }
  renderDetails();
}

/** The context as written to the exports. */
function contextExport() {
  const ctx = currentContext();
  if (!ctx) return null;
  const genes = S.base.model.genes;
  return { id: ctx.id, name: ctx.name, group: ctx.group, source: ctx.src, info: ctx.info, mode: S.context.mode,
    genes_off: [...offGenes(ctx, genes)].sort(), genes_rescued: ctx.rescued.map(([g, ti]) => ({ gene: genes[g][1], task: taskName(S.ctxData, ti) })), tasks_failed: ctx.failed.map((x) => taskName(S.ctxData, x)),
    reactions_blocked: S.ctxBlock ? Array.from(S.ctxBlock, (j) => S.model.rxns[j].id) : [], license: S.ctxData.meta.license };
}

// ------------------------------------------------- measured exchange fluxes ----
function storedMeasuredId() {
  const id = storedPref("measured");
  return measuredSetsFor(S.slug, isMicrobe()).some((x) => x.id === id) ? id : modelDefaults().measured || "nci60";
}

function loadMeasured(id, rerun = true) {
  // a microbial set belongs to one cultivation: its medium (aerobic / anaerobic, carbon source) comes with it
  const setMedium = MEASURED_SETS.find((x) => x.id === id)?.medium;
  if (setMedium && setMedium !== S.mediumId && S.model && mediumExists(setMedium)) loadMedium(setMedium, false);
  S.measured = { set: id, tol: S.measured.tol ?? DEFAULT_TOL, items: measuredPreset(S.model, S.sim.exchanges, id), ngam: measuredNgam(id), trace: MEASURED_SETS.find((x) => x.id === id)?.trace, edited: false };
  savePref("measured", id);
  renderMeasured(); renderSupplies();
  if (rerun) changed();
}

const measuredOf = (met) => S.measured.items.find((x) => x.met === met);
const inMedium = (met) => S.supplies.some((it) => it.met === met && (it.unlimited || it.conc > 0));

function renderMeasured() {
  const sel = $("measuredSel");
  sel.textContent = "";
  for (const x of measuredSetsFor(S.slug, isMicrobe())) sel.add(new Option(t("meas.name." + x.id), x.id));
  // rates the user imported from their own spent medium (exo dialog): not a preset, listed while it is on
  if (S.measured.set === "user") sel.add(new Option(t("meas.name.user", { name: S.measured.userName ? " · " + S.measured.userName : "" }), "user"));
  sel.value = S.measured.set;
  $("measTol").value = Math.round(100 * S.measured.tol);
  $("measuredNote").innerHTML = t("meas.note." + S.measured.set, { lang: docsLang() }) + (S.measured.edited ? " " + t("meas.note.edited") : "") + (S.measured.items.length && S.perturb.length ? t("meas.perturbNote") : "");
  const list = $("measuredList");
  list.textContent = "";
  if (!S.measured.items.length && !S.measured.ngam) return;
  const head = document.createElement("div"); head.className = "meas-head";
  head.innerHTML = `<span>${t("meas.th.met")}</span><span>${t("meas.th.dir")}</span><span>${t("meas.th.rate")}</span><span></span>`;
  list.appendChild(head);
  const edited = () => { S.measured.edited = true; renderMeasured(); renderSupplies(); changed(); };
  // ATP maintenance: a fixed demand, not an exchange
  {
    const row = document.createElement("div"); row.className = "meas";
    const name = document.createElement("div"); name.className = "name"; name.textContent = t("meas.ngam"); name.title = t("meas.ngamTitle");
    const dir = document.createElement("div"); dir.className = "hint"; dir.style.margin = "0"; dir.textContent = t("meas.ngamDir");
    const val = document.createElement("input"); val.type = "number"; val.min = 0; val.step = "any"; val.value = S.measured.ngam; val.title = t("meas.ngamTitle");
    val.onchange = () => { S.measured.ngam = Math.max(0, +val.value || 0); edited(); };
    row.append(name, dir, val, document.createElement("span"));
    list.appendChild(row);
  }
  for (const x of S.measured.items) {
    const met = S.model.mets[x.met], base = S.model.bases[met.b];
    const off = x.rate > 0 && !inMedium(x.met);
    const row = document.createElement("div"); row.className = "meas" + (off ? " off" : ""); row.dataset.met = x.met;
    const name = document.createElement("div"); name.className = "name";
    name.innerHTML = `${esc(base.n)} <small>[${met.c}]</small>`;
    name.title = off ? t("meas.notInMedium") : base.n;
    name.onclick = () => gotoMet(x.met);
    const dir = document.createElement("select");
    dir.add(new Option(t("meas.uptake"), "up")); dir.add(new Option(t("meas.secretion"), "out"));
    dir.value = x.rate >= 0 ? "up" : "out";
    dir.onchange = () => { x.rate = (dir.value === "up" ? 1 : -1) * Math.abs(x.rate); edited(); };
    const val = document.createElement("input"); val.type = "number"; val.min = 0; val.step = "any"; val.value = Math.abs(x.rate); val.title = t("meas.rateTitle");
    val.onchange = () => { x.rate = (dir.value === "up" ? 1 : -1) * Math.max(0, +val.value || 0); edited(); };
    const rm = document.createElement("button"); rm.textContent = "✕"; rm.title = t("meas.removeTitle");
    rm.onclick = () => { S.measured.items = S.measured.items.filter((y) => y !== x); edited(); };
    row.append(name, dir, val, rm);
    list.appendChild(row);
  }
}

/** The medium decides whether a measured uptake can apply: refresh the strike-through without rebuilding the rows. */
function measuredFlags() {
  $("measuredList").querySelectorAll(".meas[data-met]").forEach((row) => {
    const x = measuredOf(+row.dataset.met), off = !!x && x.rate > 0 && !inMedium(x.met);
    row.classList.toggle("off", off);
    row.querySelector(".name").title = off ? t("meas.notInMedium") : S.model.bases[S.model.mets[+row.dataset.met].b].n;
  });
}

function addMeasured(base) {
  const met = S.index.metsOfBase[base].find((m) => S.sim.exchanges.has(m));
  if (met === undefined || measuredOf(met)) return;
  S.measured.items.push({ met, rate: 0.01 });
  S.measured.edited = true;
  renderMeasured(); renderSupplies(); changed();
}

// ------------------------------------------------------- scheduled events ----
// Dynamic mode only. { type: "add", t, met, conc, label, fraction } or { type: "medium", t, mediumId }.
const mediumItems = (id) => (id.startsWith(USER) ? importMedium(S.model, userMedia()[id.slice(USER.length)]) : presetMedium(S.model, mediumExists(id) ? id : "default"));
const eventName = (ev) => { const base = S.model.bases[S.model.mets[ev.met].b]; return isLabelled(ev) ? tracerName(supplyStruct(ev), ev.label, base.n) : base.n; };

/** Events as the simulator wants them: kinetics and medium compositions filled in. */
function resolveEvents() {
  return S.events.map((ev) => {
    if (ev.type === "medium") return { t: ev.t, type: "medium", items: mediumItems(ev.mediumId) };
    const cur = S.supplies.find((it) => it.met === ev.met);
    const [vmax, km] = cur ? [cur.vmax, cur.km] : kineticsFor(S.model.bases[S.model.mets[ev.met].b].n);
    return { t: ev.t, type: "add", met: ev.met, conc: ev.conc, vmax, km, label: ev.label, fraction: ev.fraction };
  });
}

function newEventTime() {
  const T = +$("dynHours").value || 24, last = S.events.length ? Math.max(...S.events.map((ev) => ev.t)) : 0;
  return last + 4 < T ? last + 4 : +(T / 2).toFixed(2);
}

function renderEvents() {
  const list = $("eventList"), T = +$("dynHours").value || 24;
  list.textContent = "";
  $("clearEvents").hidden = !S.events.length;
  S.events.sort((a, b) => a.t - b.t);
  const mk = (tag, cls) => { const x = document.createElement(tag); if (cls) x.className = cls; return x; };
  for (const ev of S.events) {
    const row = mk("div", "event" + (ev.type === "medium" ? " medium" : "") + (ev.t >= T ? " late" : ""));
    if (ev.t >= T) row.title = t("ev.late");
    const when = mk("div", "when"), tm = mk("input");
    tm.type = "number"; tm.min = 0; tm.step = "any"; tm.value = ev.t; tm.title = t("ev.time");
    tm.onchange = () => { ev.t = Math.max(0, +tm.value || 0); renderEvents(); changed(); };
    when.append(tm, "h"); row.appendChild(when);
    if (ev.type === "medium") {
      const sel = mk("select"); sel.title = t("ev.mediumTitle");
      for (const id of [...MEDIA.map((m) => m.id), ...Object.keys(userMedia()).sort((a, b) => a.localeCompare(b)).map((n) => USER + n)]) sel.add(new Option("→ " + mediumName(id), id));
      if (!mediumExists(ev.mediumId)) ev.mediumId = "default";
      sel.value = ev.mediumId;
      sel.onchange = () => { ev.mediumId = sel.value; changed(); };
      row.appendChild(sel);
    } else {
      const base = S.model.bases[S.model.mets[ev.met].b], name = mk("div", "name");
      name.innerHTML = `+ ${esc(base.n)}<small class="${isLabelled(ev) ? "" : "muted"}">${isLabelled(ev) ? "⚛ " + esc(t("ev.labelled", { name: tracerName(supplyStruct(ev), ev.label, base.n), p: Math.round(100 * ev.fraction) })) : t("ev.unlabelled")}</small>`;
      name.title = base.n;
      const conc = mk("input"); conc.type = "number"; conc.min = 0; conc.step = "any"; conc.value = ev.conc; conc.title = t("ev.conc");
      conc.oninput = () => { ev.conc = Math.max(0, +conc.value || 0); changed(); };
      const lab = mk("button", "lab" + (isLabelled(ev) ? " on" : "")); lab.textContent = "⚛"; lab.title = t("ev.label");
      lab.onclick = () => openMolEditor(ev, () => { renderEvents(); changed(); });
      row.append(name, conc, lab);
    }
    const rm = mk("button"); rm.textContent = "✕"; rm.title = t("ev.remove");
    rm.onclick = () => { S.events = S.events.filter((x) => x !== ev); renderEvents(); changed(); };
    row.appendChild(rm);
    list.appendChild(row);
  }
}

function addMetEvent(base) {
  const met = S.index.metsOfBase[base].find((m) => S.sim.exchanges.has(m));
  if (met === undefined) return;
  const cur = S.supplies.find((it) => it.met === met);
  S.events.push({ type: "add", t: newEventTime(), met, conc: cur && !cur.unlimited && cur.conc > 0 ? cur.conc : 1, label: null, fraction: 1 });
  renderEvents(); changed();
}

/** Frame positions of the events of the current result, for marks on the time charts. */
function eventMarks(px, H) {
  const frames = S.result.frames;
  return (S.result.evList || []).map((ev) => {
    const k = frames.findIndex((f) => f.t >= ev.t - 1e-9);
    return k < 0 ? "" : `<line x1="${px(k)}" x2="${px(k)}" y1="4" y2="${H - 4}" stroke="rgba(76,201,240,.7)" stroke-dasharray="1 3"/>`;
  }).join("");
}

// --------------------------------------------------------------- supplies ----
function supplyStruct(it) { return S.structures[S.model.bases[S.model.mets[it.met].b].id] || null; }
const isLabelled = (it) => !!(it.label && it.label.some((x) => x > 0));

function renderSupplies() {
  const list = $("supplyList"), tl = $("tracerList");
  list.textContent = ""; tl.textContent = "";
  for (const it of S.supplies) {
    if (!isLabelled(it)) continue;
    const base = S.model.bases[S.model.mets[it.met].b];
    const d = document.createElement("div"); d.className = "tracer";
    d.innerHTML = `<span>⚛</span><span class="grow"><b>${esc(tracerName(supplyStruct(it), it.label, base.n))}</b> [${S.model.mets[it.met].c}] · ${t("supply.marked", { p: Math.round(100 * it.fraction) })}</span>`;
    const ed = document.createElement("button"); ed.className = "link"; ed.textContent = t("supply.edit"); ed.onclick = () => openMolEditor(it);
    const rm = document.createElement("button"); rm.className = "link"; rm.textContent = t("supply.remove"); rm.onclick = () => { it.label = null; renderSupplies(); changed(); };
    d.append(ed, rm); tl.appendChild(d);
  }
  for (const it of S.supplies) {
    const met = S.model.mets[it.met], base = S.model.bases[met.b];
    const row = document.createElement("div");
    const pinned = measuredOf(it.met)?.rate > 0;
    row.className = "supply" + (!it.unlimited && it.conc !== it.conc0 ? " changed" : "") + (pinned ? " fixed" : "");
    const name = document.createElement("div"); name.className = "name";
    name.innerHTML = `${esc(base.n)} <small>[${met.c}]</small>`;
    name.title = `${base.n} — ${compName(met.c)}${S.sim.exchanges.has(it.met) ? "" : t("supply.injection")}${pinned ? t("supply.fixed") : ""}`;
    name.onclick = () => gotoMet(it.met);
    row.appendChild(name);
    if (it.unlimited) {
      const inf = document.createElement("div"); inf.className = "inf"; inf.textContent = t("supply.unlimited"); row.appendChild(inf);
    } else {
      if (it.hold) name.title += t("supply.hold");
      const inp = document.createElement("input");
      inp.type = "number"; inp.min = 0; inp.step = "any"; inp.value = it.conc;
      const tip = () => { inp.title = t("supply.cap", { x: fmtFlux(uptakeCapacity(it.conc, it.vmax, it.km)), vmax: it.vmax, km: it.km }); };
      tip();
      inp.oninput = () => { it.conc = Math.max(0, +inp.value || 0); tip(); row.classList.toggle("changed", it.conc !== it.conc0); changed(); };
      row.appendChild(inp);
    }
    const lab = document.createElement("button");
    lab.className = "lab" + (isLabelled(it) ? " on" : ""); lab.textContent = "⚛"; lab.title = t("supply.labelTitle");
    lab.onclick = () => openMolEditor(it);
    const rm = document.createElement("button"); rm.textContent = "✕"; rm.title = t("supply.removeTitle");
    rm.onclick = () => { S.supplies = S.supplies.filter((x) => x !== it); renderSupplies(); changed(); };
    row.append(lab, rm);
    list.appendChild(row);
  }
}

function addSupply(met, focusEditor = false) {
  let it = S.supplies.find((x) => x.met === met);
  if (!it) {
    const ext = S.sim.exchanges.has(met);
    it = { met, conc: 1, conc0: 0, vmax: ext ? 0.5 : 1, km: 1, unlimited: false, label: null, fraction: 1 };
    S.supplies.unshift(it);
    renderSupplies(); changed();
  }
  if (focusEditor) openMolEditor(it);
  return it;
}

function pickSupplyMet(base) {
  // prefer the extracellular species (uptake); otherwise cytosol
  const mets = S.index.metsOfBase[base];
  return mets.find((m) => S.sim.exchanges.has(m)) ?? mets.find((m) => S.model.mets[m].c === "c") ?? mets[0];
}

// ---------------------------------------------------------- perturbations ----
function renderPerturb() {
  if (S.measured.items.length) $("measuredNote").innerHTML = t("meas.note." + S.measured.set, { lang: docsLang() }) + (S.measured.edited ? " " + t("meas.note.edited") : "") + (S.perturb.length ? t("meas.perturbNote") : "");
  const list = $("perturbList");
  list.textContent = "";
  $("clearPerturb").hidden = !S.perturb.length;
  for (const p of S.perturb) {
    const row = document.createElement("div"); row.className = "pert";
    const name = document.createElement("div"); name.className = "name";
    if (p.type === "gene") {
      const rx = S.search.geneRxns.get(p.ref) || [];
      const dep = rx.filter((j) => gprActivity(S.model.rxns[j].g, new Map([[p.ref, 0]])) < 1).length;
      name.innerHTML = `${esc(geneSymbol(p.ref))} <small>${t("pert.gene")} · ${dep}/${rx.length}</small>`;
      name.title = dep ? t("pert.geneTitle", { sym: geneSymbol(p.ref), n: dep, total: rx.length }) : t("pert.noEffect");
      row.classList.toggle("noeffect", !dep);
      name.onclick = () => { S.sel = { type: "gene", sym: p.ref }; renderDetails(); };
    } else {
      const r = S.model.rxns[p.ref];
      name.innerHTML = `${esc(r.n)} <small>${r.id}</small>`;
      name.title = `${r.id} · ${r.n}`;
      name.onclick = () => gotoReaction(p.ref);
    }
    const sl = document.createElement("input");
    sl.type = "range"; sl.min = 0; sl.max = 100; sl.step = 5; sl.value = Math.round(100 * p.a); sl.title = t("pert.activity");
    const out = document.createElement("output");
    const show = () => { out.textContent = p.a === 0 ? t("pert.ko") : Math.round(100 * p.a) + " %"; out.classList.toggle("ko", p.a === 0); };
    show();
    sl.oninput = () => { p.a = +sl.value / 100; show(); changed(); };
    const rm = document.createElement("button"); rm.textContent = "✕"; rm.title = t("pert.removeTitle");
    rm.onclick = () => { S.perturb = S.perturb.filter((x) => x !== p); renderPerturb(); changed(); };
    row.append(name, sl, out, rm);
    list.appendChild(row);
  }
}

function addPerturb(type, ref) {
  if (S.perturb.some((p) => p.type === type && p.ref === ref)) return;
  S.perturb.push({ type, ref, a: 0 });
  renderPerturb(); changed();
}

function geneSymbol(ref) {
  const g = S.model.genes.find((x) => x[1] === ref || x[0] === ref);
  return g ? g[1] || g[0] : ref;
}

// --------------------------------------------------------- molecule editor ----
function openMolEditor(it, done) {
  const dlg = $("molDialog"), st = supplyStruct(it);
  const base = S.model.bases[S.model.mets[it.met].b];
  const n = st ? st.e.length : 1;
  const label = it.label ? Float64Array.from(it.label) : new Float64Array(n);
  let view = null;
  const update = () => { $("molName").textContent = tracerName(st, label, base.n); };
  $("molTitle").textContent = `${base.n} [${S.model.mets[it.met].c}]`;
  const frac = $("molFraction");
  frac.value = Math.round(100 * (it.fraction ?? 1)); $("molFractionOut").textContent = frac.value + " %";
  frac.oninput = () => { $("molFractionOut").textContent = frac.value + " %"; };
  const box = $("molCanvas");
  if (st) {
    $("molHint").textContent = t("mol.hint");
    view = renderMolecule(box, st, { label, height: 380, onToggle: (i) => { label[i] = label[i] > 0 ? 0 : 1; update(); } });
  } else {
    $("molHint").textContent = t("mol.noStruct");
    box.innerHTML = `<label class="check"><input type="checkbox" id="molWhole" ${label[0] > 0 ? "checked" : ""}> ${t("mol.whole")}</label>`;
    box.querySelector("#molWhole").onchange = (ev) => { label[0] = ev.target.checked ? 1 : 0; update(); };
  }
  dlg.querySelectorAll(".mol-tools button").forEach((b) => {
    b.disabled = !st;
    b.onclick = () => {
      const act = b.dataset.act;
      st.e.forEach((sym, i) => {
        if (act === "clear") label[i] = 0;
        else if (act === "allC" && sym === "C") label[i] = 1;
        else if (act === "allN" && sym === "N") label[i] = 1;
      });
      view.repaint(); update();
    };
  });
  update();
  dlg.onclose = () => {
    if (dlg.returnValue !== "ok") return;
    it.label = label.some((x) => x > 0) ? label : null;
    it.fraction = Math.max(0.01, +frac.value / 100);
    if (done) done(); else { renderSupplies(); changed(); }
  };
  dlg.showModal();
}

// -------------------------------------------------------------- objective ----
// Built-in objectives are "preset:<id>"; objectives saved by the user are "user:<name>" ({ rxn: id, max }) in
// localStorage, by reaction identifier, so that they work in both models when the reaction exists.
function userObjectives() {
  try { const o = JSON.parse(localStorage.getItem("metflux.objectives") || "{}"); return o && typeof o === "object" && !Array.isArray(o) ? o : {}; } catch { return {}; }
}
function objectiveChoices() {
  const out = [];
  for (const o of OBJECTIVES) { const j = objectiveIndex(S.model, S.index, o); if (j >= 0) out.push({ key: "preset:" + o.id, name: t("obj.name." + o.id), j, max: o.max, preset: o.id, group: o.group, cellType: !!o.cellType }); }
  const L = modelLookups(S.model), all = userObjectives();
  for (const name of Object.keys(all).sort((a, b) => a.localeCompare(b))) {
    const j = L.rxn.get(all[name].rxn);
    if (j !== undefined && !S.model.rxns[j].removed) out.push({ key: USER + name, name, j, max: all[name].max !== false });
  }
  return out;
}
/** The choice matching the current objective and direction, if any. */
const currentObjective = () => objectiveChoices().find((c) => c.j === S.cfg.objective && c.max === S.cfg.maximize) || null;

function renderObjective() {
  const r = S.model.rxns[S.cfg.objective];
  $("objCurrent").textContent = `${r.id} · ${r.n}`;
  $("objCurrent").title = S.index.equation(S.cfg.objective);
  $("objSense").value = S.cfg.maximize ? "max" : "min";
  $("pfba").checked = S.cfg.parsimonious;
  const sel = $("objPreset"), choices = objectiveChoices(), cur = currentObjective();
  sel.textContent = "";
  const group = (label, list) => {
    if (!list.length) return;
    const g = document.createElement("optgroup"); g.label = label;
    for (const c of list) g.appendChild(new Option(c.name, c.key));
    sel.appendChild(g);
  };
  for (const g of OBJECTIVE_GROUPS) group(t("obj.group." + g), choices.filter((c) => c.preset && c.group === g));
  group(t("obj.saved"), choices.filter((c) => !c.preset));
  if (!cur) sel.appendChild(new Option(t("obj.custom", { dir: t(S.cfg.maximize ? "h.max" : "h.min"), name: r.n }), "custom"));
  sel.value = cur ? cur.key : "custom";
  $("deleteObjective").hidden = !cur || !!cur.preset;
  $("saveObjective").hidden = !!cur;
  $("objNote").innerHTML = (cur?.preset ? t("obj.note." + cur.preset) : cur ? t("obj.note.user") : t("obj.note.custom"))
    + (cur?.cellType && S.measured.items.length ? `<br><b>${t("obj.measHint")}</b>` : "");
}

// ---- secondary objective: optimised while the objective keeps a fraction of its optimum (epsilon-constraint)
function renderSecondary() {
  const sel = $("secPreset"), sec = S.cfg.secondary, choices = objectiveChoices().filter((c) => c.j !== S.cfg.objective);
  sel.textContent = "";
  sel.appendChild(new Option(t("sec.none"), ""));
  for (const g of OBJECTIVE_GROUPS) {
    const list = choices.filter((c) => c.preset && c.group === g);
    if (!list.length) continue;
    const og = document.createElement("optgroup"); og.label = t("obj.group." + g);
    for (const c of list) og.appendChild(new Option(c.name, c.key));
    sel.appendChild(og);
  }
  const saved = choices.filter((c) => !c.preset);
  if (saved.length) { const og = document.createElement("optgroup"); og.label = t("obj.saved"); for (const c of saved) og.appendChild(new Option(c.name, c.key)); sel.appendChild(og); }
  const cur = sec ? choices.find((c) => c.j === sec.rxn && c.max === (sec.maximize !== false)) : null;
  if (sec && !cur) S.cfg.secondary = null; // the objective changed to the secondary's reaction, or it was removed
  sel.value = cur ? cur.key : "";
  const frac = Math.round(100 * (S.cfg.secondary?.frac ?? S.secFrac ?? 0.9));
  $("secFrac").value = frac; $("secFracVal").textContent = frac + " %";
  $("secFrac").disabled = $("secCurveBtn").disabled = !S.cfg.secondary;
  if (S.cfg.secondary) $("secBox").open = true;
}

function pickSecondary(key) {
  const c = objectiveChoices().find((x) => x.key === key);
  S.secFrac = S.cfg.secondary?.frac ?? S.secFrac ?? 0.9;
  S.cfg.secondary = c ? { rxn: c.j, maximize: c.max, frac: S.secFrac } : null;
  $("secCurve").innerHTML = "";
  renderSecondary(); changed();
}

/** Trade-off curve (Pareto front): the best secondary at each fraction of the first objective's optimum. */
async function tradeoffCurve() {
  const out = $("secCurve"), sec = S.cfg.secondary;
  if (!sec) return;
  if (S.mode !== "steady") { out.innerHTML = `<div class="note">${t("scr.needSteady")}</div>`; return; }
  const cfg = { ...S.cfg, measured: { items: S.measured.items.map((x) => ({ met: x.met, rate: x.rate })), tol: S.measured.tol, ngam: S.measured.ngam, trace: S.measured.trace },
    context: S.ctxBlock ? { id: S.context.id, mode: S.context.mode, block: S.ctxBlock } : undefined };
  const fracs = Array.from({ length: 11 }, (_, i) => 1 - i / 10);
  out.innerHTML = `<p class="meta">${t("pp.busy")}</p>`;
  const pts = await S.sim.tradeoff(cfg, S.supplies, fracs, (i, n) => { out.innerHTML = `<p class="meta">${t("sec.progress", { i, n })}</p>`; setProgress(i / n); });
  setProgress(null);
  const ok = pts.filter((p) => p.status === "optimal");
  if (!ok.length) { out.innerHTML = `<div class="note">${t("sec.noCurve")}</div>`; return; }
  const M = S.model, o = M.rxns[S.cfg.objective], s = M.rxns[sec.rxn];
  const unit = (r) => (isGrowthRxn(r) ? "h⁻¹" : "mmol/gDW/h");
  const xmax = Math.max(1e-12, ...ok.map((p) => p.primary)) * 1.05, ymax = Math.max(1e-12, ...ok.map((p) => p.secondary)) * 1.05;
  const W = 300, H = 160, P = { l: 44, r: 8, t: 8, b: 28 };
  const X = (x) => P.l + ((W - P.l - P.r) * x) / xmax, Y = (y) => H - P.b - ((H - P.t - P.b) * y) / ymax;
  const path = ok.map((p, i) => `${i ? "L" : "M"}${X(p.primary).toFixed(1)},${Y(p.secondary).toFixed(1)}`).join("");
  const dots = ok.map((p) => `<circle cx="${X(p.primary).toFixed(1)}" cy="${Y(p.secondary).toFixed(1)}" r="${Math.abs(p.frac - sec.frac) < 1e-6 ? 5 : 3}" fill="${Math.abs(p.frac - sec.frac) < 1e-6 ? "var(--hot)" : "var(--accent)"}"><title>${Math.round(100 * p.frac)} %: ${esc(o.n)} ${fmtFlux(p.primary)}, ${esc(s.n)} ${fmtFlux(p.secondary)}</title></circle>`).join("");
  const svg = `<svg viewBox="0 0 ${W} ${H}" width="100%" role="img" aria-label="${esc(t("sec.curve"))}" style="font-size:10px">
    <line x1="${P.l}" y1="${H - P.b}" x2="${W - P.r}" y2="${H - P.b}" stroke="var(--line)"/><line x1="${P.l}" y1="${P.t}" x2="${P.l}" y2="${H - P.b}" stroke="var(--line)"/>
    <path d="${path}" fill="none" stroke="var(--accent)" stroke-width="2"/>${dots}
    <text x="${P.l - 4}" y="${P.t + 8}" text-anchor="end" fill="var(--muted)">${fmtFlux(ymax / 1.05)}</text><text x="${P.l - 4}" y="${H - P.b}" text-anchor="end" fill="var(--muted)">0</text>
    <text x="${P.l}" y="${H - 14}" fill="var(--muted)">0</text><text x="${W - P.r}" y="${H - 14}" text-anchor="end" fill="var(--muted)">${fmtFlux(xmax / 1.05)}</text>
    <text x="${(P.l + W - P.r) / 2}" y="${H - 2}" text-anchor="middle" fill="var(--muted)">${esc(o.n)} (${unit(o)})</text></svg>`;
  // where giving up the first objective buys the most of the second: the steepest stretch of the front
  let best = null;
  for (let i = 1; i < ok.length; i++) { const dx = ok[i - 1].primary - ok[i].primary, dy = ok[i].secondary - ok[i - 1].secondary; if (dx > 1e-12) { const r = dy / dx; if (!best || r > best.r) best = { r, a: ok[i - 1], b: ok[i] }; } }
  out.innerHTML = `<h4>${t("sec.curveHead")}<small> · ${esc(s.n)} (${unit(s)})</small></h4>${svg}
    <table class="sec-tab"><tr><th>%</th><th>${esc(o.n)}</th><th>${esc(s.n)}</th></tr>${ok.filter((_, i) => i % 2 === 0 || i === ok.length - 1).map((p) => `<tr><td>${Math.round(100 * p.frac)}</td><td class="num">${fmtFlux(p.primary)}</td><td class="num">${fmtFlux(p.secondary)}</td></tr>`).join("")}</table>
    ${best && best.r > 0 ? `<p class="meta">${t("sec.steep", { a: Math.round(100 * best.a.frac), b: Math.round(100 * best.b.frac), r: fmtFlux(best.r) })}</p>` : ""}<p class="meta">${t("sec.curveNote")}</p>`;
}

function pickObjective(key) {
  const c = objectiveChoices().find((x) => x.key === key);
  if (!c) return;
  S.cfg.objective = c.j; S.cfg.maximize = c.max;
  renderObjective(); renderSecondary(); changed();
}

function saveObjective() {
  const r = S.model.rxns[S.cfg.objective];
  const asked = prompt(t("obj.savePrompt"), `${t(S.cfg.maximize ? "h.max" : "h.min")} ${r.n}`);
  const name = (asked || "").trim().slice(0, 60);
  if (!name) return;
  const all = userObjectives();
  if (name in all && !confirm(t("medium.overwrite", { name }))) return;
  all[name] = { rxn: r.id, max: S.cfg.maximize };
  try { localStorage.setItem("metflux.objectives", JSON.stringify(all)); } catch { alert(t("medium.storageError")); return; }
  renderObjective(); renderSecondary();
}

function deleteObjective() {
  const cur = currentObjective();
  if (!cur || cur.preset) return;
  const name = cur.key.slice(USER.length);
  if (!confirm(t("obj.deleteConfirm", { name }))) return;
  const all = userObjectives();
  delete all[name];
  try { localStorage.setItem("metflux.objectives", JSON.stringify(all)); } catch { /* ignore */ }
  renderObjective(); renderSecondary();
}

// ---------------------------------------------------------------- details ----
function bars(rows, color, wide = false) {
  // rows: [label, value, onclick-key, share 0..1]
  return rows.map(([label, val, key, share]) => `<div class="bar-row${wide ? " wide" : ""}" data-go="${key}"><span class="nm" title="${esc(label)}">${esc(label)}</span><span class="val">${val}</span><div class="bar"><i style="width:${Math.max(1.5, 100 * share)}%;background:${color}"></i></div></div>`).join("");
}

function wireGo(root) {
  root.querySelectorAll("[data-go]").forEach((elx) => {
    elx.addEventListener("click", () => {
      const [k, id] = elx.dataset.go.split(":");
      if (k === "rxn") gotoReaction(+id);
      else if (k === "met") gotoMet(+id);
      else if (k === "sub") openSubsystem(+id);
      else if (k === "base") gotoBase(+id);
    });
  });
}

function labelFate(f) {
  if (!f.e) return null;
  const { model, sim } = S, sol = { e: f.e }, els = f.elements;
  let total = 0;
  for (const inp of f.inputs) {
    if (!inp.label) continue;
    const b = model.mets[inp.met].b, pseudo = sim.tracer.basePseudo[b];
    let atoms = 0;
    for (const x of inp.label) atoms += x;
    total += inp.flux * atoms * (pseudo ? sim.tracer.baseW[b] : 1);
  }
  if (!(total > 0)) return null;
  const rows = [];
  for (const [met, ex] of sim.exchanges) {
    const out = -f.v[ex.rxn] * ex.dir;
    if (out <= 1e-9 || /biomass/i.test(model.bases[model.mets[met].b].n)) continue;
    const lab = out * sim.tracer.labelPerMole(sol, met, els);
    if (lab > total * 1e-4) rows.push([t("sum.excreted", { n: model.bases[model.mets[met].b].n }), lab, `met:${met}`]);
  }
  const bj = S.index.biomassRxn;
  if (bj >= 0 && Math.abs(f.v[bj]) > 1e-12) {
    const r = model.rxns[bj];
    let lab = 0;
    r.m.forEach((m, q) => { if (!/biomass$/i.test(model.bases[model.mets[m].b].n) || r.c[q] < 0) lab -= r.c[q] * f.v[bj] * sim.tracer.labelPerMole(sol, m, els); });
    if (lab > total * 1e-4) rows.push([t("sum.biomassFate"), lab, `rxn:${bj}`]);
  }
  rows.sort((a, b) => b[1] - a[1]);
  const acc = rows.reduce((s, r) => s + r[1], 0);
  return { rows, total, rest: Math.max(0, total - acc) };
}

function changedHtml(f) {
  const mask = frameMask(f, "delta"), rows = [];
  let n = 0, nRev = 0;
  for (let j = 0; j < mask.rxn.length; j++) {
    if (!mask.rxn[j]) continue;
    n++;
    rows.push([S.model.rxns[j].n, Math.abs(f.v[j] - f.ref.v[j]), j]);
    if (fluxChange(f.ref.v[j], f.v[j]).kind === "rev") nRev++;
  }
  if (!n) return `<h4>${t("sum.changed")}</h4><p class="meta">${t("sum.noChange")}</p>`;
  rows.sort((a, b) => b[1] - a[1]);
  const mx = rows[0][1];
  // against a scenario the arrows read "scenario → shown"; against the perturbation reference, "reference → perturbed"
  const unit = (f.ref.scen ? `${t("cmp.metTitle", { name: esc(f.ref.scen.name), cur: esc(compare.shownName()) })} · ${n}` : t("sum.changedUnit", { n })) + (nRev ? ` · <span style="color:${revColor()}">⇄ ${t("sum.revCount", { n: nRev })}</span>` : "");
  return `<h4>${t("sum.changed")}${small(unit)}</h4>` +
    bars(rows.slice(0, 12).map(([name, d, j]) => [(fluxChange(f.ref.v[j], f.v[j]).kind === "rev" ? "⇄ " : "") + name, `${fmtFlux(f.ref.v[j])} → ${fmtFlux(f.v[j])}`, `rxn:${j}`, d / mx]), `linear-gradient(90deg,${deltaColor(-1)},${deltaColor(1)})`, true);
}

/** Flux variability of the selected reaction, on demand (two LPs with the objective held at its optimum). */
async function fluxRange(j) {
  const box = $("fvaOut");
  if (!box) return;
  if (S.mode !== "steady") { box.innerHTML = `<div class="note">${t("rxn.fvaSteady")}</div>`; return; }
  box.innerHTML = `<p class="meta">${t("rxn.fvaBusy")}</p>`; setProgress(true);
  const cfg = { ...S.cfg, perturb: [...perturbActivities()], measured: { items: S.measured.items.map((x) => ({ met: x.met, rate: x.rate })), tol: S.measured.tol, ngam: S.measured.ngam, trace: S.measured.trace },
    context: S.ctxBlock ? { id: S.context.id, mode: S.context.mode, block: S.ctxBlock } : undefined };
  try {
    const r = await S.sim.fluxRange(cfg, S.supplies, j, frame()?.ref?.v, S.flexCycles === false ? null : 0.05).finally(() => setProgress(null));
    if (!$("fvaOut") || S.sel?.rxn !== j) return;
    if (!r.range) { $("fvaOut").innerHTML = `<div class="note">${t("sum.nosol", { why: esc(statusWhy(r.status)) })}</div>`; return; }
    const [lo, hi] = r.range, fixed = Math.abs(hi - lo) <= 1e-6 * Math.max(1, Math.abs(hi), Math.abs(lo));
    const fmt = (x) => (Number.isFinite(x) ? fmtFlux(x) : x > 0 ? "∞" : "−∞");
    const kind = fixed ? (Math.abs(lo) < 1e-9 ? "rxn.fvaZero" : "rxn.fvaFixed") : lo > 1e-9 || hi < -1e-9 ? "rxn.fvaRequired" : "rxn.fvaFree";
    const flexible = !fixed && Math.max(Math.abs(lo), Math.abs(hi)) < 999;
    $("fvaOut").innerHTML = `${flexible ? `<button class="link" id="fvaAltBtn">${t("flex.altButton")}</button><div id="fvaAlt"></div>` : ""}<div class="note"><b>${t("rxn.fvaRange", { lo: fmt(lo), hi: fmt(hi) })}</b><br>${t(kind)}${Math.max(Math.abs(lo), Math.abs(hi)) >= 999 ? " " + t("rxn.fvaLoop") : ""}${r.relaxed ? " " + t("sum.relaxed") : ""}</div>`;
    $("fvaAltBtn")?.addEventListener("click", () => fvaAlternatives(j));
  } catch (err) { $("fvaOut").innerHTML = `<div class="note err">${esc(err.message)}</div>`; }
}

/**
 * Essential-gene screen in the current situation (cell type included): knock out, one by one, every detected gene
 * whose reactions carry flux. Genes that close the same reactions share one LP; genes whose loss is covered by an
 * isoenzyme need none.
 */
async function geneScreen() {
  const out = $("screenOut"), f = frame();
  if (S.mode !== "steady" || !f || f.status !== "optimal") { out.innerHTML = `<div class="note">${t("scr.needSteady")}</div>`; return; }
  // The screen runs on top of the current knockouts and knockdowns (the background): what it finds essential is
  // essential in this perturbed cell. Genes essential only there are then checked in the unperturbed cell, and the
  // ones that do not matter there are synthetic lethal with the background.
  const pert = [...perturbActivities()], pref = "pertRef" in f ? f.pertRef : f.ref; // pref: the unperturbed run
  const ref = f.objective;
  if (!(Math.abs(ref) > 1e-12)) { out.innerHTML = `<div class="note">${t("sum.zero")}</div>`; return; }
  const ctx = currentContext(), off = ctx ? offGenes(ctx, S.base.model.genes) : new Set();
  const blocked = S.ctxBlock ? (S.ctxBlockSet ??= new Set(S.ctxBlock)) : new Set();
  const koGenes = new Set(S.perturb.filter((p) => p.type === "gene" && p.a <= 0).map((p) => p.ref));
  const bgClosed = new Set(pert.filter(([, a]) => a <= 0).map(([j]) => j));
  // reactions a gene's knockout closes, given the genes already off
  const lostBy = (sym, rx, offSet, closed) => {
    const levels = new Map([...offSet].map((g) => [g, 0])); levels.set(sym, 0);
    return rx.filter((j) => !blocked.has(j) && !closed.has(j) && gprActivity(S.model.rxns[j].g, levels) === 0).sort((a, b) => a - b);
  };
  const offBg = new Set([...off, ...koGenes]);
  const groups = new Map(); // key -> { rxns, genes }
  const free = [];
  for (const [sym, rx] of S.search.geneRxns) {
    if (off.has(sym) || koGenes.has(sym) || !rx.some((j) => Math.abs(f.v[j]) > 1e-9)) continue;
    const lost = lostBy(sym, rx, offBg, bgClosed);
    if (!lost.length) { free.push(sym); continue; }
    const key = lost.join(",");
    if (!groups.has(key)) groups.set(key, { rxns: Int32Array.from(lost), genes: [] });
    groups.get(key).genes.push(sym);
  }
  const list = [...groups.values()];
  const cfg = { ...S.cfg, perturb: pert, measured: { items: S.measured.items.map((x) => ({ met: x.met, rate: x.rate })), tol: S.measured.tol, ngam: S.measured.ngam, trace: S.measured.trace },
    context: S.ctxBlock ? { id: S.context.id, mode: S.context.mode, block: S.ctxBlock } : undefined };
  const refV = pert.length ? (pref?.v || f.v) : null;
  S.screening = { stop: false };
  $("geneScreen").textContent = t("scr.stop");
  const t0 = performance.now();
  let res;
  try {
    res = await S.sim.screenKnockouts(cfg, S.supplies, list.map((g) => g.rxns), (done, total) => {
      out.innerHTML = `<p class="meta">${t("scr.progress", { done, total, genes: list.reduce((s, g) => s + g.genes.length, 0) })}</p>`;
      setProgress(done / total);
      return !S.screening.stop;
    }, refV);
  } catch (err) { out.innerHTML = `<div class="note err">${esc(err.message)}</div>`; }
  // the unperturbed-cell phase below is part of the screen: it stays stoppable, and the button stays "stop"
  const finish = () => { S.screening = null; $("geneScreen").textContent = t("scr.button"); setProgress(null); };
  if (!res) { finish(); return; }
  const rows = [];
  res.forEach((r, i) => { for (const g of list[i].genes) rows.push({ g, x: r.objective / ref, relaxed: r.relaxed, status: r.status, rxns: list[i].rxns }); });
  // with a background: the same genes in the unperturbed cell (one LP per distinct set of reactions; none when the
  // gene closes nothing there, e.g. its isoenzyme is what the background knocked out)
  if (pert.length && pref && Math.abs(pref.objective) > 1e-12 && !S.screening.stop) {
    const hit = rows.filter((r) => r.x < 0.95), wtGroups = new Map();
    for (const r of hit) {
      const lost = lostBy(r.g, S.search.geneRxns.get(r.g), off, new Set());
      if (!lost.length) { r.wt = 1; continue; }
      const key = lost.join(",");
      if (!wtGroups.has(key)) wtGroups.set(key, { rxns: Int32Array.from(lost), rows: [] });
      wtGroups.get(key).rows.push(r);
    }
    const wl = [...wtGroups.values()];
    if (wl.length) {
      out.innerHTML = `<p class="meta">${t("scr.wtProgress", { n: wl.length })}</p>`;
      const wres = await S.sim.screenKnockouts({ ...cfg, perturb: [] }, S.supplies, wl.map((g) => g.rxns), (done, total) => {
        out.innerHTML = `<p class="meta">${t("scr.wtProgress", { n: wl.length })}</p>`; setProgress(done / total); return !S.screening.stop;
      });
      wres.forEach((r, i) => { for (const row of wl[i].rows) row.wt = r.objective / pref.objective; });
    }
  }
  finish();
  const rescued = new Map((ctx?.rescued || []).map(([k, ti]) => [S.base.model.genes[k][1], taskName(S.ctxData, ti)]));
  rows.sort((a, b) => a.x - b.x);
  const ess = rows.filter((r) => r.x < 0.01), red = rows.filter((r) => r.x >= 0.01 && r.x < 0.95);
  const row = (r) => {
    const names = Array.from(r.rxns, (j) => S.model.rxns[j].n).join("\n"), resc = rescued.get(r.g);
    const sl = r.wt === undefined ? "" : r.wt >= 0.95 ? `<b class="slb" title="${esc(t("scr.slTitle", { wt: Math.round(100 * r.wt) }))}">SL</b>` : `<small class="meta" title="${esc(t("scr.wtTitle"))}"> (${Math.round(100 * r.wt)} %)</small>`;
    return `<div class="scr-row"><span><span class="linkish" data-gene="${esc(r.g)}">${esc(r.g)}</span>${sl}</span>${resc ? `<span class="warn" title="${esc(t("scr.rescuedTitle", { task: resc }))}">↺</span>` : "<span></span>"}<small class="meta" title="${esc(names)}">${t("scr.nRxns", { n: r.rxns.length })}${r.relaxed ? " *" : ""}</small><span class="val">${Math.round(100 * r.x)} %</span><button class="link" data-ko="${esc(r.g)}" title="${esc(t("scr.addTitle"))}">✂</button></div>`;
  };
  const slRows = pert.length ? rows.filter((r) => r.x < 0.95 && r.wt >= 0.95) : [];
  const essRest = ess.filter((r) => !(pert.length && r.wt >= 0.95));
  const redRest = red.filter((r) => !(pert.length && r.wt >= 0.95));
  const none = rows.filter((r) => r.x >= 0.95).map((r) => r.g).concat(free).sort();
  out.innerHTML = `<div class="note">${t("scr.summary", { n: rows.length + free.length, lp: res.length, s: ((performance.now() - t0) / 1000).toFixed(0), ess: ess.length, red: red.length, ctx: esc(ctx?.name || t("ctx.none")) })}${res.length < list.length ? " " + t("scr.stopped") : ""}${pert.length ? "<br>" + t("scr.bgNote", { list: esc(S.perturb.map((p) => (p.type === "gene" ? geneSymbol(p.ref) : S.model.rxns[p.ref].id) + (p.a > 0 ? ` ${Math.round(100 * p.a)} %` : "")).join(", ")), sl: slRows.length }) : ""}</div>`
    + (slRows.length ? `<details class="scr-group sl-top" open><summary>${t("scr.slGroup")} (${slRows.length})</summary><div class="scr-list">${slRows.map(row).join("")}</div></details>` : "")
    + (essRest.length ? `<details class="scr-group"${slRows.length ? "" : " open"}><summary>${t("scr.ess")} (${essRest.length})</summary><div class="scr-list">${essRest.map(row).join("")}</div></details>` : "")
    + (redRest.length ? `<details class="scr-group"><summary>${t("scr.red")} (${redRest.length})</summary><div class="scr-list">${redRest.map(row).join("")}</div></details>` : "")
    + (none.length ? `<details class="scr-group"><summary>${t("scr.none", { n: none.length })}</summary><div class="scr-list"><p class="meta">${none.map(esc).join(", ")}</p></div></details>` : "")
    + (rows.some((r) => rescued.has(r.g)) ? `<p class="meta">${t("scr.rescuedNote")}</p>` : "")
    + (rows.some((r) => r.relaxed) ? `<p class="meta">${t("scr.relaxedNote")}</p>` : "");
  out.querySelectorAll("[data-ko]").forEach((b) => { b.onclick = () => addPerturb("gene", b.dataset.ko); });
  out.querySelectorAll("[data-gene]").forEach((b) => { b.onclick = () => { S.sel = { type: "gene", sym: b.dataset.gene }; renderDetails(); }; });
}

/**
 * Medium screen: leave out each component of the medium, one by one, and see which ones lower the objective. With
 * knockouts in the list it runs on top of them, and the nutrients the unperturbed cell does not need are flagged SL
 * (the cell depends on them only because of the knockouts: a synthetic-lethal pair of one gene and one nutrient).
 */
async function nutrientScreen() {
  const out = $("nutOut"), f = frame();
  if (S.mode !== "steady" || !f || f.status !== "optimal") { out.innerHTML = `<div class="note">${t("scr.needSteady")}</div>`; return; }
  if (!(Math.abs(f.objective) > 1e-12)) { out.innerHTML = `<div class="note">${t("nut.noGrowth")}</div>`; return; }
  const pert = [...perturbActivities()], pref = "pertRef" in f ? f.pertRef : f.ref;
  const name = (m) => S.model.bases[S.model.mets[m].b].n;
  const mets = S.supplies.filter((it) => !it.unlimited && it.conc > 0).map((it) => it.met);
  const cfg = { ...S.cfg, perturb: pert, measured: { items: S.measured.items.map((x) => ({ met: x.met, rate: x.rate })), tol: S.measured.tol, ngam: S.measured.ngam, trace: S.measured.trace },
    context: S.ctxBlock ? { id: S.context.id, mode: S.context.mode, block: S.ctxBlock } : undefined };
  const refV = pert.length ? (pref?.v || f.v) : null;
  S.screening = { stop: false };
  $("nutScreen").textContent = t("scr.stop");
  const t0 = performance.now();
  let res, wt = null;
  try {
    res = await S.sim.screenMedium(cfg, S.supplies, mets, (done, total) => {
      out.innerHTML = `<p class="meta">${t("nut.progress", { done, total })}</p>`; setProgress(done / total); return !S.screening.stop;
    }, refV);
    if (pert.length && pref && Math.abs(pref.objective) > 1e-12 && !S.screening.stop) {
      wt = await S.sim.screenMedium({ ...cfg, perturb: [] }, S.supplies, mets, (done, total) => {
        out.innerHTML = `<p class="meta">${t("nut.wtProgress", { n: mets.length })}</p>`; setProgress(done / total); return !S.screening.stop;
      });
    }
  } catch (err) { out.innerHTML = `<div class="note err">${esc(err.message)}</div>`; }
  S.screening = null; $("nutScreen").textContent = t("nut.button"); setProgress(null);
  if (!res) return;
  const rows = res.map((r, i) => ({ m: mets[i], x: r.objective / f.objective, wt: wt && wt[i] ? wt[i].objective / pref.objective : undefined, relaxed: r.relaxed }))
    .sort((a, b) => a.x - b.x);
  const ess = rows.filter((r) => r.x < 0.01), red = rows.filter((r) => r.x >= 0.01 && r.x < 0.95), none = rows.filter((r) => r.x >= 0.95);
  const slRows = pert.length ? rows.filter((r) => r.x < 0.95 && r.wt >= 0.95) : [];
  const essRest = ess.filter((r) => !(pert.length && r.wt >= 0.95));
  const redRest = red.filter((r) => !(pert.length && r.wt >= 0.95));
  const row = (r) => {
    const sl = r.wt === undefined ? "" : r.wt >= 0.95 ? `<b class="slb" title="${esc(t("nut.slTitle", { wt: Math.round(100 * r.wt) }))}">SL</b>` : `<small class="meta" title="${esc(t("nut.wtTitle"))}"> (${Math.round(100 * r.wt)} %)</small>`;
    return `<div class="scr-row"><span><span class="linkish" data-met="${r.m}">${esc(name(r.m))}</span>${sl}</span><span></span><small class="meta">${r.relaxed ? "*" : ""}</small><span class="val">${Math.round(100 * r.x)} %</span><span></span></div>`;
  };
  out.innerHTML = `<div class="note">${t("nut.summary", { n: rows.length, s: ((performance.now() - t0) / 1000).toFixed(0), ess: ess.length, red: red.length })}${res.length < mets.length ? " " + t("scr.stopped") : ""}${pert.length ? "<br>" + t("nut.bgNote", { list: esc(S.perturb.map((p) => (p.type === "gene" ? geneSymbol(p.ref) : S.model.rxns[p.ref].id) + (p.a > 0 ? ` ${Math.round(100 * p.a)} %` : "")).join(", ")), sl: slRows.length }) : ""}</div>`
    + (slRows.length ? `<details class="scr-group sl-top" open><summary>${t("nut.slGroup")} (${slRows.length})</summary><div class="scr-list">${slRows.map(row).join("")}</div></details>` : "")
    + (essRest.length ? `<details class="scr-group"${slRows.length ? "" : " open"}><summary>${t("nut.ess")} (${essRest.length})</summary><div class="scr-list">${essRest.map(row).join("")}</div></details>` : "")
    + (redRest.length ? `<details class="scr-group"><summary>${t("scr.red")} (${redRest.length})</summary><div class="scr-list">${redRest.map(row).join("")}</div></details>` : "")
    + (none.length ? `<details class="scr-group"><summary>${t("nut.none", { n: none.length })}</summary><div class="scr-list"><p class="meta">${none.map((r) => esc(name(r.m))).join(", ")}</p></div></details>` : "")
    + (rows.some((r) => r.relaxed) ? `<p class="meta">${t("scr.relaxedNote")}</p>` : "");
  out.querySelectorAll("[data-met]").forEach((b) => { b.onclick = () => { S.sel = { type: "met", met: +b.dataset.met }; renderDetails(); }; });
}

// ------------------------------------------------ differential screens (Compare tab) ----
/** Reconstruct a solver-ready state from captured scenario settings without touching the UI. */
function stateFromSettings(o, scFrame, label) {
  const L = modelLookups(S.model);
  const supplies = [];
  for (const c of o.medium.components) {
    const m = L.met.get(c.met);
    if (m !== undefined && !S.model.mets[m].removed) supplies.push({ met: m, conc: +c.conc, conc0: +(c.conc0 ?? c.conc), vmax: +c.vmax, km: +c.km, unlimited: !!c.unlimited, hold: !!c.hold });
  }
  const measItems = [];
  for (const x of o.measured.items) { const m = L.met.get(x.met); if (m !== undefined && S.sim.exchanges.has(m)) measItems.push({ met: m, rate: +x.rate }); }
  const trace = MEASURED_SETS.find((x) => x.id === o.measured.set)?.trace;
  const ctxId = o.context?.id || null;
  const ctx = ctxId ? (S.ctxData?.byId.get(ctxId) || o.context?.user || null) : null;
  const ctxMode = o.context?.mode || "complex";
  const off = ctx ? offGenes(ctx, S.base.model.genes) : new Set();
  const block = ctx ? blockedReactions(S.model, off, { complexes: ctxMode === "complex" }) : null;
  const levels = new Map(), touched = new Set(), pertMap = new Map(), koGenes = new Set();
  for (const p of o.perturbations) {
    if (p.type === "gene") {
      levels.set(p.target, Math.min(levels.get(p.target) ?? 1, +p.activity));
      if (+p.activity <= 0) koGenes.add(p.target);
      for (const j of S.search.geneRxns.get(p.target) || []) touched.add(j);
    }
  }
  for (const j of touched) { const a = gprActivity(S.model.rxns[j].g, levels); if (a < 1) pertMap.set(j, a); }
  for (const p of o.perturbations) {
    if (p.type === "rxn" && +p.activity < 1) { const j = L.rxn.get(p.target); if (j !== undefined && !S.model.rxns[j].removed) pertMap.set(j, Math.min(pertMap.get(j) ?? 1, +p.activity)); }
  }
  const pert = [...pertMap];
  const bgClosed = new Set(pert.filter(([, a]) => a <= 0).map(([j]) => j));
  const oj = L.rxn.get(o.objective.reaction);
  const s2 = o.objective.secondary, sj = s2 ? L.rxn.get(s2.reaction) : undefined;
  const cfg = {
    objective: oj !== undefined && !S.model.rxns[oj].removed ? oj : Math.max(0, S.index.biomassRxn),
    maximize: o.objective.maximize !== false,
    parsimonious: o.objective.parsimonious !== false,
    secondary: sj !== undefined && !S.model.rxns[sj].removed && sj !== oj ? { rxn: sj, maximize: s2.maximize !== false, frac: Math.min(1, Math.max(0, +s2.keep || 0)) } : null,
    perturb: pert,
    measured: { items: measItems, tol: +o.measured.tol || 0, ngam: +o.measured.ngam || 0, trace },
    context: block ? { id: ctxId, mode: ctxMode, block } : undefined,
  };
  const pref = "pertRef" in scFrame ? scFrame.pertRef : scFrame.ref;
  return { name: label, cfg, supplies, off, blocked: new Set(block || []), koGenes, bgClosed, f: scFrame, obj: scFrame.objective, refV: pert.length ? (pref?.v || scFrame.v) : null };
}

function stateFromCurrent(f, label) {
  const pert = [...perturbActivities()], pref = "pertRef" in f ? f.pertRef : f.ref;
  const ctx = currentContext(), off = ctx ? offGenes(ctx, S.base.model.genes) : new Set();
  const koGenes = new Set(S.perturb.filter((p) => p.type === "gene" && p.a <= 0).map((p) => p.ref));
  const bgClosed = new Set(pert.filter(([, a]) => a <= 0).map(([j]) => j));
  const cfg = {
    ...S.cfg, perturb: pert,
    measured: { items: S.measured.items.map((x) => ({ met: x.met, rate: x.rate })), tol: S.measured.tol, ngam: S.measured.ngam, trace: S.measured.trace },
    context: S.ctxBlock ? { id: S.context.id, mode: S.context.mode, block: S.ctxBlock } : undefined,
  };
  return { name: label, cfg, supplies: S.supplies, off, blocked: new Set(S.ctxBlock || []), koGenes, bgClosed, f, obj: f.objective, refV: pert.length ? (pref?.v || f.v) : null };
}

/** Pair (A reference, B current) for the differential screens in the Compare tab. */
function diffPair() {
  const f = frame();
  if (S.mode !== "steady" || !f || f.status !== "optimal") return { error: t("scr.needSteady") };
  if (!(Math.abs(f.objective) > 1e-12)) return { error: t("nut.noGrowth") };
  const sc = compare.current();
  if (sc) {
    if (sc.opsKey !== opsKey()) return { error: t("diff.modelsDiffer") };
    if (sc.settings.mode === "dynamic") return { error: t("scr.needSteady") };
    const sf = sc.result.frames[sc.result.frames.length - 1];
    if (!sf || sf.status !== "optimal" || !(Math.abs(sf.objective) > 1e-12)) return { error: t("diff.refNoGrowth", { name: esc(sc.name) }) };
    return { A: stateFromSettings(sc.settings, sf, sc.name), B: stateFromCurrent(f, compare.shownName()) };
  }
  if (S.perturb.length) {
    const pref = "pertRef" in f ? f.pertRef : f.ref;
    if (!pref || pref.status !== "optimal" || !(Math.abs(pref.objective) > 1e-12)) return { error: t("diff.refNoGrowth", { name: esc(t("diff.wt")) }) };
    const lbl = S.perturb.map((p) => (p.type === "gene" ? geneSymbol(p.ref) : S.model.rxns[p.ref].id) + (p.a > 0 ? ` ${Math.round(100 * p.a)} %` : "")).join(", ");
    const B = stateFromCurrent(f, lbl);
    const A = { ...B, name: t("diff.wt"), cfg: { ...B.cfg, perturb: [] }, koGenes: new Set(), bgClosed: new Set(), f: pref, obj: pref.objective, refV: null };
    return { A, B };
  }
  return { error: t("diff.needPair") };
}

/** Auxotrophy screen (A → B): which non-essential nutrients in A become essential in B. */
async function compareNutrientScreen() {
  const out = $("cmpScreenOut"), pair = diffPair();
  if (pair.error) { out.innerHTML = `<div class="note">${pair.error}</div>`; return; }
  const { A, B } = pair;
  const name = (m) => S.model.bases[S.model.mets[m].b].n;
  const metsB = B.supplies.filter((it) => !it.unlimited && it.conc > 0).map((it) => it.met);
  const setA = new Set(A.supplies.filter((it) => !it.unlimited && it.conc > 0).map((it) => it.met));
  const mets = metsB.filter((m) => setA.has(m));
  if (!mets.length) { out.innerHTML = `<div class="note">${t("diff.noSharedMets")}</div>`; return; }
  const mediaDiffer = mets.length < metsB.length || mets.length < setA.size;
  S.screening = { stop: false };
  $("cmpNutScreen").textContent = t("scr.stop");
  const t0 = performance.now();
  let resB, resA;
  try {
    resB = await S.sim.screenMedium(B.cfg, B.supplies, mets, (done, total) => {
      out.innerHTML = `<p class="meta">${t("diff.nutProg", { who: esc(B.name), done, total })}</p>`; setProgress(done / (2 * total)); return !S.screening.stop;
    }, B.refV);
    if (!S.screening.stop && resB.length === mets.length) {
      resA = await S.sim.screenMedium(A.cfg, A.supplies, mets, (done, total) => {
        out.innerHTML = `<p class="meta">${t("diff.nutProg", { who: esc(A.name), done, total })}</p>`; setProgress(0.5 + done / (2 * total)); return !S.screening.stop;
      }, A.refV);
    }
  } catch (err) { out.innerHTML = `<div class="note err">${esc(err.message)}</div>`; }
  S.screening = null; $("cmpNutScreen").textContent = t("diff.nutBtn"); setProgress(null);
  if (!resB || !resA || resA.length !== mets.length) return;
  const rows = mets.map((m, i) => ({ m, a: resA[i].objective / A.obj, b: resB[i].objective / B.obj, relaxed: resA[i].relaxed || resB[i].relaxed }));
  const onlyB = rows.filter((r) => r.a >= 0.95 && r.b < 0.95).sort((p, q) => p.b - q.b);
  const onlyA = rows.filter((r) => r.a < 0.95 && r.b >= 0.95).sort((p, q) => p.a - q.a);
  const both = rows.filter((r) => r.a < 0.95 && r.b < 0.95).sort((p, q) => p.b - q.b);
  const neither = rows.filter((r) => r.a >= 0.95 && r.b >= 0.95);
  const row = (r) => `<div class="scr-row diff-row"><span><span class="linkish" data-met="${r.m}">${esc(name(r.m))}</span></span><span class="val">${Math.round(100 * r.a)} % → ${Math.round(100 * r.b)} %${r.relaxed ? " *" : ""}</span><button class="link" data-zero="${r.m}" title="${esc(t("diff.tryZero"))}">0</button></div>`;
  out.innerHTML = `<div class="note">${t("diff.nutSummary", { a: esc(A.name), b: esc(B.name), n: mets.length, s: ((performance.now() - t0) / 1000).toFixed(1), onlyB: onlyB.length, onlyA: onlyA.length })}${mediaDiffer ? "<br>" + t("diff.mediaNote") : ""}</div>`
    + (onlyB.length ? `<details class="scr-group sl-top" open><summary>${t("diff.onlyB", { b: esc(B.name) })} (${onlyB.length})</summary><div class="scr-list">${onlyB.map(row).join("")}</div></details>` : `<p class="meta">${t("diff.noNewNut", { b: esc(B.name) })}</p>`)
    + (onlyA.length ? `<details class="scr-group" open><summary>${t("diff.onlyA", { a: esc(A.name) })} (${onlyA.length})</summary><div class="scr-list">${onlyA.map(row).join("")}</div></details>` : "")
    + (both.length ? `<details class="scr-group"><summary>${t("diff.bothNut")} (${both.length})</summary><div class="scr-list">${both.map(row).join("")}</div></details>` : "")
    + (neither.length ? `<details class="scr-group"><summary>${t("diff.neitherNut", { n: neither.length })}</summary><div class="scr-list"><p class="meta">${neither.map((r) => esc(name(r.m))).join(", ")}</p></div></details>` : "");
  out.querySelectorAll("[data-met]").forEach((b) => { b.onclick = () => { S.sel = { type: "met", met: +b.dataset.met }; renderDetails(); }; });
  out.querySelectorAll("[data-zero]").forEach((b) => {
    b.onclick = () => {
      const it = S.supplies.find((x) => x.met === +b.dataset.zero);
      if (!it || it.unlimited) return;
      it.conc = 0; renderSupplies(); changed();
    };
  });
}

/** Synthetic-lethality gene screen (A → B): genes dispensable in A that become essential in B (and vice versa). */
async function compareGeneScreen() {
  const out = $("cmpScreenOut"), pair = diffPair();
  if (pair.error) { out.innerHTML = `<div class="note">${pair.error}</div>`; return; }
  const { A, B } = pair;
  const groupsFor = (st) => {
    const offBg = new Set([...st.off, ...st.koGenes]);
    const groups = new Map();
    for (const [sym, rx] of S.search.geneRxns) {
      if (st.off.has(sym) || st.koGenes.has(sym) || !rx.some((j) => Math.abs(st.f.v[j]) > 1e-9)) continue;
      const levels = new Map([...offBg].map((g) => [g, 0])); levels.set(sym, 0);
      const lost = rx.filter((j) => !st.blocked.has(j) && !st.bgClosed.has(j) && gprActivity(S.model.rxns[j].g, levels) === 0).sort((a, b) => a - b);
      if (!lost.length) continue;
      const key = lost.join(",");
      if (!groups.has(key)) groups.set(key, { rxns: Int32Array.from(lost), genes: [] });
      groups.get(key).genes.push(sym);
    }
    return [...groups.values()];
  };
  const listB = groupsFor(B), listA = groupsFor(A);
  S.screening = { stop: false };
  $("cmpGeneScreen").textContent = t("scr.stop");
  const t0 = performance.now();
  let resB, resA;
  try {
    resB = await S.sim.screenKnockouts(B.cfg, B.supplies, listB.map((g) => g.rxns), (done, total) => {
      out.innerHTML = `<p class="meta">${t("diff.geneProg", { who: esc(B.name), done, total })}</p>`; setProgress(done / (2 * Math.max(1, total))); return !S.screening.stop;
    }, B.refV);
    if (!S.screening.stop && resB.length === listB.length) {
      resA = await S.sim.screenKnockouts(A.cfg, A.supplies, listA.map((g) => g.rxns), (done, total) => {
        out.innerHTML = `<p class="meta">${t("diff.geneProg", { who: esc(A.name), done, total })}</p>`; setProgress(0.5 + done / (2 * Math.max(1, total))); return !S.screening.stop;
      }, A.refV);
    }
  } catch (err) { out.innerHTML = `<div class="note err">${esc(err.message)}</div>`; }
  S.screening = null; $("cmpGeneScreen").textContent = t("diff.geneBtn"); setProgress(null);
  if (!resB || !resA || resA.length !== listA.length) return;
  const mapA = new Map(), mapB = new Map();
  resA.forEach((r, i) => { for (const g of listA[i].genes) mapA.set(g, r.objective / A.obj); });
  resB.forEach((r, i) => { for (const g of listB[i].genes) mapB.set(g, r.objective / B.obj); });
  const all = new Set([...mapA.keys(), ...mapB.keys()]);
  const rows = [];
  for (const g of all) {
    if (A.koGenes.has(g) || B.koGenes.has(g)) continue; // already knocked out by the user
    rows.push({ g, a: mapA.get(g) ?? 1, b: mapB.get(g) ?? 1 });
  }
  const onlyB = rows.filter((r) => r.a >= 0.95 && r.b < 0.95).sort((p, q) => p.b - q.b);
  const onlyA = rows.filter((r) => r.a < 0.95 && r.b >= 0.95).sort((p, q) => p.a - q.a);
  const both = rows.filter((r) => r.a < 0.95 && r.b < 0.95).sort((p, q) => p.b - q.b);
  const row = (r) => `<div class="scr-row diff-row"><span><span class="linkish" data-gene="${esc(r.g)}">${esc(r.g)}</span></span><span class="val">${Math.round(100 * r.a)} % → ${Math.round(100 * r.b)} %</span><button class="link" data-ko="${esc(r.g)}" title="${esc(t("scr.addTitle"))}">✂</button></div>`;
  out.innerHTML = `<div class="note">${t("diff.geneSummary", { a: esc(A.name), b: esc(B.name), s: ((performance.now() - t0) / 1000).toFixed(1), onlyB: onlyB.length, onlyA: onlyA.length })}</div>`
    + (onlyB.length ? `<details class="scr-group sl-top" open><summary>${t("diff.slB", { b: esc(B.name) })} (${onlyB.length})</summary><div class="scr-list">${onlyB.map(row).join("")}</div></details>` : `<p class="meta">${t("diff.noNewGene", { b: esc(B.name) })}</p>`)
    + (onlyA.length ? `<details class="scr-group" open><summary>${t("diff.slA", { a: esc(A.name) })} (${onlyA.length})</summary><div class="scr-list">${onlyA.map(row).join("")}</div></details>` : "")
    + (both.length ? `<details class="scr-group"><summary>${t("diff.bothGene")} (${both.length})</summary><div class="scr-list">${both.map(row).join("")}</div></details>` : "");
  out.querySelectorAll("[data-ko]").forEach((b) => { b.onclick = () => addPerturb("gene", b.dataset.ko); });
  out.querySelectorAll("[data-gene]").forEach((b) => { b.onclick = () => { S.sel = { type: "gene", sym: b.dataset.gene }; renderDetails(); }; });
}

/**
 * Phase plane of one medium metabolite: the objective as its maximum uptake goes from 0 to about three times the
 * current one, with the stretches where the same bound limits the objective (its "regimes").
 */
async function phasePlane(m) {
  const out = $("ppOut"), f = frame();
  if (!out) return;
  if (S.mode !== "steady" || !f || f.status !== "optimal") { out.innerHTML = `<div class="note">${t("scr.needSteady")}</div>`; return; }
  const it = S.supplies.find((x) => x.met === m), e = S.sim.exchanges.get(m);
  const cap = it.unlimited ? Infinity : uptakeCapacity(it.conc, it.vmax, it.km), now = Math.max(0, f.v[e.rxn] * e.dir);
  const xmax = Math.min(cap, Math.max(3 * now, 0.05)), N = 24, xs = Array.from({ length: N + 1 }, (_, i) => (xmax * i) / N);
  const cfg = { ...S.cfg, measured: { items: S.measured.items.map((x) => ({ met: x.met, rate: x.rate })), tol: S.measured.tol, ngam: S.measured.ngam, trace: S.measured.trace },
    context: S.ctxBlock ? { id: S.context.id, mode: S.context.mode, block: S.ctxBlock } : undefined };
  out.innerHTML = `<p class="meta">${t("pp.busy")}</p>`;
  const seq = (S.ppSeq = (S.ppSeq || 0) + 1), sel = S.sel; // stop if the details panel moves on
  const pts = await S.sim.phasePlane(cfg, S.supplies, m, xs, (i, n) => { if ($("ppOut")) $("ppOut").innerHTML = `<p class="meta">${t("pp.progress", { i, n })}</p>`; setProgress(i / n); return S.sel === sel && S.ppSeq === seq; });
  setProgress(null);
  if (!$("ppOut") || S.sel !== sel || S.ppSeq !== seq) return;
  // regimes, from the curve itself: where it rises, the metabolite varied is what limits (its marginal value is the
  // slope); where it is flat, the bound that limits the objective there (most frequent over the stretch, since a
  // degenerate LP can name a different bound at each point)
  const name = S.model.bases[S.model.mets[m].b].n, ytop = Math.max(1e-12, ...pts.map((p) => p.objective));
  const segs = [];
  for (let i = 1; i < pts.length; i++) {
    const a0 = pts[i - 1], a1 = pts[i];
    let l;
    if (a0.status !== "optimal" || a1.status !== "optimal") l = t(S.measured.items.length ? "pp.infeasibleMeas" : "pp.infeasible");
    else {
      const slope = (a1.objective - a0.objective) / (a1.x - a0.x);
      l = slope > 1e-4 * ytop / (xmax || 1) ? t("pp.self", { n: name }) : a1.limit ? limitLabel(a1.limit, a1) : t("pp.none");
    }
    segs.push({ l, x0: a0.x, x1: a1.x, rise: l === t("pp.self", { n: name }) ? (a1.objective - a0.objective) / (a1.x - a0.x) : 0 });
  }
  const reg = [];
  for (const g of segs) { const last = reg.at(-1); if (last && last.l === g.l) { last.x1 = g.x1; last.rise.push(g.rise); } else reg.push({ l: g.l, x0: g.x0, x1: g.x1, rise: [g.rise] }); }
  for (const r of reg) if (r.l === t("pp.self", { n: name })) r.l += t("pp.slope", { x: fmtFlux(r.rise.reduce((s, x) => s + x, 0) / r.rise.length) });
  const W = 300, H = 150, P = { l: 40, r: 8, t: 8, b: 26 }, ymax = ytop * 1.05;
  const X = (x) => P.l + ((W - P.l - P.r) * x) / (xmax || 1), Y = (y) => H - P.b - ((H - P.t - P.b) * y) / ymax;
  let path = "", pen = false; // gaps where there is no solution
  for (const p of pts) { if (p.status !== "optimal") { pen = false; continue; } path += `${pen ? "L" : "M"}${X(p.x).toFixed(1)},${Y(p.objective).toFixed(1)}`; pen = true; }
  const shades = reg.map((r, i) => `<rect x="${X(r.x0)}" y="${P.t}" width="${Math.max(1, X(r.x1) - X(r.x0))}" height="${H - P.t - P.b}" fill="var(--panel2)" opacity="${i % 2 ? 0.9 : 0}"><title>${esc(r.l)}</title></rect>`).join("");
  const unit = isGrowthRxn(S.model.rxns[S.cfg.objective]) ? "h⁻¹" : "mmol/gDW/h";
  const svg = `<svg viewBox="0 0 ${W} ${H}" width="100%" role="img" aria-label="${esc(t("pp.button"))}" style="font-size:10px">
    ${shades}<line x1="${P.l}" y1="${H - P.b}" x2="${W - P.r}" y2="${H - P.b}" stroke="var(--line)"/><line x1="${P.l}" y1="${P.t}" x2="${P.l}" y2="${H - P.b}" stroke="var(--line)"/>
    <path d="${path}" fill="none" stroke="var(--accent)" stroke-width="2"/>
    ${now > 0 && now <= xmax ? `<line x1="${X(now)}" y1="${P.t}" x2="${X(now)}" y2="${H - P.b}" stroke="var(--hot)" stroke-dasharray="3 3"><title>${esc(t("pp.now"))}</title></line>` : ""}
    <text x="${P.l - 4}" y="${P.t + 8}" text-anchor="end" fill="var(--muted)">${fmtFlux(ymax / 1.05)}</text><text x="${P.l - 4}" y="${H - P.b}" text-anchor="end" fill="var(--muted)">0</text>
    <text x="${P.l}" y="${H - 8}" fill="var(--muted)">0</text><text x="${W - P.r}" y="${H - 8}" text-anchor="end" fill="var(--muted)">${fmtFlux(xmax)}</text>
    <text x="${(P.l + W - P.r) / 2}" y="${H - 2}" text-anchor="middle" fill="var(--muted)">${esc(t("pp.xAxis", { n: S.model.bases[S.model.mets[m].b].n }))}</text></svg>`;
  out.innerHTML = `<h4>${t("pp.head")}${small(t("pp.yAxis", { u: unit }))}</h4>${svg}<div class="pp-reg">${reg.map((r) => `<div><b>${fmtFlux(r.x0)}–${fmtFlux(r.x1)}</b>: ${esc(r.l)}</div>`).join("")}</div><p class="meta">${t("pp.note")}</p>`;
}

/**
 * Inside a pathway, with a cofactor chosen in "Lines": per reaction, how much of that cofactor it makes or uses
 * (|sum of coefficient x flux| over all compartments, so transports cancel out; redox carriers weighted in electron
 * pairs as in the global map). Reactions without the cofactor get 0 and are drawn as inactive. null otherwise.
 */
function cofactorRxnFlux(f, q) {
  const w = q === "redox" ? REDOX_PAIRS : COFACTOR_Q[q] ? Object.fromEntries(COFACTOR_Q[q].map((n) => [n, 1])) : null;
  if (!w || !f?.v) return null;
  const key = q + "|" + S.frameIdx;
  if (f.qfluxCache?.key === key) return f.qfluxCache.v;
  const { model } = S, out = new Float64Array(model.rxns.length);
  model.rxns.forEach((r, j) => {
    const v = f.v[j];
    if (!v) return;
    let net = 0;
    r.m.forEach((mi, k) => { const x = w[model.bases[model.mets[mi].b].n]; if (x) net += x * r.c[k]; });
    out[j] = Math.abs(net * v) < 1e-12 ? 0 : Math.abs(net * v);
  });
  f.qfluxCache = { key, v: out };
  return out;
}

/** Readable name of a limiting bound (from FbaProblem._limits). */
function limitLabel(L, f) {
  const { model } = S;
  if (L.j < 0) { const it = f?.srcItems?.[-1 - L.j]; return t("lim.injection", { n: it ? S.index.metName(it.met) : "?" }); }
  const ex = [...S.sim.exchanges].find(([, e]) => e.rxn === L.j);
  let txt;
  if (ex) {
    const n = model.bases[model.mets[ex[0]].b].n, upt = L.half * ex[1].dir > 0;
    txt = t(L.kind === "closed" ? "lim.exClosed" : L.kind === "ub" ? (upt ? "lim.maxUptake" : "lim.maxSecretion") : upt ? "lim.minUptake" : "lim.minSecretion", { n });
  } else {
    const n = model.rxns[L.j].n;
    txt = t(L.kind === "closed" ? "lim.closed" : L.kind === "ub" ? (L.half > 0 ? "lim.maxFwd" : "lim.maxRev") : L.half > 0 ? "lim.minFwd" : "lim.minRev", { n });
  }
  if (L.kind === "closed" && S.ctxBlock && (S.ctxBlockSet ??= new Set(S.ctxBlock)).has(L.j)) txt += t("lim.byCtx");
  else if (S.result?.pert?.has(L.j)) txt += t("lim.byKo");
  return txt;
}

/** Metabolites whose free supply would raise the objective most (shadow prices), one per value: the smallest molecule. */
function metValueHtml(f) {
  if (!f.metValue) return "";
  const { model } = S, nAtoms = (fm) => (fm || "").match(/\d+|[A-Z]/g)?.reduce((s, x) => s + (/\d/.test(x) ? +x - 1 : 1), 0) ?? 999;
  const groups = new Map();
  model.mets.forEach((m, i) => {
    const v = f.metValue[i];
    if (!(v > 1e-9) || m.removed) return;
    const b = model.bases[m.b];
    if (!/^([A-Z][a-z]?\d*)+$/.test(b.f || "")) return; // no formula: pools, macromolecules
    const key = v.toPrecision(4), cur = groups.get(key), size = nAtoms(b.f);
    if (!cur || size < cur.size || (size === cur.size && m.c === "c")) groups.set(key, { i, v, size, n: (cur?.n || 0) + 1 });
    else cur.n++;
  });
  const top = [...groups.values()].sort((a, b) => b.v - a.v).slice(0, 5);
  if (!top.length) return "";
  const mx = top[0].v;
  return `<h4>${t("sum.metValue")}${small(t("sum.metValueUnit"))}</h4>` + bars(top.map((g) => [S.index.metName(g.i) + (g.n > 1 ? " · " + t("sum.metValueMore", { n: g.n - 1 }) : ""), "+" + fmtFlux(g.v), `met:${g.i}`, g.v / mx]), "linear-gradient(90deg,#5fd38d,#ffbe3c)") + `<p class="meta">${t("sum.metValueNote")}</p>`;
}

/**
 * Energy and redox balance: which pathways produce and consume ATP, NADH and NADPH (all compartments summed, so
 * transports between compartments cancel out).
 */
const COFACTORS = { ATP: ["ATP"], NADH: ["NADH"], NADPH: ["NADPH"] };
function cofactorBalance(f, key) {
  const { model } = S, names = new Set(COFACTORS[key]);
  const byPath = new Map(), byRxn = [];
  let made = 0, used = 0;
  model.rxns.forEach((r, j) => {
    const v = f.v[j];
    if (!v || r.removed) return;
    let net = 0;
    r.m.forEach((mi, q) => { if (names.has(model.bases[model.mets[mi].b].n)) net += r.c[q] * v; });
    if (Math.abs(net) < 1e-9) return;
    if (net > 0) made += net; else used -= net;
    const o = byPath.get(r.ss) || { made: 0, used: 0 };
    if (net > 0) o.made += net; else o.used -= net;
    byPath.set(r.ss, o);
    byRxn.push([j, net]);
  });
  return { made, used, byPath, byRxn };
}
function cofactorHtml(f) {
  const key = S.cofTab || "ATP", b = cofactorBalance(f, key);
  if (!b.made && !b.used) return "";
  const rows = (sel, tot) => [...b.byPath].map(([ss, o]) => [ss, sel(o)]).filter(([, x]) => x > 1e-9).sort((a, c) => c[1] - a[1]).slice(0, 6)
    .map(([ss, x]) => [S.model.subsystems[ss], `${fmtFlux(x)} · ${Math.round((100 * x) / tot)} %`, `sub:${ss}`, x / tot]);
  return `<h4>${t("cof.title")}${small(t("cof.unit"))}</h4><div class="tabs cof-tabs">${Object.keys(COFACTORS).map((k) => `<button data-cof="${k}" class="${k === key ? "on" : ""}">${k}</button>`).join("")}</div>
    <div class="meta">${t("cof.total", { x: fmtFlux(b.made), c: key })}</div>
    <h5>${t("cof.made")}</h5>${bars(rows((o) => o.made, b.made), "#5fd38d")}<h5>${t("cof.used")}</h5>${bars(rows((o) => o.used, b.used), "#ff9f5a")}`;
}

/** A few plain sentences about the result, built from the same numbers as the panels below. */
function plainSummaryHtml(f) {
  const { model } = S, out = [], obj = model.rxns[S.cfg.objective];
  const growth = isGrowthRxn(obj);
  const val = growth ? t("ps.growth", { x: fmtFlux(f.objective) }) : t("ps.objective", { n: esc(obj.n), x: fmtFlux(f.objective) });
  out.push(f.limits?.length ? val + " " + t("ps.limit", { l: esc(limitLabel(f.limits[0], f)) }) : val);
  const ex = (name) => { for (const [mi, e] of S.sim.exchanges) if (model.bases[model.mets[mi].b].n === name) return f.v[e.rxn] * e.dir; return 0; };
  const glc = ex("glucose"), lac = -ex("L-lactate");
  if (glc > 1e-6 && lac > 1e-6) out.push(t("ps.lactate", { p: Math.min(100, Math.round((100 * lac) / (2 * glc))) }));
  for (const key of ["ATP", "NADPH"]) {
    const b = cofactorBalance(f, key);
    if (!(b.made > 1e-9)) continue;
    const top = [...b.byPath].filter(([, o]) => o.made > 0).sort((a, c) => c[1].made - a[1].made).slice(0, 2);
    out.push(t(key === "ATP" ? "ps.atp" : "ps.nadph", { list: top.map(([ss, o]) => `${esc(model.subsystems[ss])} (${Math.round((100 * o.made) / b.made)} %)`).join(t("ps.and")) }));
  }
  const prods = [];
  for (const [mi, e] of S.sim.exchanges) { const x = -f.v[e.rxn] * e.dir; if (x > 1e-6 && !S.index.currency[model.mets[mi].b] && model.bases[model.mets[mi].b].n !== "biomass") prods.push([model.bases[model.mets[mi].b].n, x]); }
  prods.sort((a, b) => b[1] - a[1]);
  if (prods.length) out.push(t("ps.secretes", { list: prods.slice(0, 3).map(([n, x]) => `${esc(n)} (${fmtFlux(x)})`).join(", ") }));
  const ctx = currentContext();
  if (ctx && S.ctxBlock) out.push(t("ps.context", { ctx: esc(ctx.name), n: S.ctxBlock.length }));
  if (f.relaxed) out.push(t("ps.relaxed"));
  return `<div class="plain"><b>${t("ps.title")}</b> ${out.join(" ")}</div>`;
}

/** The configuration of a steady-state run with everything in the left panel (shared by FVA, scans, design). */
function runCfg() {
  return { ...S.cfg, perturb: [...perturbActivities()], measured: { items: S.measured.items.map((x) => ({ met: x.met, rate: x.rate })), tol: S.measured.tol, ngam: S.measured.ngam, trace: S.measured.trace },
    context: S.ctxBlock ? { id: S.context.id, mode: S.context.mode, block: S.ctxBlock } : undefined };
}
const design = createDesign({ S, frame: () => frame(), opsKey: () => opsKey(), runCfg, fmtFlux, setProgress: (x) => setProgress(x),
  applyDocsLinks: (root) => root.querySelectorAll("a[data-docs]").forEach((a) => { a.href = `docs.html?lang=${docsLang()}#${docsLang()}-${a.dataset.docs}`; }) });

/** The tracer library (data/tracers.json) as a menu in the medium section: one click labels that nutrient. */
async function renderTracerLib() {
  const lib = await loadTracers(), sel = $("trLib");
  sel.textContent = "";
  sel.add(new Option(t("trl.pick"), ""));
  const groups = new Map();
  for (const tr of lib?.tracers || []) { if (!groups.has(tr.use)) groups.set(tr.use, []); groups.get(tr.use).push(tr); }
  for (const [use, trs] of groups) {
    const g = document.createElement("optgroup"); g.label = t("trl.use." + use);
    for (const tr of trs) g.appendChild(new Option(`${tr.name} · ${tr.item}`, tr.id));
    sel.appendChild(g);
  }
}
async function applyLibraryTracer(id) {
  const lib = await loadTracers(), tr = lib?.tracers.find((x) => x.id === id);
  if (!tr) return;
  const base = S.model.bases.findIndex((b) => b.n === tr.met), lab = base >= 0 ? tracerLabel(tr, S.structures[S.model.bases[base].id]) : null;
  const met = base >= 0 ? S.index.metsOfBase[base].find((m) => S.sim.exchanges.has(m)) : undefined;
  if (!lab || met === undefined) { setStatus(() => t("trl.cannot", { n: tr.name }), true); return; }
  const it = S.supplies.find((x) => x.met === met) || addSupply(met);
  it.label = lab.label; it.fraction = it.fraction || 1;
  renderSupplies(); changed();
  setStatus(() => t("trl.applied", { n: tr.name, item: tr.item }));
}

/** "What limits the objective": the bounds with the largest reduced cost in the FBA stage (js/core/fba.js). */
function limitsHtml(f) {
  if (!f.limits || Math.abs(f.objective) < 1e-12) return "";
  const { model } = S, exOf = new Map([...S.sim.exchanges].map(([met, e]) => [e.rxn, { met, dir: e.dir }]));
  const blocked = S.ctxBlock ? (S.ctxBlockSet ??= new Set(S.ctxBlock)) : null, pert = S.result?.pert;
  const rows = f.limits.slice(0, 6).map((L) => [limitLabel(L, f), L, L.j < 0 ? "" : `rxn:${L.j}`]);
  if (!rows.length) return "";
  const mx = rows[0][1].gain;
  return `<h4>${t("sum.limits")}${small(t("sum.limitsUnit"))}</h4>` + bars(rows.map(([n, L, k]) => [n, "+" + fmtFlux(L.gain), k, L.gain / mx]), "linear-gradient(90deg,#b48cff,#ff5d6c)") + `<p class="meta">${t("sum.limitsNote")}</p>`;
}

function summaryHtml() {
  const f = frame();
  if (!f) return `<div class="kind">${t("sum.title")}</div><h3>${esc(S.model.meta.name || S.model.meta.id)}</h3><p class="meta">${t("sum.computing")}</p>`;
  const { model } = S;
  const obj = model.rxns[S.cfg.objective];
  let active = 0;
  for (const x of f.v) if (x) active++;
  let vs = "";
  if (f.ref) {
    const r0 = f.ref.objective, pct = Math.abs(r0) > 1e-12 ? Math.round(100 * (f.objective / r0 - 1)) : 0;
    vs = `<div class="delta ${pct < 0 ? "down" : pct > 0 ? "up" : ""}">${pct > 0 ? "+" : ""}${pct} % ${f.ref.scen ? t("sum.vsScen", { name: esc(f.ref.scen.name), x: fmtFlux(r0) }) : t("sum.vsref", { x: fmtFlux(r0) })}</div>`;
  }
  let h = `<div class="kind">${t("sum.title")}${S.result.frames.length > 1 ? " · t = " + fmtTime(f.t) : ""}</div><h3>${esc($("modelSelect").selectedOptions[0]?.text || model.meta.id || "")}</h3><div class="meta">${esc(model.meta.name || "")}</div>
    <div class="cards">
      <div class="card"><div class="lbl">${t(isGrowthRxn(obj) ? "sum.growth" : "sum.objective")}</div><div class="big">${fmtFlux(f.objective)}<small><a class="unitlink" target="_blank" href="docs.html?lang=${docsLang()}#${docsLang()}-units" title="${esc(t(isGrowthRxn(obj) ? "unit.growthTip" : "unit.fluxTip"))}">${isGrowthRxn(obj) ? "h⁻¹" : "mmol/gDW/h"}</a></small></div>${vs}</div>
      ${S.cfg.secondary && f.status === "optimal" ? `<div class="card"><div class="lbl">${t("sum.secondary")}</div><div class="big">${fmtFlux(f.v[S.cfg.secondary.rxn])}<small>${isGrowthRxn(model.rxns[S.cfg.secondary.rxn]) ? "h⁻¹" : "mmol/gDW/h"}</small></div><div class="delta">${esc(model.rxns[S.cfg.secondary.rxn].n)} · ${t("sum.secKeep", { p: Math.round(100 * S.cfg.secondary.frac) })}</div></div>` : ""}
      <div class="card"><div class="lbl">${t("sum.active")}</div><div class="big">${active}<small>${t("sum.of", { n: model.rxns.length })}</small></div></div>
      ${f.biomass ? `<div class="card"><div class="lbl">${t("sum.biomass")}</div><div class="big">${f.biomass.toFixed(2)}<small>gDW/L</small></div></div>` : ""}
    </div>`;
  if (S.result.evList?.length) {
    h += `<h4>${t("sum.events")}</h4><div class="evlist">${S.result.evList.map((ev) => `<div class="${f.t > ev.t ? "done" : ""}">${esc(ev.type === "medium" ? t("sum.evMedium", { t: fmtTime(ev.t), name: mediumName(ev.mediumId) }) : t("sum.evAdd", { t: fmtTime(ev.t), c: ev.conc, name: eventName(ev) }))}</div>`).join("")}</div>`;
  }
  if (f.status !== "optimal") return h + `<div class="note">${t("sum.nosol", { why: esc(statusWhy(f.status)) })}</div>`;
  h += plainSummaryHtml(f);
  if (f.relaxed) h += `<div class="note">${t("sum.relaxed")}</div>`;
  if (Math.abs(f.objective) < 1e-9) h += `<div class="note">${t("sum.zero")}</div>`;
  if (f.ref) h += changedHtml(f);
  h += compare.summaryHtml(f);
  const fate = labelFate(f);
  if (fate) {
    h += `<h4>${t("sum.fate")}${small(t("sum.fateUnit"))}</h4>` +
      bars(fate.rows.slice(0, 10).map(([n, v, k]) => [n, (100 * v / fate.total).toFixed(1) + " %", k, v / fate.total]), `linear-gradient(90deg,${enrichColor(0.15)},${enrichColor(1)})`);
    if (fate.rest > fate.total * 0.005) h += `<div class="bar-row"><span class="nm" style="color:var(--muted)">${t("sum.rest")}</span><span class="val">${(100 * fate.rest / fate.total).toFixed(1)} %</span></div>`;
  } else if (!S.supplies.some(isLabelled)) {
    if (!f.ref) h += `<div class="note">${t("sum.noTracer")}</div>`;
  } else if (!f.e) {
    h += `<div class="note">${t("sum.tracerIdle")}</div>`;
  }
  const up = [], out = [];
  for (const [met, ex] of S.sim.exchanges) {
    const x = f.v[ex.rxn] * ex.dir;
    if (Math.abs(x) < 1e-9 || S.index.currency[model.mets[met].b]) continue;
    (x > 0 ? up : out).push([model.bases[model.mets[met].b].n, Math.abs(x), `met:${met}`]);
  }
  f.srcItems?.forEach((it, i) => { if (f.sourceFlux[i] > 1e-9) up.push([t("sum.injection", { n: S.index.metName(it.met) }), f.sourceFlux[i], `met:${it.met}`]); });
  const top = (arr, color) => { arr.sort((a, b) => b[1] - a[1]); const mx = arr.length ? arr[0][1] : 1; return bars(arr.slice(0, 8).map(([n, v, k]) => [n, fmtFlux(v), k, v / mx]), color); };
  h += limitsHtml(f);
  h += metValueHtml(f);
  h += cofactorHtml(f);
  h += `<h4>${t("sum.uptake")}${small("mmol/gDW/h")}</h4>${top(up, "#5fd38d") || '<p class="meta">—</p>'}`;
  h += `<h4>${t("sum.secretion")}</h4>${top(out, "#4cc9f0") || '<p class="meta">—</p>'}`;
  if (S.result.frames.length > 1) h += `<h4>${t("sum.medium")}${small(t("sum.mediumUnit"))}</h4>${concChart()}`;
  return h;
}

function concChart() {
  const frames = S.result.frames, n = frames.length;
  const added = new Set((S.result.evList || []).filter((ev) => ev.type === "add").map((ev) => ev.met));
  const pool = S.result.instant ? [...S.result.instant] : S.supplies.filter((it) => !it.unlimited && !it.hold).map((it) => it.met);
  // each component against its own maximum, so that additions and depletion read on one scale
  const items = pool.map((met) => {
    let mx = 0;
    for (const f of frames) mx = Math.max(mx, f.conc?.get(met) || 0);
    return { met, mx, end: mx ? (frames[n - 1].conc?.get(met) || 0) / mx : 1, added: added.has(met) ? 1 : 0 };
  }).filter((o) => o.mx > 0).sort((a, b) => b.added - a.added || a.end - b.end).slice(0, 6);
  const colors = ["#ffbe3c", "#4cc9f0", "#5fd38d", "#ff7eb6", "#b48cff", "#ff9f5a"];
  const W = 300, H = 120, px = (k) => 6 + (k / Math.max(1, n - 1)) * (W - 12), py = (y) => H - 8 - Math.min(1.05, y) * (H - 16);
  const lines = items.map((o, i) => `<polyline fill="none" stroke="${colors[i]}" stroke-width="1.6" points="${frames.map((f, k) => `${px(k).toFixed(1)},${py((f.conc?.get(o.met) || 0) / o.mx).toFixed(1)}`).join(" ")}"/>`).join("");
  const cur = `<line x1="${px(S.frameIdx)}" x2="${px(S.frameIdx)}" y1="4" y2="${H - 4}" class="chart-cursor" stroke="#fff" stroke-dasharray="3 3"/>`;
  return `<svg class="chart" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none">${eventMarks(px, H)}${lines}${cur}</svg>
    <div class="meta">${items.map((o, i) => `<span style="color:${colors[i]}">■</span> ${esc(S.model.bases[S.model.mets[o.met].b].n)}`).join(" &nbsp; ")}<br>${t(S.result.evList?.length ? "sum.logAxisEv" : "sum.logAxis", { a: fmtTime(frames[0].t), b: fmtTime(frames[n - 1].t) })}</div>`;
}

function metHtml(m) {
  const { model, index } = S, met = model.mets[m], base = model.bases[met.b], f = frame();
  const st = S.structures[base.id];
  const ids = [["KEGG", base.kegg, "https://www.kegg.jp/entry/"], ["HMDB", base.hmdb, "https://hmdb.ca/metabolites/"], ["ChEBI", base.chebi, "https://www.ebi.ac.uk/chebi/searchId.do?chebiId="]]
    .filter((x) => x[1]).map(([k, v, url]) => `<a href="${url}${encodeURIComponent(v)}" target="_blank" rel="noopener">${k} ${esc(v)}</a>`).join(" · ");
  let h = `<div class="kind">${t("met.kind")}</div><h3>${esc(base.n)}</h3>
    <div class="meta">${esc(base.f || t("met.noFormula"))} · ${esc(met.id)}${ids ? "<br>" + ids : ""}</div>
    <div class="tabs">${index.metsOfBase[met.b].filter((x) => !model.mets[x].removed).map((x) => `<button class="${x === m ? "on" : ""}" data-go="met:${x}">${esc(compName(model.mets[x].c))}</button>`).join("")}</div>`;
  if (MTB.result?.fcByBase.has(met.b)) {
    const fc = MTB.result.fcByBase.get(met.b), q = MTB.result.qByBase.get(met.b) ?? 1;
    const qs = q < 1e-4 ? q.toExponential(0) : q.toFixed(3);
    h += `<div class="note">${t("mtb.metLine", { fc: `${fc > 0 ? "+" : ""}${fc.toFixed(2)}`, fold: `×${Math.pow(2, fc).toFixed(2)}`, q: qs })}</div>`;
  }
  if (met.user || base.user) h += `<div class="note edtag">${t(base.user ? "ed.tagNewMet" : "ed.tagNewComp")}</div>`;
  if (st) {
    const en = f?.e ? S.sim.tracer.atomsEnrichment({ e: f.e }, m) : null;
    h += `<div class="molbox" id="detMol"></div>`;
    if (en) h += `<div class="meta">${t("met.meanEnrich", { x: `<b style="color:var(--hot)">${(100 * f.metE[m]).toFixed(1)} %</b>` })}</div>`;
    if (f?.uncertain?.[m]) h += `<div class="note">${t("met.uncertain")}</div>`;
  } else {
    h += `<div class="note">${t("met.noStruct")}${f?.metE ? t("met.noStructLabel", { x: (100 * f.metE[m]).toFixed(1) }) : ""}.</div>`;
  }
  if (f?.e) h += `<h4>${t("mid.title")}${small(t("mid.unit"))}</h4><div id="detMid"></div>`;
  else {
    // without a tracer: what a mass spectrometer would see anyway, from natural isotope abundance
    const nat = naturalMid(base.f);
    if (nat) h += `<h4>${t("mid.title")}${small(t("mid.natural"))}</h4>${midBars(nat.dist, 1)}<div class="meta" style="margin-top:6px">${t("mid.naturalCaption", { f: esc(base.f) })}${nat.ignored.length ? " " + t("mid.naturalIgnored", { els: esc(nat.ignored.join(", ")) }) : ""}</div>`;
  }
  const D = depths(), d = D.depth[m];
  h += `<div class="meta">${index.currency[met.b] ? t("met.depthCur") : d < 0 ? t("met.depthNone") : d === 0 ? t("met.depth0") : t("met.depth", { d, p: Math.round((100 * d) / Math.max(1, D.max)) })}</div>`;
  if (f?.metValue && f.status === "optimal") h += `<div class="meta" title="${esc(t("met.valueTitle"))}">${t("met.value", { x: `<b>${fmtFlux(f.metValue[m])}</b>` })}</div>`;
  const ppMet = S.supplies.find((it) => S.model.mets[it.met].b === met.b && S.sim.exchanges.has(it.met))?.met; // its medium form
  h += `<div class="actions"><button data-act="supply">${t("met.addSupply")}</button><button data-act="label">${t("met.label")}</button>${ppMet !== undefined ? `<button data-act="phase" title="${esc(t("pp.title"))}">${t("pp.button")}</button>` : ""}</div><div id="ppOut"></div>`;
  if (S.editMode) h += `<div class="actions edit"><button data-act="newRxnMet">${t("ed.act.newRxnMet")}</button><button data-act="newComp">${t("ed.act.newComp")}</button><button data-act="removeMet" class="danger">${t("ed.act.removeMet")}</button></div>`;
  if (f?.ref?.scen) h += `<div id="detCmp"></div>`;
  const prod = [], cons = [];
  for (let p = index.rxnStart[m]; p < index.rxnStart[m + 1]; p++) {
    const j = index.rxnList[p], x = f ? f.v[j] * index.rxnCoef[p] : 0;
    if (model.rxns[j].removed) continue;
    if (x > 1e-9) prod.push([model.rxns[j].n, x, `rxn:${j}`]); else if (x < -1e-9) cons.push([model.rxns[j].n, -x, `rxn:${j}`]);
  }
  const top = (arr, color) => { arr.sort((a, b) => b[1] - a[1]); const mx = arr.length ? arr[0][1] : 1; return bars(arr.slice(0, 10).map(([n, v, k]) => [n, fmtFlux(v), k, v / mx]), color); };
  if (prod.length || cons.length) {
    h += `<h4>${t("met.producedBy")}</h4>${top(prod, "#5fd38d") || '<p class="meta">—</p>'}<h4>${t("met.consumedBy")}</h4>${top(cons, "#4cc9f0") || '<p class="meta">—</p>'}`;
  } else {
    const n = index.rxnStart[m + 1] - index.rxnStart[m];
    h += `<h4>${t("met.rxns", { n })}${small(t("met.noFlux"))}</h4>` +
      Array.from(index.rxnList.subarray(index.rxnStart[m], index.rxnStart[m + 1])).filter((j) => !model.rxns[j].removed).slice(0, 12).map((j) => `<div class="bar-row" data-go="rxn:${j}"><span class="nm">${esc(model.rxns[j].n)}</span><span class="val">${model.rxns[j].id}</span></div>`).join("");
  }
  return h;
}

const sampler = (f) => f.sampler || (f.sampler = new IsotopologueSampler(S.sim.tracer, S.index, f.v, f.inputs, f.e, f.elements));

/** Bar chart of a mass distribution; trailing isotopologues below 0.2 % are cut. */
function midBars(full, dec) {
  let last = full.length - 1;
  while (last > 1 && full[last] < 0.002) last--;
  const dist = full.slice(0, last + 1), every = dist.length > 14 ? Math.ceil(dist.length / 10) : 1;
  return `<div class="mid">${dist.map((p, k) => `<div class="col" title="M+${k}: ${(100 * p).toFixed(dec + 1)} %">${p >= 0.03 && dist.length <= 14 ? `<span style="bottom:${(100 * p).toFixed(1)}%">${(100 * p).toFixed(p < 0.995 ? dec : 0)}</span>` : ""}<i style="height:${(100 * p).toFixed(1)}%"></i></div>`).join("")}</div>
    <div class="mid-axis">${dist.map((_, k) => `<span>${k % every ? "" : dist.length > 9 ? k : "M+" + k}</span>`).join("")}</div>`;
}

/** Bars of the mass isotopologue distribution of a metabolite (steady state with a tracer). */
function midHtml(f, m) {
  const cache = f.mids || (f.mids = new Map());
  let r = cache.get(m);
  if (r === undefined) cache.set(m, (r = sampler(f).mid(m, 2000, 220)));
  if (!r) return `<p class="meta">${t("mid.none")}</p>`;
  return `${natToggle()}${midBars(midShown(r.dist, m, f), 0)}
    <div class="meta" style="margin-top:6px">${t(S.natAb ? "mid.captionNat" : "mid.caption", { n: r.n })}</div>${r.approx > 0.1 ? `<div class="note">${t("mid.approx", { p: Math.round(100 * r.approx) })}</div>` : ""}`;
}

/** The isotopologue distribution as shown: with natural abundance added when the user asks for it. */
function midShown(dist, m, f) {
  if (!S.natAb) return dist;
  const els = f?.elements || S.result?.frames.find((x) => x.elements)?.elements || [];
  return withNaturalAbundance(dist, S.model.bases[S.model.mets[m].b].f, new Set(els)) || dist;
}
const natToggle = () => `<label class="nat-tg" title="${esc(t("mid.natTitle"))}"><input type="checkbox" data-natab${S.natAb ? " checked" : ""}> ${t("mid.natToggle")}</label>`;

/** Time-aware sampler of the finished dynamic run (null while it is still running or without label). */
function dynSampler() {
  const R = S.result;
  if (!R || !R.instant || R.frames.length < 2) return null;
  const els = R.frames.find((f) => f.e)?.elements;
  if (!els) return null;
  return R.dynS || (R.dynS = IsotopologueSampler.dynamic(S.sim.tracer, S.index, R.frames, els, R.dyn.pool, R.instant));
}

function midDynHtml(m) {
  const R = S.result, fi = Math.min(S.frameIdx, R.frames.length - 1), cache = R.midCache || (R.midCache = new Map()), key = fi + ":" + m;
  let r = cache.get(key);
  // 2000 molecules also while the animation plays: fewer made 2-3 % isotopologues flicker between frames
  if (r === undefined) cache.set(key, (r = dynSampler().mid(m, 2000, 220, fi)));
  if (!r) return `<p class="meta">${t("mid.none")}</p>`;
  return `${natToggle()}${midBars(midShown(r.dist, m, R.frames[fi]), 0)}
    <div class="meta" style="margin-top:6px">${t("mid.dynCaption", { n: r.n, t: fmtTime(R.frames[fi].t) })}</div>${r.approx > 0.1 ? `<div class="note">${t("mid.approx", { p: Math.round(100 * r.approx) })}</div>` : ""}
    <div class="midtime" id="midTime">${R.midTime?.has(m) ? midTimeSvg(R.midTime.get(m)) : `<button data-act="midTime">${t("mid.overTime")}</button>`}</div>`;
}

const MID_COLORS = ["#3987e5", "#d95926", "#199e70", "#c98500", "#d55181", "#9085e9", "#e66767", "#8fa3c8"];

/** Isotopologue fractions of one metabolite at up to 30 time points of the run. */
async function midTimeSeries(m) {
  const R = S.result, ds = dynSampler(), n = R.frames.length, step = Math.max(1, Math.ceil(n / 30)), idx = [];
  for (let i = 0; i < n; i += step) idx.push(i);
  if (idx[idx.length - 1] !== n - 1) idx.push(n - 1);
  const dists = [];
  for (const i of idx) {
    const r = R.frames[i].e ? ds.mid(m, 600, 60, i) : null;
    dists.push(r ? r.dist : null);
    if (dists.length % 4 === 0) await new Promise((res) => setTimeout(res, 0));
  }
  const len = dists.reduce((a, d) => Math.max(a, d ? d.length : 0), 0);
  // before any label everything is M+0
  return { idx, dists: dists.map((d) => d || Array.from({ length: len }, (_, k) => (k ? 0 : 1))), len };
}

function midTimeSvg(ts) {
  const n = S.result.frames.length, W = 300, H = 130;
  const px = (k) => 6 + (k / Math.max(1, n - 1)) * (W - 12), py = (y) => H - 8 - y * (H - 16);
  const top = Array.from({ length: ts.len }, (_, k) => [k, Math.max(...ts.dists.map((d) => d[k] || 0))]).filter((x) => x[1] > 0.03).sort((a, b) => b[1] - a[1]).slice(0, 7).map((x) => x[0]).sort((a, b) => a - b);
  const lines = top.map((k, i) => `<polyline fill="none" stroke="${MID_COLORS[i]}" stroke-width="1.8" stroke-linejoin="round" points="${ts.idx.map((fi, q) => `${px(fi).toFixed(1)},${py(ts.dists[q][k] || 0).toFixed(1)}`).join(" ")}"/>`).join("");
  const cur = `<line x1="${px(S.frameIdx)}" x2="${px(S.frameIdx)}" y1="4" y2="${H - 4}" class="chart-cursor" stroke="#fff" stroke-dasharray="3 3"/>`;
  return `<svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none">${eventMarks(px, H)}${lines}${cur}</svg>
    <div class="meta" style="margin-top:4px">${top.map((k, i) => `<span style="color:${MID_COLORS[i]}">■</span> M+${k}`).join(" &nbsp; ")}<br>${t("mid.timeCaption")}</div>`;
}

/** Isotopologue distribution of the current result (cached; same sampling as the panel bars). */
function currentMid(f, m) {
  if (S.result.frames.length === 1) {
    const cache = f.mids || (f.mids = new Map());
    if (!cache.has(m)) cache.set(m, sampler(f).mid(m, 2000, 220));
    return cache.get(m);
  }
  const ds = dynSampler();
  if (!ds) return null;
  const R = S.result, fi = Math.min(S.frameIdx, R.frames.length - 1), cache = R.midCache || (R.midCache = new Map()), key = fi + ":" + m;
  if (!cache.has(key)) cache.set(key, ds.mid(m, 2000, 220, fi));
  return cache.get(key);
}

/** Fill the isotopologue box of the metabolite panel (sampling takes up to a few hundred ms). */
function fillMid(box, f, m) {
  if (S.result.frames.length === 1) { setTimeout(() => { if (box.isConnected) box.innerHTML = midHtml(f, m); }, f.mids?.has(m) ? 0 : 30); return; }
  if (!dynSampler()) { box.innerHTML = `<p class="meta">${t("mid.pending")}</p>`; return; }
  const paint = () => {
    if (!box.isConnected) return;
    box.innerHTML = midDynHtml(m);
    const btn = box.querySelector('[data-act="midTime"]');
    if (btn) btn.onclick = async () => {
      btn.disabled = true; btn.textContent = t("mid.computing");
      const R = S.result, ts = await midTimeSeries(m);
      if (R !== S.result) return;
      (R.midTime || (R.midTime = new Map())).set(m, ts);
      if (box.isConnected) paint();
    };
  };
  if (S.result.midCache?.has(Math.min(S.frameIdx, S.result.frames.length - 1) + ":" + m)) paint(); else setTimeout(paint, 30);
}

/** dG'm line of the reaction card: value, uncertainty and, when it runs, the direction it runs in. */
function dgHtml(j, v) {
  const D = S.flowData, r = S.model.rxns[j];
  if (!D.hasDG || r.m.length < 2) return "";
  const g = D.dG[j];
  if (!Number.isFinite(g)) return `<dt>ΔG′<sub>m</sub></dt><dd>${t(r.user ? "dg.noneUser" : "dg.none")}</dd>`;
  const sd = D.dGsd[j], run = v ? Math.sign(v) * g : null;
  let h = `${g > 0 ? "+" : ""}${g.toFixed(1)} ± ${sd.toFixed(1)} kJ/mol${small(t("dg.forward"))}`;
  if (run !== null) h += `<br>${t(run > 5 ? "dg.runUp" : run < -5 ? "dg.runDown" : "dg.runEq", { x: (run > 0 ? "+" : "") + run.toFixed(1), w: fmtFlux(-v * g) })}`;
  if (sd > 20) h += `<br><span style="color:var(--muted)">${t("dg.uncertain")}</span>`;
  // impossible directions: more than +100 kJ/mol even at the low end of the estimate, which no concentrations
  // can overcome. Either the only direction the model allows (written backwards or with a wrong stoichiometry in the source
  // model, or written with free FAD as the acceptor), or the direction the flux takes.
  const only = r.lb >= 0 && r.ub > 0 ? 1 : r.ub <= 0 && r.lb < 0 ? -1 : 0, bad = (s) => s * g - 2 * sd > IMPOSSIBLE_DG;
  const warn = (k, s) => `<br><span class="err">⚠ ${t(k, { x: "+" + (s * g).toFixed(0) })}</span>`;
  if (only && bad(only)) {
    const names = new Set(r.m.map((m) => S.model.bases[S.model.mets[m].b].n));
    h += warn(names.has("FAD") && names.has("FADH2") ? "dg.impossibleFad" : "dg.impossible", only);
  } else if (run !== null && bad(Math.sign(v))) h += warn("dg.runImpossible", Math.sign(v));
  return `<dt>ΔG′<sub>m</sub></dt><dd>${h}</dd>`;
}

function rxnHtml(j) {
  const { model, index } = S, r = model.rxns[j], f = frame(), v = f ? f.v[j] : 0;
  const am = S.atommaps[r.id];
  const side = (sign) => r.m.map((m, q) => (r.c[q] * sign > 0 ? `${Math.abs(r.c[q]) !== 1 ? +Math.abs(r.c[q]).toPrecision(3) + " " : ""}<span class="linkish" data-go="met:${m}">${esc(index.metName(m))}</span>` : null)).filter(Boolean).join(" + ");
  const rev = r.lb < 0 && r.ub > 0;
  const eq = v < 0 ? `${side(1)} → ${side(-1)}` : `${side(-1)} ${rev && !v ? "⇌" : "→"} ${side(1)}`;
  let mapTxt = t("rxn.mapNone");
  if (r.m.length < 2) mapTxt = t("rxn.mapExchange");
  else if (am) {
    const kind = { id: t("rxn.mapId"), map: "RXNMapper", mcs: t("rxn.mapMcs"), part: t("rxn.mapPart"), user: t("ed.map.k.user"), inherit: t("ed.map.k.inherit", { id: am.from || "" }) }[am.k] || am.k;
    mapTxt = am.cur ? t("rxn.mapCurated") : `${kind}${am.c != null && am.k === "map" ? t("rxn.mapConf", { x: (+am.c).toFixed(2) }) : ""}${am.p ? t("rxn.mapIncomplete") : ""}`;
  }
  const act = S.result?.pert?.get(j);
  let note = "";
  if (act !== undefined) {
    note = `<div class="note" style="border-left-color:var(--danger)">${t("pert.active", { x: Math.round(100 * act) })}</div>`;
    if (act > 0 && f?.ref && Math.abs(f.ref.v[j]) <= 1e-9) note += `<div class="note">${t("pert.kdNoRef")}</div>`;
  }
  if (S.ctxBlock && S.ctxBlock.includes(j)) {
    const ctx = currentContext(), genes = offGenesOf(r.g, offGenes(ctx, S.base.model.genes));
    note += `<div class="note ctxnote">${t(S.context.mode === "penalty" ? "ctx.rxnPenal" : "ctx.rxnBlocked", { ctx: esc(ctx.name), genes: esc(genes.join(", ")) })}</div>`;
  } else if (S.ctxBlock && S.context.mode === "complex" && r.g) {
    // kept by the majority rule although some subunits (or mitochondrially encoded genes) are not detected
    const ctx = currentContext(), genes = offGenesOf(r.g, offGenes(ctx, S.base.model.genes));
    if (genes.length) note += `<div class="note ctxnote">${t("ctx.rxnKept", { ctx: esc(ctx.name), genes: esc(genes.join(", ")) })}</div>`;
  }
  let mtbKv = "";
  if (MTB.result) {
    const step = MTB.result.stepByRxn?.get(j);
    const dir = step ? step.direction : (v < -1e-9 ? -1 : 1);
    const ddg = deltaDeltaG(model, j, MTB.result.fcByBase, { direction: dir });
    const ddgTxt = ddg ? t(ddg.partial ? "mtb.ddgPartial" : "mtb.ddg", { x: (ddg.ddg > 0 ? "+" : "") + ddg.ddg.toFixed(1), m: ddg.measured, n: ddg.total }) : "";
    const obsTxt = MTB.result.obsRxns.has(j) ? t("mtb.rxnObs") : t("mtb.rxnUnobs");
    mtbKv = `<dt>${t("h.mtb")}</dt><dd>${obsTxt}${ddgTxt ? `<br>${ddgTxt}` : ""}</dd>`;
  }
  const tag = r.user ? t("ed.tagNewRxn") : r.edited ? t("ed.tagEditedRxn") : "";
  return `<div class="kind">${t("rxn.kind")}</div><h3>${esc(r.n)}</h3>${tag ? `<div class="note edtag">${tag}</div>` : ""}
    <div class="meta">${r.id} · <span class="linkish" data-go="sub:${r.ss}">${esc(model.subsystems[r.ss])}</span></div>
    <div class="cards"><div class="card"><div class="lbl">${t("rxn.flux")}</div><div class="big">${fmtFlux(v)}<small>mmol/gDW/h</small></div>${f?.ref ? `<div class="delta">${f.ref.scen ? esc(f.ref.scen.name) : t("rxn.ref")}: ${fmtFlux(f.ref.v[j])}</div>` : ""}</div>
    <div class="card"><div class="lbl">${t("rxn.bounds")}</div><div style="margin-top:6px">${fmtFlux(r.lb)} … ${fmtFlux(r.ub)}<br><span style="color:var(--muted);font-size:12px">${t(rev ? "rxn.reversible" : "rxn.irreversible")}</span></div></div></div>
    ${note}<div class="eq">${eq}</div>
    <dl class="kv">
      ${r.g ? `<dt>${t("rxn.genes")}</dt><dd>${esc(r.g)}</dd>` : ""}
      ${r.ec ? `<dt>EC</dt><dd>${esc(r.ec.join(", "))}</dd>` : ""}
      ${r.kegg ? `<dt>KEGG</dt><dd><a href="https://www.kegg.jp/entry/${encodeURIComponent(r.kegg)}" target="_blank" rel="noopener">${esc(r.kegg)}</a></dd>` : ""}
      ${r.rhea ? `<dt>Rhea</dt><dd>${esc(r.rhea)}</dd>` : ""}
      <dt>${t("rxn.atommap")}</dt><dd>${mapTxt}</dd>
      ${dgHtml(j, v)}
      ${mtbKv}
    </dl>
    <div class="actions"><button data-act="perturb">${t("pert.button")}</button><button data-act="objective">${t("rxn.useObjective")}</button><button data-act="fva" title="${t("rxn.fvaTitle")}">${t("rxn.fva")}</button></div><div id="fvaOut"></div>
    ${S.editMode ? `<div class="actions edit"><button data-act="editRxn">${t(r.user ? "ed.act.editAdded" : "ed.act.editRxn")}</button><button data-act="copyRxn">${t("ed.act.copyRxn")}</button><button data-act="removeRxn" class="danger">${t(r.user ? "ed.act.dropRxn" : "ed.act.removeRxn")}</button></div>` : ""}`;
}

/** Shared body of the pathway and cell-group panels. */
function rxnListHtml(kind, title, rxns, ss, canOpen) {
  const { model } = S, f = frame();
  const rows = rxns.map((j) => [model.rxns[j].n, f ? Math.abs(f.v[j]) : 0, `rxn:${j}`]).sort((a, b) => b[1] - a[1]);
  const act = rows.filter((r) => r[1] > 0);
  const mx = act.length ? act[0][1] : 1;
  return `<div class="kind">${esc(kind)}</div><h3>${esc(title)}</h3>
    <div class="meta">${t("sub.meta", { n: rows.length, a: act.length })}${drawable(ss) ? "" : t("sub.listOnly")}</div>
    ${canOpen ? `<div class="actions"><button data-act="open">${t("sub.open")}</button></div>` : ""}
    <h4>${t("sub.top")}</h4>${bars(act.slice(0, 14).map(([n, v, k]) => [n, fmtFlux(v), k, v / mx]), "#4cc9f0") || `<p class="meta">${t("sub.none")}</p>`}
    ${ss >= 0 ? flexHtml(ss, rxns) : ""}`;
}

// ------------------------------------------------------ flux flexibility (FVA per pathway) ----
/** Class of a flux range: fixed / zero / required (always used, amount varies) / optional / loop (reaches ±1000). */
function fvaClass(lo, hi) {
  if (Math.max(Math.abs(lo), Math.abs(hi)) >= 999) return "loop";
  if (Math.abs(hi - lo) <= 1e-6 * Math.max(1, Math.abs(hi), Math.abs(lo))) return Math.abs(lo) < 1e-9 ? "zero" : "fixed";
  return lo > 1e-9 || hi < -1e-9 ? "required" : "optional";
}
const FVA_ORDER = ["fixed", "required", "optional", "loop", "zero"];
const flexFor = (ss) => (S.flex && S.flex.result === S.result && S.flex.frameIdx === S.frameIdx && S.flex.ss === ss ? S.flex : null);

function flexHtml(ss, rxns) {
  const fx = flexFor(ss);
  const sel = `<select id="flexFrac" title="${esc(t("flex.fracTitle"))}">${[1, 0.99, 0.95].map((x) => `<option value="${x}"${(S.flexFrac || 1) === x ? " selected" : ""}>${Math.round(x * 100)} %</option>`).join("")}</select>`;
  const cyc = `<label class="fx-cyc" title="${esc(t("flex.cyclesTitle"))}"><input type="checkbox" id="flexCycles"${S.flexCycles === false ? "" : " checked"}> ${t("flex.cycles")}</label>`;
  let h = `<h4>${t("flex.title")}</h4><div class="row">${sel}${cyc}<button data-flex="${ss}" class="link" title="${esc(t("flex.btnTitle"))}">${t(fx ? "flex.again" : "flex.button")}</button> <a class="link" data-docs="flex" target="_blank">${t("obj.help")}</a></div><div id="flexOut">`;
  if (fx) {
    const f = frame(), cnt = {};
    let tot = 0, fixed = 0;
    for (const j of rxns) { const c = fx.map.get(j)?.cls; if (!c) continue; cnt[c] = (cnt[c] || 0) + 1; const v = Math.abs(f.v[j]); tot += v; if (c === "fixed") fixed += v; }
    h += `<div class="meta">${t("flex.summary", { p: tot > 0 ? Math.round((100 * fixed) / tot) : 0, frac: Math.round(fx.frac * 100) })}${fx.cycles ? " " + t("flex.noCycles") : ""}<br>${FVA_ORDER.filter((c) => cnt[c]).map((c) => `<span class="fx-dot fx-${c}"></span>${t("flex.c." + c)}: ${cnt[c]}`).join(" · ")}</div>`;
    const rows = rxns.filter((j) => fx.map.has(j) && fx.map.get(j).cls !== "zero").sort((a, b) => FVA_ORDER.indexOf(fx.map.get(a).cls) - FVA_ORDER.indexOf(fx.map.get(b).cls) || Math.abs(f.v[b]) - Math.abs(f.v[a]));
    h += `<div class="scr-list">${rows.map((j) => { const r = fx.map.get(j); return `<div class="fx-row" data-go="rxn:${j}"><span class="fx-dot fx-${r.cls}" title="${esc(t("flex.c." + r.cls))}"></span><span class="nm">${esc(S.model.rxns[j].n)}</span><span class="val">${fmtFlux(r.lo)} … ${fmtFlux(r.hi)}</span></div>`; }).join("")}</div>`;
  }
  return h + "</div>";
}

/** FVA of every reaction of a pathway, in batches, then redraw the map with the classes. */
async function computeFlex(ss) {
  const out = $("flexOut"), f = frame();
  if (!out) return;
  if (S.mode !== "steady" || !f || f.status !== "optimal") { out.innerHTML = `<div class="note">${t("rxn.fvaSteady")}</div>`; return; }
  const frac = S.flexFrac || 1, rxns = S.index.rxnsOfSub[ss].filter((j) => !S.model.rxns[j].removed), result = S.result;
  const cfg = { ...S.cfg, perturb: [...perturbActivities()], measured: { items: S.measured.items.map((x) => ({ met: x.met, rate: x.rate })), tol: S.measured.tol, ngam: S.measured.ngam, trace: S.measured.trace },
    context: S.ctxBlock ? { id: S.context.id, mode: S.context.mode, block: S.ctxBlock } : undefined };
  const map = new Map(), t0 = performance.now(), B = 20;
  for (let i = 0; i < rxns.length; i += B) {
    if ($("flexOut")) $("flexOut").innerHTML = `<p class="meta">${t("flex.progress", { i, n: rxns.length, s: Math.round((performance.now() - t0) / 1000) })}</p>`;
    setProgress(i / rxns.length);
    const part = rxns.slice(i, i + B), r = await S.sim.fluxRanges(cfg, S.supplies, part, f.ref?.v, { frac, cycles: S.flexCycles === false ? null : 0.05 });
    if (S.result !== result) { setProgress(null); return; } // a new simulation replaced the one being analysed
    if (!r.ranges) { if ($("flexOut")) $("flexOut").innerHTML = `<div class="note">${t("sum.nosol", { why: esc(statusWhy(r.status)) })}</div>`; setProgress(null); return; }
    part.forEach((j, k) => { const [lo, hi] = r.ranges[k]; map.set(j, { lo, hi, cls: fvaClass(lo, hi) }); });
  }
  S.flex = { ss, frac, map, result, frameIdx: S.frameIdx, cycles: S.flexCycles !== false };
  setProgress(null);
  applyFrame(); renderDetails();
}

/** Reactions that change most between the two ends of a flexible reaction's range: what can stand in for it. */
async function fvaAlternatives(j) {
  const box = $("fvaAlt");
  if (!box) return;
  box.innerHTML = `<p class="meta">${t("flex.altBusy")}</p>`; setProgress(true);
  const f = frame(), cfg = { ...S.cfg, perturb: [...perturbActivities()], measured: { items: S.measured.items.map((x) => ({ met: x.met, rate: x.rate })), tol: S.measured.tol, ngam: S.measured.ngam, trace: S.measured.trace },
    context: S.ctxBlock ? { id: S.context.id, mode: S.context.mode, block: S.ctxBlock } : undefined };
  const r = await S.sim.fluxRanges(cfg, S.supplies, [j], f.ref?.v, { frac: S.flexFrac || 1, solutions: true, cycles: S.flexCycles === false ? null : 0.05 }).finally(() => setProgress(null));
  if (!$("fvaAlt") || S.sel?.rxn !== j) return;
  const [vmin, vmax] = r.solutions?.[0] || [];
  if (!vmin || !vmax) { $("fvaAlt").innerHTML = `<p class="meta">—</p>`; return; }
  const diff = [];
  for (let k = 0; k < vmin.length; k++) if (k !== j && !S.sim.exchangeRxns?.has?.(k)) { const d = vmax[k] - vmin[k]; if (Math.abs(d) > 1e-6) diff.push([k, d]); }
  diff.sort((a, b) => Math.abs(b[1]) - Math.abs(a[1]));
  const dj = vmax[j] - vmin[j], mx = diff.length ? Math.abs(diff[0][1]) : 1;
  $("fvaAlt").innerHTML = `<h4>${t("flex.altTitle")}${small(t("flex.altUnit"))}</h4>` + bars(diff.slice(0, 8).map(([k, d]) => [S.model.rxns[k].n + " · " + S.model.subsystems[S.model.rxns[k].ss], `${d > 0 ? "+" : ""}${fmtFlux(d)}`, `rxn:${k}`, Math.abs(d) / mx]), "linear-gradient(90deg,#b48cff,#4cc9f0)", true)
    + `<p class="meta">${t("flex.altNote", { d: fmtFlux(dj) })}</p>`;
}

const subHtml = (ss) => rxnListHtml(t("sub.kind"), S.model.subsystems[ss], S.index.rxnsOfSub[ss], ss, S.view.ss !== ss);

function grpHtml(g) {
  const grp = cellLayout().groups[g];
  return rxnListHtml(locName(grp.loc), S.model.subsystems[grp.ss], grp.rxns, grp.ss, S.view.kind === "global");
}

function geneHtml(ref) {
  const { model } = S, f = frame();
  const g = model.genes.find((x) => x[1] === ref || x[0] === ref);
  const rx = S.search.geneRxns.get(ref) || [];
  const rows = rx.map((j) => [model.rxns[j].n, f ? Math.abs(f.v[j]) : 0, `rxn:${j}`]).sort((a, b) => b[1] - a[1]);
  const mx = rows.length && rows[0][1] ? rows[0][1] : 1;
  const ctx = currentContext();
  const ctxNote = ctx ? `<div class="note ctxnote">${t(offGenes(ctx, S.base.model.genes).has(g ? g[1] : ref) ? "ctx.geneOff" : ctx.rescued.some(([k]) => S.base.model.genes[k][1] === (g ? g[1] : ref)) ? "ctx.geneRescued" : "ctx.geneOn", { ctx: esc(ctx.name) })}</div>` : "";
  return `<div class="kind">${t("gene.kind")}</div><h3>${esc(geneSymbol(ref))}</h3><div class="meta">${g ? esc(g[2] || "") + "<br>" + esc(g[0]) : ""}</div>${ctxNote}
    <div class="actions"><button data-act="perturb">${t("pert.button")}</button></div>
    <p class="meta">${t("gene.mapHint")}</p>
    <h4>${t("gene.rxns", { n: rows.length })}</h4>${bars(rows.slice(0, 40).map(([n, v, k]) => [n, fmtFlux(v), k, v / mx]), "#b48cff")}`;
}

function renderDetails() {
  const box = $("details"), sel = S.sel;
  if (!S.model) return;
  map.marks = sel?.type === "gene" ? new Set(S.search.geneRxns.get(sel.sym) || []) : (REG.markedRxns || null);
  box.innerHTML = !sel ? summaryHtml() : sel.type === "met" ? metHtml(sel.met) : sel.type === "rxn" ? rxnHtml(sel.rxn) : sel.type === "sub" ? subHtml(sel.ss) : sel.type === "grp" ? grpHtml(sel.g) : geneHtml(sel.sym);
  if (sel) {
    const back = document.createElement("div");
    back.className = "meta"; back.innerHTML = `<span class="linkish">${t("back")}</span>`;
    back.onclick = () => { S.sel = null; map.selected = -1; renderDetails(); };
    box.prepend(back);
  }
  wireGo(box);
  const on = (act, fn) => { const b = box.querySelector(`[data-act="${act}"]`); if (b) b.onclick = fn; };
  if (sel?.type === "met") {
    const m = sel.met, st = S.structures[S.model.bases[S.model.mets[m].b].id], f = frame();
    const host = box.querySelector("#detMol");
    if (host && st) renderMolecule(host, st, { enrich: f?.e ? S.sim.tracer.atomsEnrichment({ e: f.e }, m) : null, height: 220 });
    on("supply", () => addSupply(m));
    on("label", () => addSupply(m, true));
    on("phase", () => { const b = S.model.mets[m].b, mm = S.supplies.find((it) => S.model.mets[it.met].b === b && S.sim.exchanges.has(it.met))?.met; if (mm !== undefined) phasePlane(mm); });
    on("newRxnMet", () => editor.openRxnDialog({ seedMet: m }));
    on("newComp", () => editor.openMetDialog({ base: S.model.mets[m].b }));
    on("removeMet", () => editor.removeMet(m));
    const midBox = box.querySelector("#detMid");
    if (midBox && f?.e) fillMid(midBox, f, m);
    const cmpBox = box.querySelector("#detCmp");
    if (cmpBox) compare.fillMetCompare(cmpBox, f, m, () => (f.e ? currentMid(f, m) : null));
  } else if (sel?.type === "rxn") {
    on("objective", () => { S.cfg.objective = sel.rxn; renderObjective(); renderSecondary(); changed(); });
    on("perturb", () => addPerturb("rxn", sel.rxn));
    on("fva", () => fluxRange(sel.rxn));
    on("editRxn", () => { const r = S.model.rxns[sel.rxn]; if (r.user) { const i = S.edits.findIndex((op) => op.op === "addRxn" && op.id === r.id); editor.openRxnDialog({ op: S.edits[i], index: i }); } else { const i = S.edits.findIndex((op) => op.op === "editRxn" && op.id === r.id); editor.openRxnDialog(i >= 0 ? { op: S.edits[i], index: i, j: sel.rxn } : { j: sel.rxn }); } });
    on("copyRxn", () => editor.openRxnDialog({ copyOf: sel.rxn }));
    on("removeRxn", () => editor.removeRxn(sel.rxn));
  } else if (sel?.type === "gene") on("perturb", () => addPerturb("gene", sel.sym));
  else if (sel?.type === "sub") on("open", () => openSubsystem(sel.ss));
  else if (sel?.type === "grp") on("open", () => openGroup(sel.g));
}

// ----------------------------------------------------------------- export ----
/** Everything needed to reproduce this session elsewhere: model edits, settings and the saved scenarios. */
function sessionFile() {
  const meta = S.base.model.meta;
  return {
    format: SESSION_FORMAT, version: 1, app: "MetfluxLive", created: new Date().toISOString(),
    model: { slug: S.slug, id: meta.id, version: meta.version },
    model_edits: editsFile(S.base.model, S.edits),
    settings: capture(),
    scenarios: S.scenarios.filter((sc) => sc.ctx.slug === S.slug).map((sc) => ({ name: sc.name, created: sc.created.toISOString(), summary: sc.summary, model_edits: sc.ops, settings: sc.settings })),
    compare_with: compare.current()?.name ?? null,
  };
}

function exportContext() {
  const f = frame();
  const session = { session: sessionFile(), edits: S.edits, editedModel: S.edited, baseModel: S.base.model };
  if (!f || f.status !== "optimal") return { ...session, model: S.model, noResult: true };
  const steadyTracer = !!f.e && S.result.frames.length === 1;
  const ds = dynSampler(), fi = Math.min(S.frameIdx, S.result.frames.length - 1);
  const modelLabel = $("modelSelect").selectedOptions[0]?.text || S.slug;
  return {
    model: S.model, index: S.index, sim: S.sim, structures: S.structures, result: S.result, frame: f,
    supplies: S.supplies, cfg: S.cfg, mode: S.result.frames.length > 1 ? "dynamic" : "steady",
    dyn: { hours: +$("dynHours").value, biomass_gDW_L: +$("dynBiomass").value, pool_umol_gDW: +$("dynPool").value },
    perturb: S.perturb.map((p) => ({ type: p.type, a: p.a, name: p.type === "gene" ? geneSymbol(p.ref) : S.model.rxns[p.ref].id })),
    pert: S.result.pert || new Map(), mediumName: mediumName(S.mediumId), depth: depths(),
    measured: { set: S.measured.set, edited: S.measured.edited, tolerance: S.measured.tol, atp_maintenance_mmol_gDW_h: S.measured.ngam, exchanges: S.measured.items.map((x) => ({ metabolite: S.index.metName(x.met), direction: x.rate > 0 ? "uptake" : "secretion", rate_mmol_gDW_h: Math.abs(x.rate), applied: !(x.rate > 0) || inMedium(x.met) })) },
    context: contextExport(),
    sampler: steadyTracer ? sampler(f) : f.e && ds ? { mid: (m, n, ms) => ds.mid(m, n, ms, fi) } : null, fate: labelFate(f),
    midSeries: f.e && ds ? midTimeSeries : null,
    events: (S.result.evList || []).map((ev) => (ev.type === "medium" ? { time_h: ev.t, type: "replace_medium", medium: mediumName(ev.mediumId) } : { time_h: ev.t, type: "add", metabolite: S.index.metName(ev.met), concentration_mM: ev.conc, labelled_atoms: ev.label ? Array.from(ev.label, (x, a) => (x > 0 ? a : -1)).filter((a) => a >= 0) : [], fraction: ev.fraction })), canvas: S.view.kind === "list" ? null : $("map"),
    selectedMet: S.sel?.type === "met" ? S.sel.met : null,
    flowsFor: (kind) => frameFlows(f, kind, S.index.pathwayGroups), thermo: S.flowData.hasDG ? { dG: S.flowData.dG, sd: S.flowData.dGsd, cond: S.base.thermo.cond } : null,
    ...session, compare: compare.exportData(),
    caption: `${modelLabel} · ${mediumName(S.mediumId)} · ${S.result.frames.length > 1 ? "dynamic, t = " + fmtTime(f.t) : "steady state"}`,
  };
}

const EXP_NEEDS = { modelEdits: "edits", editLog: "edits", cmpExchanges: "compare", cmpPathways: "compare", cmpLabel: "compare", cmpMids: "compareLabel", changes: "ref", chartChanges: "ref", enrichment: "tracer", chartFate: "tracer", isotopologues: "tracer", chartMid: "tracer", midTimecourse: "metdyn", timecourse: "dynamic", timecourseLabel: "dynamic", chartTime: "dynamic" };

function openExport() {
  const list = $("expList"), go = $("expGo"), f = frame();
  list.textContent = "";
  const ok = !!f && f.status === "optimal";
  go.disabled = false;
  $("expStatus").textContent = ok ? "" : t("exp.noResult");
  {
    const c = exportContext();
    let saved = null;
    try { saved = JSON.parse(localStorage.getItem("metflux.export") || "null"); } catch { /* storage unavailable */ }
    for (const kind of ["session", "table", "chart", "other"]) {
      const ds = DATASETS.filter((x) => x.kind === kind);
      if (!ds.length) continue;
      const h = document.createElement("h4"); h.textContent = t("exp.g." + kind); list.appendChild(h);
      if (kind === "session") { const p = document.createElement("p"); p.className = "hint"; p.innerHTML = t("exp.sessionHint"); list.appendChild(p); }
      for (const d of ds) {
        const on = (!c.noResult || d.anytime) && (!d.when || d.when(c));
        const lab = document.createElement("label"); lab.className = "check" + (on ? "" : " off");
        const box = document.createElement("input"); box.type = "checkbox"; box.value = d.id; box.disabled = !on;
        box.checked = on && (saved ? saved.includes(d.id) : true);
        const txt = document.createElement("span"); txt.textContent = t("exp." + d.id);
        if (!on) { const why = document.createElement("small"); why.textContent = t("exp.na." + (c.noResult && !d.anytime ? "result" : EXP_NEEDS[d.id] || "tracer")); txt.appendChild(why); }
        lab.append(box, txt); list.appendChild(lab);
      }
    }
  }
  $("exportDialog").showModal();
}

async function downloadResults() {
  const ids = [...$("expList").querySelectorAll("input:checked")].map((x) => x.value), st = $("expStatus"), go = $("expGo");
  if (!ids.length) { st.textContent = t("exp.pick"); return; }
  try { localStorage.setItem("metflux.export", JSON.stringify(ids)); } catch { /* ignore */ }
  go.disabled = true;
  try {
    const files = await buildResults(exportContext(), ids, (p) => { st.textContent = t("exp.working", { p: Math.round(100 * p) }); });
    const stamp = new Date().toISOString().slice(0, 16).replace(/[-:]/g, "").replace("T", "-");
    // a single JSON file (session or edits) is downloaded as it is, ready to import
    const single = files.filter((x) => x.name !== "README.txt");
    const one = single.length === 1 && single[0].name.endsWith(".json");
    const blob = one ? new Blob([single[0].data], { type: "application/json" }) : makeZip(files);
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob); a.download = one ? `metfluxlive_${S.slug}_${stamp}_${single[0].name}` : `metfluxlive_${S.slug}_${stamp}.zip`;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 30000);
    st.textContent = t("exp.done", { n: files.length, kb: Math.round(blob.size / 1024) });
    S.lastExport = { files: files.map((x) => x.name), size: blob.size };
  } catch (err) {
    console.error(err);
    st.textContent = t("status.error", { msg: err.message });
  } finally { go.disabled = false; }
}

// ----------------------------------------------------------------- import ----
async function importFile(file) {
  let obj;
  try {
    const buf = new Uint8Array(await file.arrayBuffer());
    if (buf[0] === 0x50 && buf[1] === 0x4b) { // one of our ZIP downloads: take its session.json (or model_edits.json)
      const ent = readStoredZip(buf), e = ent.find((x) => x.name === "session.json") || ent.find((x) => x.name === "model_edits.json");
      if (!e) throw new Error(t("imp.zipNoSession"));
      obj = JSON.parse(new TextDecoder().decode(e.data));
    } else obj = JSON.parse(new TextDecoder().decode(buf));
  } catch (err) { alert(t("imp.unreadable", { msg: err.message })); return; }
  try {
    if (obj?.format === SESSION_FORMAT) await importSession(obj);
    else if (obj?.format === EDIT_FORMAT) importEdits(obj);
    else alert(t("imp.unknown"));
  } catch (err) {
    console.error(err);
    alert(t("imp.failed", { msg: t(err.message) }));
  }
}

function modelMismatch(m) {
  const meta = S.base.model.meta;
  return m && m.version && (m.id !== meta.id || m.version !== meta.version) ? t("imp.versionWarn", { file: `${m.id} ${m.version}`, here: `${meta.id} ${meta.version}` }) : "";
}

function importEdits(obj) {
  const { model, ops } = readEditsFile(obj);
  if (model.slug && model.slug !== S.slug && !confirm(t("imp.otherModel", { slug: model.slug, here: S.slug }))) return;
  const warn = modelMismatch(model);
  const replace = !S.edits.length || confirm(t("imp.editsReplace", { n: ops.length, m: S.edits.length }) + (warn ? "\n\n" + warn : ""));
  setEdits(replace ? ops : [...S.edits, ...ops]);
}

async function importSession(o) {
  if (!confirm(t("imp.sessionConfirm", { n: o.scenarios?.length || 0 }) + (modelMismatch(o.model) ? "\n\n" + modelMismatch(o.model) : ""))) return;
  const ops = readEditsFile(o.model_edits).ops;
  const sel = $("modelSelect");
  if (o.model?.slug && o.model.slug !== S.slug) {
    if (![...sel.options].some((x) => x.value === o.model.slug)) throw new Error(t("imp.noModel", { slug: o.model.slug }));
    sel.value = o.model.slug;
    await loadModel(o.model.slug, { edits: ops, noRun: true });
  } else if (JSON.stringify(ops) !== opsKey()) { S.edits = ops; rebuildModel(); editor.render(); }
  storeEdits();
  // scenarios are recomputed one by one from their settings
  const list = o.scenarios || [];
  for (let i = 0; i < list.length; i++) {
    setStatus(() => t("imp.scenario", { i: i + 1, n: list.length, name: list[i].name }));
    await loadScenario({ name: list[i].name, ops: list[i].model_edits || [], settings: list[i].settings }, false);
    if (S.result) compare.save(list[i].name);
  }
  if (JSON.stringify(ops) !== opsKey()) { S.edits = ops; storeEdits(); rebuildModel(); editor.render(); openGlobal(); }
  const lost = applySettings(o.settings);
  const target = o.compare_with ? S.scenarios.find((x) => x.name === o.compare_with) : null;
  S.compare = target ? target.id : null;
  S.sel = null; compare.render(); renderDetails();
  await run();
  const prev = S.statusFn;
  setStatus(() => prev() + " " + t("imp.done", { n: list.length }) + (lost ? " " + t("imp.lost", { n: lost }) : ""));
}

// ---------------------------------------------------------- panel widths ----
function bindResizers() {
  const main = document.querySelector("main"), DEF = { left: 318, right: 348 };
  let w = { ...DEF };
  try { const o = JSON.parse(localStorage.getItem("metflux.panels") || "null"); if (o && o.left > 0 && o.right > 0) w = { left: o.left, right: o.right }; } catch { /* storage unavailable */ }
  const apply = (save) => {
    // the map always keeps at least 320 px
    const room = Math.max(440, window.innerWidth - 320);
    w.left = Math.round(Math.min(Math.max(w.left, 220), 640)); w.right = Math.round(Math.min(Math.max(w.right, 240), 720));
    if (w.left + w.right > room) { const k = room / (w.left + w.right); w.left = Math.round(w.left * k); w.right = Math.round(w.right * k); }
    main.style.setProperty("--left-w", w.left + "px"); main.style.setProperty("--right-w", w.right + "px");
    if (save) try { localStorage.setItem("metflux.panels", JSON.stringify(w)); } catch { /* ignore */ }
  };
  apply(false);
  window.addEventListener("resize", () => apply(false));
  for (const [id, side, sign] of [["resLeft", "left", 1], ["resRight", "right", -1]]) {
    const h = $(id);
    h.addEventListener("pointerdown", (ev) => {
      ev.preventDefault();
      h.setPointerCapture(ev.pointerId);
      const x0 = ev.clientX, w0 = w[side];
      h.classList.add("dragging"); document.body.classList.add("resizing");
      const move = (e) => { w[side] = w0 + sign * (e.clientX - x0); apply(false); };
      const up = () => { h.removeEventListener("pointermove", move); h.classList.remove("dragging"); document.body.classList.remove("resizing"); apply(true); };
      h.addEventListener("pointermove", move);
      h.addEventListener("pointerup", up, { once: true });
      h.addEventListener("pointercancel", up, { once: true });
    });
    h.addEventListener("dblclick", () => { w[side] = DEF[side]; apply(true); });
    h.addEventListener("keydown", (ev) => {
      if (ev.key !== "ArrowLeft" && ev.key !== "ArrowRight") return;
      ev.preventDefault();
      w[side] += sign * (ev.key === "ArrowRight" ? 16 : -16); apply(true);
    });
  }
}

// --------------------------------------------------------------------- ui ----
// ----------------------------------------------------------------- header ----
// When the three groups of the top bar do not fit (narrow window, or a language with long words), the
// right-hand buttons are reduced to their icon (full label kept as tooltip and accessible name), then the
// brand text is hidden.
const HEADER_ICONS = { tourBtn: "➜", docsBtn: "§", editBtn: "✎", importBtn: "⤒", exportBtn: "⤓" };
function fitHeader() {
  const tb = $("topbar");
  // a right-aligned row that does not fit spills to the left, where scrollWidth does not see it: add up the widths
  const need = (c) => { const k = [...c.children].filter((x) => x.offsetParent !== null); return k.reduce((w, x) => w + x.offsetWidth, 0) + (parseFloat(getComputedStyle(c).columnGap) || 0) * Math.max(0, k.length - 1); };
  const over = () => [...tb.children].some((c) => c.scrollWidth > c.clientWidth || need(c) > c.clientWidth + 1);
  tb.classList.remove("compact1", "compact2", "compact3", "compact4", "compact5", "compact6");
  for (const id of Object.keys(HEADER_ICONS)) {
    const b = $(id);
    if (b.dataset.full) { b.textContent = b.dataset.full; delete b.dataset.full; b.classList.remove("iconized"); b.removeAttribute("aria-label"); }
  }
  if (isMobile() || !over()) return; // phone layout: the buttons live in the More sheet
  tb.classList.add("compact1");
  for (const [id, icon] of Object.entries(HEADER_ICONS)) {
    const b = $(id);
    b.dataset.full = b.textContent; b.setAttribute("aria-label", b.textContent); b.textContent = icon; b.classList.add("iconized");
  }
  for (const c of ["compact2", "compact3", "compact4", "compact5", "compact6"]) { if (!over()) break; tb.classList.add(c); }
}

function changeLanguage(lang) {
  setLang(lang);
  applyDom();
  fitHeader();
  if (!S.model) return;
  S.search = new SearchIndex(S.model, S.index);
  S.scenes = {}; // region and level labels are translated
  for (const k of [...S.subScenes.keys()]) if (String(k).startsWith("c")) S.subScenes.delete(k);
  $("docsBtn").href = "docs.html?lang=" + docsLang();
  document.querySelectorAll("a[data-docs]").forEach((a) => { a.href = `docs.html?lang=${docsLang()}#${docsLang()}-${a.dataset.docs}`; });
  if (S.view.kind === "global") map.setScene(globalScene(), true);
  else if (S.view.kind === "sub" && isCascade()) map.setScene(subScene(S.view.ss), true);
  if (S.ctxData) S.ctxIndex = new ContextIndex(S.ctxData, ctxLabels);
  design.reset(); renderTracerLib();
  renderContext(); renderMediumSel(); renderSupplies(); renderMeasured(); renderPerturb(); renderEvents(); renderObjective(); renderSecondary(); renderCrumbs(); applyFrame(); renderDetails();
  editor.render(); compare.render(); renderEditBadge();
  updateRegButton();
  if (MTB.result) mtbRender();
  if (REG.result) regRender();
  if (REG.markedTf && $("regMarkTxt")) $("regMarkTxt").textContent = t("reg.marked", { tf: REG.markedTf, n: REG.markedRxns?.size || 0 });
  if (S.statusFn) setStatus(S.statusFn, S.statusErr, S.statusKind);
  if ($("runBtn").classList.contains("running")) $("runBtn").textContent = t("h.running");
}

function bindUi() {
  attachSearch($("search"), $("searchResults"), () => S.search, onSearchPick);
  attachSearch($("addSupply"), $("addResults"), () => S.search, (it) => addSupply(pickSupplyMet(it.ref)), { filter: (it) => it.type === "met", limit: 80 });
  attachSearch($("addPerturb"), $("perturbResults"), () => S.search, (it) => addPerturb(it.type, it.ref), { filter: (it) => it.type === "gene" || it.type === "rxn", limit: 80 });
  attachSearch($("ctxInput"), $("ctxResults"), () => S.ctxIndex, (it) => setContext(it.ref, S.context.mode), { limit: 120 });
  $("demoBtn").onclick = openDemoDialog;
  $("mtbOpen").onclick = openMtbDialog;
  $("mtbOverlay").onchange = (ev) => { MTB.overlay = ev.target.checked; applyFrame(); };
  $("mtbClear").onclick = () => mtbClear(true);
  $("mtbFile").onchange = (ev) => { const f = ev.target.files[0]; if (f) f.text().then((x) => { $("mtbText").value = x; mtbRun(); }); };
  $("mtbRun").onclick = mtbRun;
  $("regOpen").onclick = openRegDialog;
  $("regClear").onclick = () => regClear(true);
  $("regFile").onchange = (ev) => { const f = ev.target.files[0]; if (f) f.text().then((x) => { $("regText").value = x; regRun(); }); };
  $("regRun").onclick = regRun;
  $("exoOpen").onclick = openExoDialog;
  $("exoFile").onchange = (ev) => { const f = ev.target.files[0]; if (f) f.text().then((x) => { $("exoText").value = x; exoParse(); }); };
  $("exoParse").onclick = exoParse;
  $("exoCond").onchange = () => { $("exoMu").value = ""; $("exoMuSd").value = ""; $("exoFit").textContent = ""; exoRender(); };
  $("exoApply").onclick = exoApply;
  $("exoCheck").onclick = exoCheck;
  $("rnaOpen").onclick = openRnaDialog;
  $("rnaFile").onchange = (ev) => readRnaFile(ev.target.files[0]);
  ["rnaIdCol", "rnaValCol", "rnaLog", "rnaThr"].forEach((id) => { $(id).onchange = rnaPreview; });
  $("rnaBuild").onclick = buildRnaContext;
  $("ctxMode").onchange = (ev) => setContext(S.context.id, ev.target.value);
  $("clearContext").onclick = () => setContext(null, S.context.mode);
  attachSearch($("objInput"), $("objResults"), () => S.search, (it) => { S.cfg.objective = it.ref; renderObjective(); renderSecondary(); changed(); }, { filter: (it) => it.type === "rxn", limit: 120 });
  window.addEventListener("keydown", (ev) => {
    if ((ev.ctrlKey || ev.metaKey) && ev.key.toLowerCase() === "k") { ev.preventDefault(); $("search").focus(); $("search").select(); }
    else if (ev.key === "Escape" && S.view.kind !== "global" && document.activeElement === document.body && !document.querySelector("dialog[open]")) { S.sel = null; openGlobal(); renderDetails(); }
  });
  $("modelSelect").onchange = (ev) => loadModel(ev.target.value);
  $("langSel").onchange = (ev) => changeLanguage(ev.target.value);
  $("runBtn").onclick = run;
  $("tourBtn").onclick = () => tour();
  $("navBack").onclick = () => navGo(-1); $("navFwd").onclick = () => navGo(1);
  window.addEventListener("keydown", (ev) => {
    if (ev.altKey && (ev.key === "ArrowLeft" || ev.key === "ArrowRight")) { ev.preventDefault(); navGo(ev.key === "ArrowLeft" ? -1 : 1); }
    if (ev.key === "Escape") $("ctxMenu").hidden = true;
  });
  document.addEventListener("pointerdown", (ev) => { if (!ev.target.closest("#ctxMenu")) $("ctxMenu").hidden = true; });
  $("map").addEventListener("wheel", () => { $("ctxMenu").hidden = true; }, { passive: true });
  $("designBtn").onclick = () => design.open();
  $("trLib").onchange = (ev) => { applyLibraryTracer(ev.target.value); ev.target.value = ""; };
  renderTracerLib();
  $("details").addEventListener("click", (ev) => {
    const b = ev.target.closest("[data-cof]"); if (b) { S.cofTab = b.dataset.cof; renderDetails(); }
    const fx = ev.target.closest("[data-flex]"); if (fx) computeFlex(+fx.dataset.flex);
  });
  $("details").addEventListener("change", (ev) => { if (ev.target.matches("[data-natab]")) { S.natAb = ev.target.checked; renderDetails(); return; } if (ev.target.id === "flexFrac") S.flexFrac = +ev.target.value; if (ev.target.id === "flexCycles") S.flexCycles = ev.target.checked; });
  $("autoBtn").onclick = toggleAuto;
  renderAuto();
  $("themeBtn").onclick = () => setTheme(document.documentElement.dataset.theme === "light" ? "dark" : "light");
  $("lookBtn").onclick = () => openLookDialog(() => {
    if (!S.model) return;
    S.scenes = {}; // the cell backdrop carries its compartment colours
    if (S.view.kind === "global") map.setScene(globalScene(), true);
    applyFrame(); renderDetails();
  });
  $("objPreset").onchange = (ev) => pickObjective(ev.target.value);
  $("secPreset").onchange = (ev) => pickSecondary(ev.target.value);
  $("secFrac").oninput = (ev) => { $("secFracVal").textContent = ev.target.value + " %"; };
  $("secFrac").onchange = (ev) => { S.secFrac = ev.target.value / 100; if (S.cfg.secondary) { S.cfg.secondary.frac = S.secFrac; changed(); } };
  $("secCurveBtn").onclick = tradeoffCurve;
  $("saveObjective").onclick = saveObjective;
  $("deleteObjective").onclick = deleteObjective;
  $("methodsBtn").onclick = () => $("methodsDialog").showModal();
  $("modeToggle").querySelectorAll("button").forEach((b) => { b.onclick = () => setMode(b.dataset.mode); });
  $("resetMedium").onclick = () => loadMedium(S.mediumId);
  $("mediumSel").onchange = (ev) => loadMedium(ev.target.value);
  $("saveMedium").onclick = saveMedium;
  $("deleteMedium").onclick = deleteMedium;
  { const st = document.createElement("style"); st.textContent = CTT_CSS; document.head.appendChild(st); }
  $("ctxExplore").ontoggle = () => { if ($("ctxExplore").open) renderCtxExplore(); };
  // all screens share S.screening (only one runs at a time): each button stops whichever is running
  $("taskTabs").querySelectorAll("button[data-task]").forEach((b) => { b.onclick = () => setTask(b.dataset.task); });
  $("compareBadge").onclick = () => setTask("cmp");
  $("geneScreen").onclick = () => (S.screening ? (S.screening.stop = true) : geneScreen());
  $("nutScreen").onclick = () => (S.screening ? (S.screening.stop = true) : nutrientScreen());
  $("cmpNutScreen").onclick = () => (S.screening ? (S.screening.stop = true) : compareNutrientScreen());
  $("cmpGeneScreen").onclick = () => (S.screening ? (S.screening.stop = true) : compareGeneScreen());
  $("clearPerturb").onclick = () => { S.perturb = []; renderPerturb(); renderMeasured(); changed(); };
  $("measuredSel").onchange = (ev) => { loadMeasured(ev.target.value); renderObjective(); renderSecondary(); renderContext(); };
  $("resetMeasured").onclick = () => loadMeasured(S.measured.set);
  $("measTol").onchange = (ev) => { S.measured.tol = Math.min(1, Math.max(0, (+ev.target.value || 0) / 100)); renderMeasured(); changed(); };
  attachSearch($("addMeasured"), $("measuredResults"), () => S.search, (it) => addMeasured(it.ref), { filter: (it) => it.type === "met" && S.index.metsOfBase[it.ref].some((m) => S.sim.exchanges.has(m)), limit: 80 });
  attachSearch($("addEvent"), $("eventResults"), () => S.search, (it) => addMetEvent(it.ref), { filter: (it) => it.type === "met" && S.index.metsOfBase[it.ref].some((m) => S.sim.exchanges.has(m)), limit: 80 });
  $("addMediumEvent").onclick = () => { S.events.push({ type: "medium", t: newEventTime(), mediumId: "default" }); renderEvents(); changed(); };
  $("clearEvents").onclick = () => { S.events = []; renderEvents(); changed(); };
  $("dynHours").addEventListener("change", renderEvents);
  $("objSense").onchange = (ev) => { S.cfg.maximize = ev.target.value === "max"; renderObjective(); renderSecondary(); changed(); };
  $("pfba").onchange = (ev) => { S.cfg.parsimonious = ev.target.checked; renderContext(); changed(); };
  for (const id of ["dynHours", "dynBiomass", "dynPool"]) $(id).onchange = changed;
  $("groupSel").onchange = (ev) => {
    S.grouping = ev.target.value;
    try { localStorage.setItem("metflux.view", S.grouping); } catch { /* ignore */ }
    if (S.view.kind === "sub") openSubsystem(S.view.ss, true); else { S.sel = null; openGlobal(); renderDetails(); }
  };
  $("qtySel").value = S.quantity;
  $("qtySel").onchange = (ev) => {
    S.quantity = ev.target.value;
    try { localStorage.setItem("metflux.quantity", S.quantity); } catch { /* ignore */ }
    applyFrame();
  };
  $("exportBtn").onclick = openExport;
  $("importBtn").onclick = () => { $("importFile").value = ""; $("importFile").click(); };
  $("importFile").onchange = (ev) => { const file = ev.target.files[0]; if (file) importFile(file); };
  // a change not simulated yet (Auto waiting, a run in progress, or Auto off) is simulated first: otherwise the
  // scenario would keep the new settings with the previous result
  $("saveScenario").onclick = async () => {
    if (S.stale) { await run(); if (S.stale) return; } // a newer change superseded that run
    const sc = compare.save(); if (sc) { S.shown = sc.id; compare.render(); }
  };
  compare.bindPicker();
  $("stopCompare").onclick = () => compare.setCompare(null);
  $("compareBadge").onclick = () => { S.sel = null; renderDetails(); };
  $("expAll").onclick = () => $("expList").querySelectorAll("input:not(:disabled)").forEach((x) => { x.checked = true; });
  $("expNone").onclick = () => $("expList").querySelectorAll("input").forEach((x) => { x.checked = false; });
  $("expGo").onclick = downloadResults;
  $("filterSel").onchange = (ev) => {
    S.filter = ev.target.value;
    if ((S.filter === "delta" || S.filter === "rev") && frame()?.ref) S.cmpView = "ab";
    applyFrame(); if (S.view.kind !== "list") map.fit(true, true);
  };
  $("cmpViews").addEventListener("click", (ev) => { const b = ev.target.closest("button[data-v]"); if (b) setCmpView(b.dataset.v); });
  window.addEventListener("keydown", (ev) => { // 1 / 2 / 3: condition A, condition B, A → B
    if (ev.ctrlKey || ev.metaKey || ev.altKey || $("cmpViews").hidden || document.querySelector("dialog[open]")) return;
    if (ev.target.closest?.("input, select, textarea, [contenteditable]")) return;
    const v = { 1: "a", 2: "b", 3: "ab" }[ev.key];
    if (v) { ev.preventDefault(); setCmpView(v); }
  });
  $("optInactive").onchange = (ev) => { map.options.inactive = ev.target.checked; };
  $("optParticles").onchange = (ev) => { map.options.particles = ev.target.checked; };
  try { S.adaptive = localStorage.getItem("metflux.adaptive") === "1"; } catch { /* ignore */ }
  $("optAdaptive").checked = !!S.adaptive;
  $("optAdaptive").onchange = (ev) => { S.adaptive = ev.target.checked; try { localStorage.setItem("metflux.adaptive", S.adaptive ? "1" : "0"); } catch { /* ignore */ } };
  $("fitBtn").onclick = () => map.fit(true, false);
  $("timeSlider").oninput = (ev) => { stopPlay(); S.frameIdx = +ev.target.value; applyFrame(); renderDetails(); };
  $("playBtn").onclick = () => { if (S.playing) stopPlay(); else { if (S.frameIdx >= S.result.frames.length - 1) S.frameIdx = 0; startPlay(); } };
  if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) { map.options.particles = false; $("optParticles").checked = false; }
}

boot();
