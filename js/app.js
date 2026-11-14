// MetfluxLive — application shell: state, panels, navigation and simulation control.
import { Simulator } from "./sim.js";
import { MEDIA, presetMedium, exportMedium, importMedium, uptakeCapacity, kineticsFor } from "./core/medium.js";
import { MEASURED_SETS, DEFAULT_TOL, measuredPreset, measuredNgam } from "./core/measured.js";
import { gprActivity } from "./core/gpr.js";
import { ModelIndex, fmtFlux, fmtTime, escapeHtml as esc } from "./modelindex.js";
import { MapView, COMP_COLORS, enrichColor, deltaColor, energyColor, setMapTheme } from "./ui/mapview.js";
import { OBJECTIVES, objectiveIndex } from "./core/objectives.js";
import { SearchIndex, attachSearch } from "./ui/search.js";
import { renderMolecule, tracerName } from "./ui/molecule.js";
import { buildCellLayout } from "./celllayout.js";
import { metDepths, cascadeGlobal, cascadeSub } from "./cascade.js";
import { IsotopologueSampler, naturalMid } from "./core/isotopologues.js";
import { DATASETS, buildResults } from "./export/results.js";
import { makeZip, readStoredZip } from "./export/zip.js";
import { t, initLang, setLang, getLang, applyDom, LANGS } from "./i18n.js";
import { applyEdits, editedLayout, editsFile, readEditsFile, modelLookups, EDIT_FORMAT } from "./core/edits.js";
import { createEditor } from "./ui/editor.js";
import { createCompare } from "./ui/compare.js";
import { QUANTITIES, ATOM_Q, carrierBases, excludedPools, carrierShare, transferableAtoms, cofactorWeights, groupEnergy, dgRunning } from "./core/flows.js";

const SESSION_FORMAT = "metfluxlive-session";

const $ = (id) => document.getElementById(id);
const S = {
  slug: null, model: null, structures: null, layout: null, index: null, search: null, sim: null,
  supplies: [], perturb: [], events: [], measured: { set: "nci60", tol: DEFAULT_TOL, items: [], ngam: 0, edited: false }, cfg: { objective: 0, maximize: true, parsimonious: true },
  mode: "steady", result: null, frameIdx: 0, stale: false,
  auto: { steady: true, dynamic: false }, // re-run automatically after a change, per mode
  grouping: "cascade", filter: "all", quantity: "carbon", // what the lines between groups carry
  view: { kind: "global", ss: -1 }, sel: null, runSeq: 0, playing: null,
  scenes: {}, subScenes: new Map(), cell: undefined, statusFn: null,
  base: null, edits: [], edited: null, editMode: false, // model editor: published model + edit operations
  scenarios: [], compare: null, // comparison mode: saved scenarios, id of the one compared with
};
let map, editor, compare;
const small = (s) => ` <small style="color:var(--muted);font-weight:400">${s}</small>`;

// ------------------------------------------------------------------ boot ----
async function boot() {
  initLang();
  const ls = $("langSel");
  for (const [code] of LANGS) ls.add(new Option(code.toUpperCase(), code));
  ls.value = getLang();
  bindFolds(); bindResizers();
  applyDom();
  $("docsBtn").href = "docs.html?lang=" + getLang();
  document.querySelectorAll("a[data-docs]").forEach((a) => { a.href = `docs.html?lang=${getLang()}#${getLang()}-${a.dataset.docs}`; });
  // "metflux.view" replaces "metflux.grouping" (2026-11-14), so that the new default (cascade) is seen once
  try { const g = localStorage.getItem("metflux.view"); if (g === "cell" || g === "pathway" || g === "cascade") S.grouping = g; } catch { /* storage unavailable */ }
  try { const a = JSON.parse(localStorage.getItem("metflux.auto") || "null"); if (a) S.auto = { steady: a.steady !== false, dynamic: !!a.dynamic }; } catch { /* storage unavailable */ }
  setTheme(document.documentElement.dataset.theme === "light" ? "light" : "dark", false);
  try { const q = localStorage.getItem("metflux.quantity"); if (QUANTITIES.includes(q)) S.quantity = q; } catch { /* storage unavailable */ }
  map = new MapView($("map"), { onSelect: onMapSelect, onOpen: onMapOpen, onHover: onMapHover });
  editor = createEditor({ S, setEdits, gotoReaction, gotoMet, refreshDetails: renderDetails });
  compare = createCompare({ S, capture, opsKey, load: (sc) => loadScenario(sc), redraw: () => { applyFrame(); renderDetails(); }, mediumName, frame });
  bindUi();
  editor.bind();
  let models;
  try {
    models = await (await fetch("data/models.json")).json();
  } catch {
    $("loadingText").textContent = t("load.missing");
    return;
  }
  const sel = $("modelSelect");
  for (const m of models) sel.add(new Option(`${m.name} ${m.version}`, m.slug));
  let wanted = models[0].slug;
  try { const saved = localStorage.getItem("metflux.model"); if (models.some((m) => m.slug === saved)) wanted = saved; } catch { /* storage unavailable */ }
  sel.value = wanted;
  await loadModel(wanted);
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
    const [model, structures, atommaps, layout, thermo] = await Promise.all([get("model.json"), get("structures.json"), get("atommaps.json"), get("layout.json"), optional("thermo.json")]);
    model.meta = { ...model.meta, slug };
    Object.assign(S, { slug, base: { model, structures, atommaps, layout, thermo }, result: null, sel: null, frameIdx: 0 });
    S.edits = opts.edits ?? storedEdits(slug);
    $("loadingText").textContent = t("load.solver");
    rebuildModel();
    S.supplies = []; S.events = [];
    loadMedium(storedMediumId(), false);
    S.perturb = []; S.events = [];
    loadMeasured(storedMeasuredId(), false);
    S.cfg = { objective: Math.max(0, S.index.biomassRxn), maximize: true, parsimonious: true };
    S.scenes = {}; S.subScenes = new Map(); S.cell = undefined; S.depth = null;
    try { localStorage.setItem("metflux.model", slug); } catch { /* ignore */ }
    $("groupSel").querySelector('[value="cell"]').disabled = !cellLayout();
    if (!cellLayout() && S.grouping === "cell") S.grouping = "pathway";
    $("groupSel").value = S.grouping;
    renderSupplies(); renderMeasured(); renderPerturb(); renderEvents(); renderObjective(); openGlobal(); renderDetails();
    editor.render(); compare.render();
    loading.classList.add("done");
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
  S.scenes = {}; S.subScenes = new Map(); S.cell = undefined; S.depth = null; S.depthKey = null;
  S.result = null;
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
    perturbations: S.perturb.map((p) => ({ type: p.type, target: p.type === "gene" ? p.ref : M.rxns[p.ref].id, activity: p.a })),
    objective: { reaction: M.rxns[S.cfg.objective].id, maximize: S.cfg.maximize, parsimonious: S.cfg.parsimonious },
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
  try { localStorage.setItem("metflux.medium", S.mediumId); } catch { /* ignore */ }
  S.supplies = [];
  for (const c of o.medium.components) {
    const m = met(c.met);
    if (m === undefined) continue;
    S.supplies.push({ met: m, conc: +c.conc, conc0: +(c.conc0 ?? c.conc), vmax: +c.vmax, km: +c.km, unlimited: !!c.unlimited, hold: !!c.hold, label: label(m, c.label), fraction: +c.fraction || 1 });
  }
  const set = MEASURED_SETS.some((x) => x.id === o.measured.set) ? o.measured.set : "none";
  S.measured = { set, tol: +o.measured.tol || 0, ngam: +o.measured.ngam || 0, edited: !!o.measured.edited, items: [] };
  for (const x of o.measured.items) { const m = met(x.met); if (m !== undefined && S.sim.exchanges.has(m)) S.measured.items.push({ met: m, rate: +x.rate }); }
  S.perturb = [];
  for (const p of o.perturbations) {
    if (p.type === "gene") { if (S.search.geneRxns.has(p.target)) S.perturb.push({ type: "gene", ref: p.target, a: +p.activity }); else lost++; }
    else { const j = L.rxn.get(p.target); if (j !== undefined && !S.model.rxns[j].removed) S.perturb.push({ type: "rxn", ref: j, a: +p.activity }); else lost++; }
  }
  const oj = L.rxn.get(o.objective.reaction);
  if (oj === undefined || S.model.rxns[oj].removed) lost++;
  S.cfg = { objective: oj !== undefined && !S.model.rxns[oj].removed ? oj : Math.max(0, S.index.biomassRxn), maximize: o.objective.maximize !== false, parsimonious: o.objective.parsimonious !== false };
  $("dynHours").value = o.dynamic.hours; $("dynBiomass").value = o.dynamic.biomass; $("dynPool").value = o.dynamic.pool;
  S.events = [];
  for (const ev of o.events) {
    if (ev.type === "medium") { S.events.push({ type: "medium", t: +ev.t, mediumId: ensureMedium(ev.medium, ev.saved) }); continue; }
    const m = met(ev.met);
    if (m !== undefined) S.events.push({ type: "add", t: +ev.t, met: m, conc: +ev.conc, label: label(m, ev.label), fraction: +ev.fraction || 1 });
  }
  renderMediumSel(); renderSupplies(); renderMeasured(); renderPerturb(); renderEvents(); renderObjective();
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
  if (lost) { const prev = S.statusFn; setStatus(() => prev() + " " + t("imp.lost", { n: lost })); }
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
  return role ? t("comp." + role) : S.index.compName(c);
}

/** Name of a location in the cell view: a compartment, or the membrane of one. */
function locName(loc) {
  if (!loc.startsWith("mem:")) return compName(loc);
  const c = loc.slice(4), role = S.index.compRole[c];
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
    const regions = c.regions.map((r) => ({ ...r, label: locName(r.loc), color: COMP_COLORS[r.comp] || COMP_COLORS.c }));
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
  S.view = { kind: "global", ss: -1 };
  $("listView").hidden = true;
  map.setScene(globalScene());
  renderCrumbs(); applyFrame();
  if (S.filter !== "all") map.fit(false, true);
}

/** Open a pathway map; `grp` restricts a list view to one cell-view group. */
function openSubsystem(ss, keepSel = false, grp = null) {
  const sc = subScene(ss);
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
  if (S.view.kind !== "global") {
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

function gotoReaction(j) {
  S.sel = { type: "rxn", rxn: j };
  let i = map.findNode(1, j);
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
  let i = map.findNode(0, m);
  if (i < 0) {
    const ss = bestSubsystemForMet(m);
    if (ss >= 0) { openSubsystem(ss, true); i = map.findNode(0, m); }
  }
  if (i >= 0) map.focusNode(i);
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
}

function onMapSelect(node) {
  if (!node) S.sel = S.view.kind === "sub" ? { type: "sub", ss: S.view.ss } : null;
  else if (node.type === 0) S.sel = { type: "met", met: node.ref };
  else if (node.type === 1) S.sel = { type: "rxn", rxn: node.ref };
  else S.sel = map.scene.cell ? { type: "grp", g: node.ref } : { type: "sub", ss: node.ref };
  renderDetails();
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
    html += `<span>${S.model.rxns[node.ref].id} · ${t("tip.flux", { x: fmtFlux(f ? f.v[node.ref] : 0) })}${f?.ref ? (f.ref.scen ? t("tip.refScen", { name: esc(f.ref.scen.name), x: fmtFlux(f.ref.v[node.ref]) }) : t("tip.ref", { x: fmtFlux(f.ref.v[node.ref]) })) : ""}${node.pert !== undefined ? t("tip.activity", { x: Math.round(100 * node.pert) }) : ""}</span>`;
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
  if (S.filter === "delta" && f?.ref) return "delta";
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
  return cache[kind] || (cache[kind] = kind === "label" ? S.index.labelMask(f.v, f.metE) : kind === "dlabel" ? dlabelMask(f) : S.index.deltaMask(f.v, f.ref.v));
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

function setStatus(fn, err = false) {
  S.statusFn = fn; S.statusErr = err;
  const s = $("status"); s.textContent = fn(); s.classList.toggle("err", err);
}

const statusWhy = (st) => { const k = "st." + st, s = t(k); return s === k ? st : s; };

const SUPERSEDED = new Error("superseded");
async function run() {
  const seq = ++S.runSeq;
  clearTimeout(autoTimer);
  const btn = $("runBtn");
  btn.disabled = true; btn.classList.remove("pending");
  stopPlay();
  const t0 = performance.now();
  const pert = perturbActivities();
  const cfg = { ...S.cfg, perturb: [...pert], measured: { items: S.measured.items.map((x) => ({ met: x.met, rate: x.rate })), tol: S.measured.tol, ngam: S.measured.ngam } };
  const mode = S.mode;
  try {
    const dyn = { hours: +$("dynHours").value || 24, biomass: +$("dynBiomass").value || 0.5, pool: (+$("dynPool").value || 0.5) / 1000, frames: 30, events: mode === "dynamic" ? resolveEvents() : [] };
    const evList = mode === "dynamic" ? S.events.map((ev) => ({ ...ev })) : [];
    let res;
    if (mode === "steady") {
      setStatus(() => t("status.fba"));
      res = await S.sim.runSteady(cfg, S.supplies, S.structures, (phase) => { if (seq === S.runSeq) setStatus(() => t(phase === "ref" ? "status.ref" : "status.fba")); });
    } else {
      setStatus(() => t("status.dyn", { p: 0, t: fmtTime(0) }));
      res = await S.sim.runDynamic(cfg, S.supplies, S.structures, dyn, (p, fr, frames, phase) => {
        if (seq !== S.runSeq) throw SUPERSEDED; // a newer run started: stop computing this one
        const pc = Math.round(100 * p);
        if (phase === "ref") { setStatus(() => t("status.dynRef", { p: pc })); return; }
        setStatus(() => t("status.dyn", { p: pc, t: fmtTime(fr.t) }));
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
    else setStatus(() => t("status.done", { mode: mode === "steady" ? t("status.steady") : t("status.dynamic", { n: res.solves }), s: secs }) + (last.converged === false ? t("status.notconv") : "") + (res.frames.some((f) => f.relaxed) ? t("status.relaxed") : ""));
    setupTimeline();
    applyFrame(); renderDetails();
    if (mode === "dynamic" && res.frames.length > 1) { S.frameIdx = 0; $("timeSlider").value = 0; applyFrame(); startPlay(); }
  } catch (err) {
    if (err === SUPERSEDED) return;
    if (seq === S.runSeq) setStatus(() => t("status.error", { msg: err.message }), true);
    console.error(err);
  } finally {
    if (seq === S.runSeq) btn.disabled = false;
  }
}

let autoTimer = null;
function changed() {
  S.stale = true;
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
  fs.querySelector('[value="dlabel"]').disabled = !canDlabel(f);
  const filt = activeFilter(f);
  fs.value = filt;
  const mode = filt === "delta" ? "delta" : filt === "dlabel" ? "dlabel" : f?.metE ? "tracer" : "flux";
  const mask = filt === "all" ? null : frameMask(f, filt);
  if (S.view.kind === "sub") {
    map.setData(f ? { v: f.v, turnover: frameTurnover(f), metE: f.metE, uncertain: f.uncertain, mode, mask, ref: f.ref?.v, refE: f.ref?.metE, perturb: S.result.pert, dG: S.quantity === "dg" ? S.flowData.dG : null } : {});
  } else if (S.view.kind === "global") {
    let gHas = null;
    if (mask) {
      const G = groups();
      gHas = new Uint8Array(G.n);
      for (let j = 0; j < mask.rxn.length; j++) if (mask.rxn[j] && G.groupOf[j] >= 0) gHas[G.groupOf[j]] = 1;
    }
    let fl = f ? frameFlows(f) : null;
    if (f && mode === "dlabel") { // group colour: change of the flux-weighted label against the compared scenario
      const G = groups(), cache = f.flowsBy, k = "ref:" + G.key;
      const D = S.flowData, refFl = cache[k] || (cache[k] = S.index.groupFlows(f.ref.v, f.ref.metE || new Float32Array(S.model.mets.length), G, null, { w: D.zeroW || (D.zeroW = new Float32Array(S.model.mets.length)), skipBase: D.noSkip }));
      fl = { ...fl, gD: Float32Array.from(fl.gE, (e, g) => Math.max(-1, Math.min(1, 3 * ((f.metE ? e : 0) - refFl.gE[g])))) };
    }
    map.setData(f ? { ...fl, mode, gHas, minE: filt === "label" ? 0.005 : 0, energy: fl.energy ? fl.energy.g : null } : {});
  } else renderListView(mask);
  $("emptyNote").hidden = !(mask && S.view.kind !== "list" && map.visibleCount() === 0);
  renderLegend(mode);
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

function renderLegend(mode) {
  const sub = S.view.kind === "sub";
  const comps = sub ? [...new Set(map.scene.nodes.filter((n) => n.type === 0).map((n) => n.comp))] : [];
  const ramp = (colors, labels) => `<div class="ramp" style="background:linear-gradient(90deg,${colors.join(",")})"></div><div class="scale">${labels.map((l) => `<span>${l}</span>`).join("")}</div>`;
  const q = S.quantity, energy = q === "dg";
  let h = `<div><b style="color:var(--text)">${t(sub ? "legend.rxnflux" : "legend.q." + q)}</b>${t(!sub && energy ? "legend.dgScale" : "legend.scale")}</div>`;
  if (!sub && !energy) h += `<div>${t("legend.unit." + q)}</div>`;
  if (energy) {
    h += `<div style="margin-top:6px">${t(sub ? "legend.dgSub" : "legend.dgGlobal")}</div>${ramp([-1, -0.4, 0, 0.5, 1].map((x) => energyColor(x)), sub ? ["+40", "0", "−40 kJ/mol"] : [t("legend.dgUp"), t("legend.dgDown")])}`;
    h += `<div><i style="display:inline-block;width:9px;height:9px;border-radius:2px;background:${energyColor(NaN)};margin-right:4px"></i>${t("legend.dgUnknown")}</div>`;
    if (!S.flowData.hasDG) h += `<div class="err">${t("legend.dgMissing")}</div>`;
  } else if (sub && q !== "carbon") h += `<div>${t("legend.qSubOnly")}</div>`;
  if (mode === "tracer" && !energy) h += `<div style="margin-top:6px">${t("legend.enrich")}</div>${ramp([0, 0.05, 0.2, 0.5, 1].map((x) => enrichColor(x)), ["0 %", "5", "20", "50", "100 %"])}<div>${t("legend.uncertain")}</div>`;
  if (mode === "dlabel" && !energy) h += `<div style="margin-top:6px">${t("legend.dlabel", { name: esc(frame()?.ref?.scen?.name || "") })}</div>${ramp([-1, -0.3, 0, 0.3, 1].map((x) => deltaColor(x)), [t("legend.lessLabel"), t("legend.same"), t("legend.moreLabel")])}`;
  if (mode === "delta" && !energy) h += `<div style="margin-top:6px">${t(frame()?.ref?.scen ? "legend.deltaScen" : "legend.delta", { name: esc(frame()?.ref?.scen?.name || "") })}</div>${ramp([-1, -0.3, 0, 0.3, 1].map((x) => deltaColor(x)), [t("legend.down"), t("legend.same"), t("legend.up")])}${sub ? `<div>${t("legend.lost")}</div>` : ""}`;
  if (sub && S.result?.pert?.size) h += `<div>${t("legend.pert")}</div>`;
  if (comps.length) h += `<div class="comps">${comps.map((c) => `<span><i style="border-color:${COMP_COLORS[c] || COMP_COLORS.c}"></i>${esc(compName(c))}</span>`).join("")}</div>`;
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
function storedMediumId() {
  let id = null;
  try { id = localStorage.getItem("metflux.medium"); } catch { /* storage unavailable */ }
  return id && mediumExists(id) ? id : "default";
}
const mediumName = (id) => (id.startsWith(USER) ? id.slice(USER.length) : t("medium.name." + id));

/** Replace the medium, keeping the isotope labels of metabolites present in both. */
function loadMedium(id, rerun = true) {
  if (!mediumExists(id)) id = "default";
  const items = id.startsWith(USER) ? importMedium(S.model, userMedia()[id.slice(USER.length)]) : presetMedium(S.model, id);
  const old = new Map(S.supplies.map((it) => [it.met, it]));
  S.supplies = items.map((it) => { const o = old.get(it.met); return { ...it, label: o?.label ?? null, fraction: o?.fraction ?? 1 }; });
  S.mediumId = id;
  try { localStorage.setItem("metflux.medium", id); } catch { /* ignore */ }
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
  group(t("medium.builtin"), MEDIA.map((m) => m.id));
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
  try { localStorage.setItem("metflux.medium", S.mediumId); } catch { /* ignore */ }
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

// ------------------------------------------------- measured exchange fluxes ----
function storedMeasuredId() {
  let id = null;
  try { id = localStorage.getItem("metflux.measured"); } catch { /* storage unavailable */ }
  return MEASURED_SETS.some((x) => x.id === id) ? id : "nci60";
}

function loadMeasured(id, rerun = true) {
  S.measured = { set: id, tol: S.measured.tol ?? DEFAULT_TOL, items: measuredPreset(S.model, S.sim.exchanges, id), ngam: measuredNgam(id), edited: false };
  try { localStorage.setItem("metflux.measured", id); } catch { /* ignore */ }
  renderMeasured(); renderSupplies();
  if (rerun) changed();
}

const measuredOf = (met) => S.measured.items.find((x) => x.met === met);
const inMedium = (met) => S.supplies.some((it) => it.met === met && (it.unlimited || it.conc > 0));

function renderMeasured() {
  const sel = $("measuredSel");
  sel.textContent = "";
  for (const x of MEASURED_SETS) sel.add(new Option(t("meas.name." + x.id), x.id));
  sel.value = S.measured.set;
  $("measTol").value = Math.round(100 * S.measured.tol);
  $("measuredNote").innerHTML = t("meas.note." + S.measured.set, { lang: getLang() }) + (S.measured.edited ? " " + t("meas.note.edited") : "") + (S.measured.items.length && S.perturb.length ? t("meas.perturbNote") : "");
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
  if (S.measured.items.length) $("measuredNote").innerHTML = t("meas.note." + S.measured.set, { lang: getLang() }) + (S.measured.edited ? " " + t("meas.note.edited") : "") + (S.perturb.length ? t("meas.perturbNote") : "");
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
  for (const o of OBJECTIVES) { const j = objectiveIndex(S.model, S.index, o); if (j >= 0) out.push({ key: "preset:" + o.id, name: t("obj.name." + o.id), j, max: o.max, preset: o.id }); }
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
  group(t("obj.builtin"), choices.filter((c) => c.preset));
  group(t("obj.saved"), choices.filter((c) => !c.preset));
  if (!cur) sel.appendChild(new Option(t("obj.custom", { dir: t(S.cfg.maximize ? "h.max" : "h.min"), name: r.n }), "custom"));
  sel.value = cur ? cur.key : "custom";
  $("deleteObjective").hidden = !cur || !!cur.preset;
  $("saveObjective").hidden = !!cur;
  $("objNote").innerHTML = cur?.preset ? t("obj.note." + cur.preset) : cur ? t("obj.note.user") : t("obj.note.custom");
}

function pickObjective(key) {
  const c = objectiveChoices().find((x) => x.key === key);
  if (!c) return;
  S.cfg.objective = c.j; S.cfg.maximize = c.max;
  renderObjective(); changed();
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
  renderObjective();
}

function deleteObjective() {
  const cur = currentObjective();
  if (!cur || cur.preset) return;
  const name = cur.key.slice(USER.length);
  if (!confirm(t("obj.deleteConfirm", { name }))) return;
  const all = userObjectives();
  delete all[name];
  try { localStorage.setItem("metflux.objectives", JSON.stringify(all)); } catch { /* ignore */ }
  renderObjective();
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
  let n = 0;
  for (let j = 0; j < mask.rxn.length; j++) {
    if (!mask.rxn[j]) continue;
    n++;
    rows.push([S.model.rxns[j].n, Math.abs(f.v[j] - f.ref.v[j]), j]);
  }
  if (!n) return `<h4>${t("sum.changed")}</h4><p class="meta">${t("sum.noChange")}</p>`;
  rows.sort((a, b) => b[1] - a[1]);
  const mx = rows[0][1];
  return `<h4>${t("sum.changed")}${small(t("sum.changedUnit", { n }))}</h4>` +
    bars(rows.slice(0, 12).map(([name, d, j]) => [name, `${fmtFlux(f.ref.v[j])} → ${fmtFlux(f.v[j])}`, `rxn:${j}`, d / mx]), "linear-gradient(90deg,#5a96ff,#ff9f5a)", true);
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
      <div class="card"><div class="lbl">${t(obj.obj ? "sum.growth" : "sum.objective")}</div><div class="big">${fmtFlux(f.objective)}<small>${obj.obj ? "h⁻¹" : "mmol/gDW/h"}</small></div>${vs}</div>
      <div class="card"><div class="lbl">${t("sum.active")}</div><div class="big">${active}<small>${t("sum.of", { n: model.rxns.length })}</small></div></div>
      ${f.biomass ? `<div class="card"><div class="lbl">${t("sum.biomass")}</div><div class="big">${f.biomass.toFixed(2)}<small>gDW/L</small></div></div>` : ""}
    </div>`;
  if (S.result.evList?.length) {
    h += `<h4>${t("sum.events")}</h4><div class="evlist">${S.result.evList.map((ev) => `<div class="${f.t > ev.t ? "done" : ""}">${esc(ev.type === "medium" ? t("sum.evMedium", { t: fmtTime(ev.t), name: mediumName(ev.mediumId) }) : t("sum.evAdd", { t: fmtTime(ev.t), c: ev.conc, name: eventName(ev) }))}</div>`).join("")}</div>`;
  }
  if (f.status !== "optimal") return h + `<div class="note">${t("sum.nosol", { why: esc(statusWhy(f.status)) })}</div>`;
  if (f.relaxed) h += `<div class="note">${t("sum.relaxed")}</div>`;
  if (Math.abs(f.objective) < 1e-9) h += `<div class="note">${t("sum.zero")}</div>`;
  if (f.ref) h += changedHtml(f);
  h += compare.summaryHtml(f);
  const fate = labelFate(f);
  if (fate) {
    h += `<h4>${t("sum.fate")}${small(t("sum.fateUnit"))}</h4>` +
      bars(fate.rows.slice(0, 10).map(([n, v, k]) => [n, (100 * v / fate.total).toFixed(1) + " %", k, v / fate.total]), "linear-gradient(90deg,#ffbe3c,#ff2d78)");
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
  h += `<div class="actions"><button data-act="supply">${t("met.addSupply")}</button><button data-act="label">${t("met.label")}</button></div>`;
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
  return `${midBars(r.dist, 0)}
    <div class="meta" style="margin-top:6px">${t("mid.caption", { n: r.n })}</div>${r.approx > 0.1 ? `<div class="note">${t("mid.approx", { p: Math.round(100 * r.approx) })}</div>` : ""}`;
}

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
  return `${midBars(r.dist, 0)}
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
    </dl>
    <div class="actions"><button data-act="perturb">${t("pert.button")}</button><button data-act="objective">${t("rxn.useObjective")}</button></div>
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
    <h4>${t("sub.top")}</h4>${bars(act.slice(0, 14).map(([n, v, k]) => [n, fmtFlux(v), k, v / mx]), "#4cc9f0") || `<p class="meta">${t("sub.none")}</p>`}`;
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
  return `<div class="kind">${t("gene.kind")}</div><h3>${esc(geneSymbol(ref))}</h3><div class="meta">${g ? esc(g[2] || "") + "<br>" + esc(g[0]) : ""}</div>
    <div class="actions"><button data-act="perturb">${t("pert.button")}</button></div>
    <p class="meta">${t("gene.mapHint")}</p>
    <h4>${t("gene.rxns", { n: rows.length })}</h4>${bars(rows.slice(0, 40).map(([n, v, k]) => [n, fmtFlux(v), k, v / mx]), "#b48cff")}`;
}

function renderDetails() {
  const box = $("details"), sel = S.sel;
  if (!S.model) return;
  map.marks = sel?.type === "gene" ? new Set(S.search.geneRxns.get(sel.sym) || []) : null;
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
    on("newRxnMet", () => editor.openRxnDialog({ seedMet: m }));
    on("newComp", () => editor.openMetDialog({ base: S.model.mets[m].b }));
    on("removeMet", () => editor.removeMet(m));
    const midBox = box.querySelector("#detMid");
    if (midBox && f?.e) fillMid(midBox, f, m);
    const cmpBox = box.querySelector("#detCmp");
    if (cmpBox) compare.fillMetCompare(cmpBox, f, m, () => (f.e ? currentMid(f, m) : null));
  } else if (sel?.type === "rxn") {
    on("objective", () => { S.cfg.objective = sel.rxn; renderObjective(); changed(); });
    on("perturb", () => addPerturb("rxn", sel.rxn));
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
function changeLanguage(lang) {
  setLang(lang);
  applyDom();
  if (!S.model) return;
  S.search = new SearchIndex(S.model, S.index);
  S.scenes = {}; // region and level labels are translated
  for (const k of [...S.subScenes.keys()]) if (String(k).startsWith("c")) S.subScenes.delete(k);
  $("docsBtn").href = "docs.html?lang=" + getLang();
  document.querySelectorAll("a[data-docs]").forEach((a) => { a.href = `docs.html?lang=${getLang()}#${getLang()}-${a.dataset.docs}`; });
  if (S.view.kind === "global") map.setScene(globalScene(), true);
  else if (S.view.kind === "sub" && isCascade()) map.setScene(subScene(S.view.ss), true);
  renderMediumSel(); renderSupplies(); renderMeasured(); renderPerturb(); renderEvents(); renderObjective(); renderCrumbs(); applyFrame(); renderDetails();
  editor.render(); compare.render(); renderEditBadge();
  if (S.statusFn) setStatus(S.statusFn, S.statusErr);
}

function bindUi() {
  attachSearch($("search"), $("searchResults"), () => S.search, onSearchPick);
  attachSearch($("addSupply"), $("addResults"), () => S.search, (it) => addSupply(pickSupplyMet(it.ref)), { filter: (it) => it.type === "met", limit: 80 });
  attachSearch($("addPerturb"), $("perturbResults"), () => S.search, (it) => addPerturb(it.type, it.ref), { filter: (it) => it.type === "gene" || it.type === "rxn", limit: 80 });
  attachSearch($("objInput"), $("objResults"), () => S.search, (it) => { S.cfg.objective = it.ref; renderObjective(); changed(); }, { filter: (it) => it.type === "rxn", limit: 120 });
  window.addEventListener("keydown", (ev) => {
    if ((ev.ctrlKey || ev.metaKey) && ev.key.toLowerCase() === "k") { ev.preventDefault(); $("search").focus(); $("search").select(); }
    else if (ev.key === "Escape" && S.view.kind !== "global" && document.activeElement === document.body && !document.querySelector("dialog[open]")) { S.sel = null; openGlobal(); renderDetails(); }
  });
  $("modelSelect").onchange = (ev) => loadModel(ev.target.value);
  $("langSel").onchange = (ev) => changeLanguage(ev.target.value);
  $("runBtn").onclick = run;
  $("autoBtn").onclick = toggleAuto;
  renderAuto();
  $("themeBtn").onclick = () => setTheme(document.documentElement.dataset.theme === "light" ? "dark" : "light");
  $("objPreset").onchange = (ev) => pickObjective(ev.target.value);
  $("saveObjective").onclick = saveObjective;
  $("deleteObjective").onclick = deleteObjective;
  $("methodsBtn").onclick = () => $("methodsDialog").showModal();
  $("modeToggle").querySelectorAll("button").forEach((b) => { b.onclick = () => setMode(b.dataset.mode); });
  $("resetMedium").onclick = () => loadMedium(S.mediumId);
  $("mediumSel").onchange = (ev) => loadMedium(ev.target.value);
  $("saveMedium").onclick = saveMedium;
  $("deleteMedium").onclick = deleteMedium;
  $("clearPerturb").onclick = () => { S.perturb = []; renderPerturb(); renderMeasured(); changed(); };
  $("measuredSel").onchange = (ev) => loadMeasured(ev.target.value);
  $("resetMeasured").onclick = () => loadMeasured(S.measured.set);
  $("measTol").onchange = (ev) => { S.measured.tol = Math.min(1, Math.max(0, (+ev.target.value || 0) / 100)); renderMeasured(); changed(); };
  attachSearch($("addMeasured"), $("measuredResults"), () => S.search, (it) => addMeasured(it.ref), { filter: (it) => it.type === "met" && S.index.metsOfBase[it.ref].some((m) => S.sim.exchanges.has(m)), limit: 80 });
  attachSearch($("addEvent"), $("eventResults"), () => S.search, (it) => addMetEvent(it.ref), { filter: (it) => it.type === "met" && S.index.metsOfBase[it.ref].some((m) => S.sim.exchanges.has(m)), limit: 80 });
  $("addMediumEvent").onclick = () => { S.events.push({ type: "medium", t: newEventTime(), mediumId: "default" }); renderEvents(); changed(); };
  $("clearEvents").onclick = () => { S.events = []; renderEvents(); changed(); };
  $("dynHours").addEventListener("change", renderEvents);
  $("objSense").onchange = (ev) => { S.cfg.maximize = ev.target.value === "max"; renderObjective(); changed(); };
  $("pfba").onchange = (ev) => { S.cfg.parsimonious = ev.target.checked; changed(); };
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
  $("saveScenario").onclick = () => compare.save();
  $("stopCompare").onclick = () => compare.setCompare(null);
  $("compareBadge").onclick = () => { S.sel = null; renderDetails(); };
  $("expAll").onclick = () => $("expList").querySelectorAll("input:not(:disabled)").forEach((x) => { x.checked = true; });
  $("expNone").onclick = () => $("expList").querySelectorAll("input").forEach((x) => { x.checked = false; });
  $("expGo").onclick = downloadResults;
  $("filterSel").onchange = (ev) => { S.filter = ev.target.value; applyFrame(); if (S.view.kind !== "list") map.fit(true, true); };
  $("optInactive").onchange = (ev) => { map.options.inactive = ev.target.checked; };
  $("optParticles").onchange = (ev) => { map.options.particles = ev.target.checked; };
  $("fitBtn").onclick = () => map.fit(true, false);
  $("timeSlider").oninput = (ev) => { stopPlay(); S.frameIdx = +ev.target.value; applyFrame(); renderDetails(); };
  $("playBtn").onclick = () => { if (S.playing) stopPlay(); else { if (S.frameIdx >= S.result.frames.length - 1) S.frameIdx = 0; startPlay(); } };
  if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) { map.options.particles = false; $("optParticles").checked = false; }
}

boot();
