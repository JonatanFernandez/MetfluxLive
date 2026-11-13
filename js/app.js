// MetfluxLive — application shell: state, panels, navigation and simulation control.
import { Simulator } from "./sim.js";
import { defaultMedium, uptakeCapacity } from "./core/medium.js";
import { gprActivity } from "./core/gpr.js";
import { ModelIndex, fmtFlux, fmtTime, escapeHtml as esc } from "./modelindex.js";
import { MapView, COMP_COLORS, enrichColor, deltaColor } from "./ui/mapview.js";
import { SearchIndex, attachSearch } from "./ui/search.js";
import { renderMolecule, tracerName } from "./ui/molecule.js";
import { buildCellLayout } from "./celllayout.js";
import { t, initLang, setLang, getLang, applyDom, LANGS } from "./i18n.js";

const $ = (id) => document.getElementById(id);
const S = {
  slug: null, model: null, structures: null, layout: null, index: null, search: null, sim: null,
  supplies: [], perturb: [], cfg: { objective: 0, maximize: true, parsimonious: true },
  mode: "steady", result: null, frameIdx: 0, stale: false,
  grouping: "pathway", filter: "all",
  view: { kind: "global", ss: -1 }, sel: null, runSeq: 0, playing: null,
  scenes: {}, subScenes: new Map(), cell: undefined, statusFn: null,
};
let map;
const small = (s) => ` <small style="color:var(--muted);font-weight:400">${s}</small>`;

// ------------------------------------------------------------------ boot ----
async function boot() {
  initLang();
  const ls = $("langSel");
  for (const [code] of LANGS) ls.add(new Option(code.toUpperCase(), code));
  ls.value = getLang();
  applyDom();
  try { const g = localStorage.getItem("metflux.grouping"); if (g === "cell" || g === "pathway") S.grouping = g; } catch { /* storage unavailable */ }
  map = new MapView($("map"), { onSelect: onMapSelect, onOpen: onMapOpen, onHover: onMapHover });
  bindUi();
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

async function loadModel(slug) {
  const loading = $("loading");
  loading.classList.remove("done");
  $("loadingText").textContent = t("load.model");
  const get = async (f) => {
    const r = await fetch(`data/${slug}/${f}`);
    if (!r.ok) throw new Error(`${f}: ${r.status}`);
    return r.json();
  };
  try {
    const [model, structures, atommaps, layout] = await Promise.all([get("model.json"), get("structures.json"), get("atommaps.json"), get("layout.json")]);
    S.sim?.dispose();
    Object.assign(S, { slug, model, structures, layout, result: null, sel: null, frameIdx: 0 });
    S.index = new ModelIndex(model, layout);
    S.search = new SearchIndex(model, S.index);
    $("loadingText").textContent = t("load.solver");
    S.sim = new Simulator(model, structures, atommaps);
    S.atommaps = atommaps;
    S.supplies = defaultMedium(model).map((it) => ({ ...it, label: null, fraction: 1 }));
    S.perturb = [];
    S.cfg = { objective: Math.max(0, S.index.biomassRxn), maximize: true, parsimonious: true };
    S.scenes = {}; S.subScenes = new Map(); S.cell = undefined;
    try { localStorage.setItem("metflux.model", slug); } catch { /* ignore */ }
    $("groupSel").querySelector('[value="cell"]').disabled = !cellLayout();
    if (!cellLayout()) S.grouping = "pathway";
    $("groupSel").value = S.grouping;
    renderSupplies(); renderPerturb(); renderObjective(); openGlobal(); renderDetails();
    loading.classList.add("done");
    run();
  } catch (err) {
    console.error(err);
    $("loadingText").textContent = t("load.error", { msg: err.message });
  }
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

// ----------------------------------------------------------------- scenes ----
function globalScene() {
  const key = groups().key;
  if (S.scenes[key]) return S.scenes[key];
  const listOnly = new Set(S.layout.listOnly);
  let sc;
  if (key === "cell") {
    const c = cellLayout();
    const nodes = c.nodes.map((n) => ({ ...n, label: S.model.subsystems[n.ss], listOnly: listOnly.has(n.ss) }));
    const regions = c.regions.map((r) => ({ ...r, label: locName(r.loc), color: COMP_COLORS[r.comp] || "#8fa3c8" }));
    sc = { kind: "global", cell: true, nodes, edges: [], regions };
  } else {
    const g = S.layout.global;
    const nodes = g.nodes.map((n) => ({ type: 2, ref: n.ss, ss: n.ss, x: n.x, y: n.y, size: n.n, r: n.r, label: S.model.subsystems[n.ss], listOnly: listOnly.has(n.ss) }));
    const at = new Map(nodes.map((n, i) => [n.ref, i]));
    const edges = g.edges.filter((e) => at.has(e[0]) && at.has(e[1])).map((e) => ({ a: at.get(e[0]), b: at.get(e[1]) }));
    sc = { kind: "global", nodes, edges };
  }
  return (S.scenes[key] = sc);
}

function subScene(ss) {
  if (S.subScenes.has(ss)) return S.subScenes.get(ss);
  const L = S.layout.subs[ss];
  if (!L) return null;
  const { model } = S;
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
  S.subScenes.set(ss, sc);
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
  a.textContent = t(isCell() ? "crumb.cell" : "crumb.global"); a.onclick = () => { S.sel = null; openGlobal(); renderDetails(); };
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
  else if (it.type === "gene") { S.sel = { type: "gene", sym: it.ref }; renderDetails(); }
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
  } else if (node.type === 1) {
    html += `<span>${S.model.rxns[node.ref].id} · ${t("tip.flux", { x: fmtFlux(f ? f.v[node.ref] : 0) })}${f?.ref ? t("tip.ref", { x: fmtFlux(f.ref.v[node.ref]) }) : ""}${node.pert !== undefined ? t("tip.activity", { x: Math.round(100 * node.pert) }) : ""}</span>`;
  } else {
    html += `<span>${map.scene.cell ? esc(locName(node.loc)) + "<br>" : ""}${t("tip.group", { n: node.size, x: fmtFlux(node.flux) })}${f?.metE ? t("tip.label", { x: (100 * node.e).toFixed(1) }) : ""}<br>${t("tip.open")}</span>`;
  }
  tip.innerHTML = html; tip.hidden = false;
  tip.style.left = Math.min(window.innerWidth - 330, x + 14) + "px"; tip.style.top = y + 14 + "px";
}

// ------------------------------------------------------------- simulation ----
const frame = () => (S.result ? S.result.frames[Math.min(S.frameIdx, S.result.frames.length - 1)] : null);
const frameTurnover = (f) => f.turnover || (f.turnover = S.index.turnover(f.v));

function frameFlows(f) {
  const G = groups(), cache = f.flowsBy || (f.flowsBy = {});
  return cache[G.key] || (cache[G.key] = S.index.groupFlows(f.v, f.metE, G, f.ref?.v));
}

/** The filter actually in force for a frame (the chosen one may not be available). */
function activeFilter(f) {
  if (S.filter === "label" && f?.metE) return "label";
  if (S.filter === "delta" && f?.ref) return "delta";
  return "all";
}

function frameMask(f, kind) {
  const cache = f.masks || (f.masks = {});
  return cache[kind] || (cache[kind] = kind === "label" ? S.index.labelMask(f.v, f.metE) : S.index.deltaMask(f.v, f.ref.v));
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

async function run() {
  const seq = ++S.runSeq;
  const btn = $("runBtn");
  btn.disabled = true;
  stopPlay();
  const t0 = performance.now();
  const pert = perturbActivities();
  const cfg = { ...S.cfg, perturb: [...pert] };
  const mode = S.mode;
  try {
    const dyn = { hours: +$("dynHours").value || 24, biomass: +$("dynBiomass").value || 0.5, pool: (+$("dynPool").value || 0.5) / 1000, frames: 30 };
    let res;
    if (mode === "steady") {
      setStatus(() => t("status.fba"));
      res = await S.sim.runSteady(cfg, S.supplies, S.structures, (phase) => { if (seq === S.runSeq) setStatus(() => t(phase === "ref" ? "status.ref" : "status.fba")); });
    } else {
      setStatus(() => t("status.dyn", { p: 0, t: fmtTime(0) }));
      res = await S.sim.runDynamic(cfg, S.supplies, S.structures, dyn, (p, fr, frames, phase) => {
        if (seq !== S.runSeq) return;
        const pc = Math.round(100 * p);
        if (phase === "ref") { setStatus(() => t("status.dynRef", { p: pc })); return; }
        setStatus(() => t("status.dyn", { p: pc, t: fmtTime(fr.t) }));
        // show frames as they are computed
        S.result = { frames, pert }; S.frameIdx = frames.length - 1;
        setupTimeline(); applyFrame();
        if (!S.sel) renderDetails();
      });
    }
    if (seq !== S.runSeq) return;
    res.pert = pert;
    S.result = res; S.stale = false;
    S.frameIdx = res.frames.length - 1;
    const last = res.frames[res.frames.length - 1];
    const secs = ((performance.now() - t0) / 1000).toFixed(1);
    if (last.status !== "optimal") setStatus(() => t("status.nosol", { why: statusWhy(last.status) }), true);
    else setStatus(() => t("status.done", { mode: mode === "steady" ? t("status.steady") : t("status.dynamic", { n: res.solves }), s: secs }) + (last.converged === false ? t("status.notconv") : ""));
    setupTimeline();
    applyFrame(); renderDetails();
    if (mode === "dynamic" && res.frames.length > 1) { S.frameIdx = 0; $("timeSlider").value = 0; applyFrame(); startPlay(); }
  } catch (err) {
    if (seq === S.runSeq) setStatus(() => t("status.error", { msg: err.message }), true);
    console.error(err);
  } finally {
    if (seq === S.runSeq) btn.disabled = false;
  }
}

let autoTimer = null;
function changed() {
  S.stale = true;
  clearTimeout(autoTimer);
  if (S.mode === "steady") autoTimer = setTimeout(run, 700);
  else setStatus(() => t("status.changed"));
}

function applyFrame() {
  const f = frame();
  // the filter options follow what the current result can answer
  const fs = $("filterSel");
  fs.querySelector('[value="label"]').disabled = !f?.metE;
  fs.querySelector('[value="delta"]').disabled = !f?.ref;
  const filt = activeFilter(f);
  fs.value = filt;
  const mode = filt === "delta" ? "delta" : f?.metE ? "tracer" : "flux";
  const mask = filt === "all" ? null : frameMask(f, filt);
  if (S.view.kind === "sub") {
    map.setData(f ? { v: f.v, turnover: frameTurnover(f), metE: f.metE, uncertain: f.uncertain, mode, mask, ref: f.ref?.v, perturb: S.result.pert } : {});
  } else if (S.view.kind === "global") {
    let gHas = null;
    if (mask) {
      const G = groups();
      gHas = new Uint8Array(G.n);
      for (let j = 0; j < mask.rxn.length; j++) if (mask.rxn[j] && G.groupOf[j] >= 0) gHas[G.groupOf[j]] = 1;
    }
    map.setData(f ? { ...frameFlows(f), mode, gHas, minE: filt === "label" ? 0.005 : 0 } : {});
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
  let h = `<div><b style="color:var(--text)">${t(sub ? "legend.rxnflux" : "legend.carbon")}</b>${t("legend.scale")}</div>`;
  if (mode === "tracer") h += `<div style="margin-top:6px">${t("legend.enrich")}</div>${ramp([0, 0.05, 0.2, 0.5, 1].map((x) => enrichColor(x)), ["0 %", "5", "20", "50", "100 %"])}<div>${t("legend.uncertain")}</div>`;
  if (mode === "delta") h += `<div style="margin-top:6px">${t("legend.delta")}</div>${ramp([-1, -0.3, 0, 0.3, 1].map((x) => deltaColor(x)), [t("legend.down"), t("legend.same"), t("legend.up")])}${sub ? `<div>${t("legend.lost")}</div>` : ""}`;
  if (sub && S.result?.pert?.size) h += `<div>${t("legend.pert")}</div>`;
  if (comps.length) h += `<div class="comps">${comps.map((c) => `<span><i style="border-color:${COMP_COLORS[c] || "#8fa3c8"}"></i>${esc(compName(c))}</span>`).join("")}</div>`;
  h += `<div style="margin-top:4px">${sub ? t("legend.subHint") : t("legend.globalHint") + (map.scene.cell ? "<br>" + t("legend.cellHint") : "")}</div>`;
  $("legend").innerHTML = h;
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
    row.className = "supply" + (!it.unlimited && it.conc !== it.conc0 ? " changed" : "");
    const name = document.createElement("div"); name.className = "name";
    name.innerHTML = `${esc(base.n)} <small>[${met.c}]</small>`;
    name.title = `${base.n} — ${compName(met.c)}${S.sim.exchanges.has(it.met) ? "" : t("supply.injection")}`;
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
function openMolEditor(it) {
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
    renderSupplies(); changed();
  };
  dlg.showModal();
}

// -------------------------------------------------------------- objective ----
function renderObjective() {
  const r = S.model.rxns[S.cfg.objective];
  $("objCurrent").textContent = `${r.id} · ${r.n}`;
  $("objCurrent").title = S.index.equation(S.cfg.objective);
  $("objSense").value = S.cfg.maximize ? "max" : "min";
  $("pfba").checked = S.cfg.parsimonious;
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
    vs = `<div class="delta ${pct < 0 ? "down" : pct > 0 ? "up" : ""}">${pct > 0 ? "+" : ""}${pct} % ${t("sum.vsref", { x: fmtFlux(r0) })}</div>`;
  }
  let h = `<div class="kind">${t("sum.title")}${S.result.frames.length > 1 ? " · t = " + fmtTime(f.t) : ""}</div><h3>${esc($("modelSelect").selectedOptions[0]?.text || model.meta.id || "")}</h3><div class="meta">${esc(model.meta.name || "")}</div>
    <div class="cards">
      <div class="card"><div class="lbl">${t(obj.obj ? "sum.growth" : "sum.objective")}</div><div class="big">${fmtFlux(f.objective)}<small>${obj.obj ? "h⁻¹" : "mmol/gDW/h"}</small></div>${vs}</div>
      <div class="card"><div class="lbl">${t("sum.active")}</div><div class="big">${active}<small>${t("sum.of", { n: model.rxns.length })}</small></div></div>
      ${f.biomass ? `<div class="card"><div class="lbl">${t("sum.biomass")}</div><div class="big">${f.biomass.toFixed(2)}<small>gDW/L</small></div></div>` : ""}
    </div>`;
  if (f.status !== "optimal") return h + `<div class="note">${t("sum.nosol", { why: esc(statusWhy(f.status)) })}</div>`;
  if (Math.abs(f.objective) < 1e-9) h += `<div class="note">${t("sum.zero")}</div>`;
  if (f.ref) h += changedHtml(f);
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
  const items = S.supplies.filter((it) => !it.unlimited && frames[0].conc?.has(it.met) && it.conc > 0)
    .map((it) => ({ it, end: frames[n - 1].conc.get(it.met) / it.conc }))
    .sort((a, b) => a.end - b.end).slice(0, 6);
  const colors = ["#ffbe3c", "#4cc9f0", "#5fd38d", "#ff7eb6", "#b48cff", "#ff9f5a"];
  const W = 300, H = 120, px = (k) => 6 + (k / (n - 1)) * (W - 12), py = (y) => H - 8 - Math.min(1.05, y) * (H - 16);
  const lines = items.map(({ it }, i) => `<polyline fill="none" stroke="${colors[i]}" stroke-width="1.6" points="${frames.map((f, k) => `${px(k).toFixed(1)},${py(f.conc.get(it.met) / it.conc).toFixed(1)}`).join(" ")}"/>`).join("");
  const cur = `<line x1="${px(S.frameIdx)}" x2="${px(S.frameIdx)}" y1="4" y2="${H - 4}" stroke="rgba(255,255,255,.5)" stroke-dasharray="3 3"/>`;
  return `<svg class="chart" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none">${lines}${cur}</svg>
    <div class="meta">${items.map(({ it }, i) => `<span style="color:${colors[i]}">■</span> ${esc(S.model.bases[S.model.mets[it.met].b].n)}`).join(" &nbsp; ")}<br>${t("sum.logAxis", { a: fmtTime(frames[0].t), b: fmtTime(frames[n - 1].t) })}</div>`;
}

function metHtml(m) {
  const { model, index } = S, met = model.mets[m], base = model.bases[met.b], f = frame();
  const st = S.structures[base.id];
  const ids = [["KEGG", base.kegg, "https://www.kegg.jp/entry/"], ["HMDB", base.hmdb, "https://hmdb.ca/metabolites/"], ["ChEBI", base.chebi, "https://www.ebi.ac.uk/chebi/searchId.do?chebiId="]]
    .filter((x) => x[1]).map(([k, v, url]) => `<a href="${url}${encodeURIComponent(v)}" target="_blank" rel="noopener">${k} ${esc(v)}</a>`).join(" · ");
  let h = `<div class="kind">${t("met.kind")}</div><h3>${esc(base.n)}</h3>
    <div class="meta">${esc(base.f || t("met.noFormula"))} · ${esc(met.id)}${ids ? "<br>" + ids : ""}</div>
    <div class="tabs">${index.metsOfBase[met.b].map((x) => `<button class="${x === m ? "on" : ""}" data-go="met:${x}">${esc(compName(model.mets[x].c))}</button>`).join("")}</div>`;
  if (st) {
    const en = f?.e ? S.sim.tracer.atomsEnrichment({ e: f.e }, m) : null;
    h += `<div class="molbox" id="detMol"></div>`;
    if (en) h += `<div class="meta">${t("met.meanEnrich", { x: `<b style="color:var(--hot)">${(100 * f.metE[m]).toFixed(1)} %</b>` })}</div>`;
    if (f?.uncertain?.[m]) h += `<div class="note">${t("met.uncertain")}</div>`;
  } else {
    h += `<div class="note">${t("met.noStruct")}${f?.metE ? t("met.noStructLabel", { x: (100 * f.metE[m]).toFixed(1) }) : ""}.</div>`;
  }
  h += `<div class="actions"><button data-act="supply">${t("met.addSupply")}</button><button data-act="label">${t("met.label")}</button></div>`;
  const prod = [], cons = [];
  for (let p = index.rxnStart[m]; p < index.rxnStart[m + 1]; p++) {
    const j = index.rxnList[p], x = f ? f.v[j] * index.rxnCoef[p] : 0;
    if (x > 1e-9) prod.push([model.rxns[j].n, x, `rxn:${j}`]); else if (x < -1e-9) cons.push([model.rxns[j].n, -x, `rxn:${j}`]);
  }
  const top = (arr, color) => { arr.sort((a, b) => b[1] - a[1]); const mx = arr.length ? arr[0][1] : 1; return bars(arr.slice(0, 10).map(([n, v, k]) => [n, fmtFlux(v), k, v / mx]), color); };
  if (prod.length || cons.length) {
    h += `<h4>${t("met.producedBy")}</h4>${top(prod, "#5fd38d") || '<p class="meta">—</p>'}<h4>${t("met.consumedBy")}</h4>${top(cons, "#4cc9f0") || '<p class="meta">—</p>'}`;
  } else {
    const n = index.rxnStart[m + 1] - index.rxnStart[m];
    h += `<h4>${t("met.rxns", { n })}${small(t("met.noFlux"))}</h4>` +
      Array.from(index.rxnList.subarray(index.rxnStart[m], Math.min(index.rxnStart[m + 1], index.rxnStart[m] + 12)), (j) => `<div class="bar-row" data-go="rxn:${j}"><span class="nm">${esc(model.rxns[j].n)}</span><span class="val">${model.rxns[j].id}</span></div>`).join("");
  }
  return h;
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
    const kind = { id: t("rxn.mapId"), map: "RXNMapper", mcs: t("rxn.mapMcs"), part: t("rxn.mapPart") }[am.k] || am.k;
    mapTxt = am.cur ? t("rxn.mapCurated") : `${kind}${am.c != null && am.k === "map" ? t("rxn.mapConf", { x: (+am.c).toFixed(2) }) : ""}${am.p ? t("rxn.mapIncomplete") : ""}`;
  }
  const act = S.result?.pert?.get(j);
  let note = "";
  if (act !== undefined) {
    note = `<div class="note" style="border-left-color:var(--danger)">${t("pert.active", { x: Math.round(100 * act) })}</div>`;
    if (act > 0 && f?.ref && Math.abs(f.ref.v[j]) <= 1e-9) note += `<div class="note">${t("pert.kdNoRef")}</div>`;
  }
  return `<div class="kind">${t("rxn.kind")}</div><h3>${esc(r.n)}</h3>
    <div class="meta">${r.id} · <span class="linkish" data-go="sub:${r.ss}">${esc(model.subsystems[r.ss])}</span></div>
    <div class="cards"><div class="card"><div class="lbl">${t("rxn.flux")}</div><div class="big">${fmtFlux(v)}<small>mmol/gDW/h</small></div>${f?.ref ? `<div class="delta">${t("rxn.ref")}: ${fmtFlux(f.ref.v[j])}</div>` : ""}</div>
    <div class="card"><div class="lbl">${t("rxn.bounds")}</div><div style="margin-top:6px">${fmtFlux(r.lb)} … ${fmtFlux(r.ub)}<br><span style="color:var(--muted);font-size:12px">${t(rev ? "rxn.reversible" : "rxn.irreversible")}</span></div></div></div>
    ${note}<div class="eq">${eq}</div>
    <dl class="kv">
      ${r.g ? `<dt>${t("rxn.genes")}</dt><dd>${esc(r.g)}</dd>` : ""}
      ${r.ec ? `<dt>EC</dt><dd>${esc(r.ec.join(", "))}</dd>` : ""}
      ${r.kegg ? `<dt>KEGG</dt><dd><a href="https://www.kegg.jp/entry/${encodeURIComponent(r.kegg)}" target="_blank" rel="noopener">${esc(r.kegg)}</a></dd>` : ""}
      ${r.rhea ? `<dt>Rhea</dt><dd>${esc(r.rhea)}</dd>` : ""}
      <dt>${t("rxn.atommap")}</dt><dd>${mapTxt}</dd>
    </dl>
    <div class="actions"><button data-act="perturb">${t("pert.button")}</button><button data-act="objective">${t("rxn.useObjective")}</button></div>`;
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
    <h4>${t("gene.rxns", { n: rows.length })}</h4>${bars(rows.slice(0, 40).map(([n, v, k]) => [n, fmtFlux(v), k, v / mx]), "#b48cff")}`;
}

function renderDetails() {
  const box = $("details"), sel = S.sel;
  if (!S.model) return;
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
  } else if (sel?.type === "rxn") {
    on("objective", () => { S.cfg.objective = sel.rxn; renderObjective(); changed(); });
    on("perturb", () => addPerturb("rxn", sel.rxn));
  } else if (sel?.type === "gene") on("perturb", () => addPerturb("gene", sel.sym));
  else if (sel?.type === "sub") on("open", () => openSubsystem(sel.ss));
  else if (sel?.type === "grp") on("open", () => openGroup(sel.g));
}

// --------------------------------------------------------------------- ui ----
function changeLanguage(lang) {
  setLang(lang);
  applyDom();
  if (!S.model) return;
  S.search = new SearchIndex(S.model, S.index);
  S.scenes = {}; // region labels are translated
  if (S.view.kind === "global") map.setScene(globalScene(), true);
  renderSupplies(); renderPerturb(); renderObjective(); renderCrumbs(); applyFrame(); renderDetails();
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
  $("methodsBtn").onclick = () => $("methodsDialog").showModal();
  $("modeToggle").querySelectorAll("button").forEach((b) => {
    b.onclick = () => {
      S.mode = b.dataset.mode;
      $("modeToggle").querySelectorAll("button").forEach((x) => x.classList.toggle("on", x === b));
      $("dynSection").hidden = S.mode !== "dynamic";
      run();
    };
  });
  $("resetMedium").onclick = () => { S.supplies = defaultMedium(S.model).map((it) => ({ ...it, label: null, fraction: 1 })); renderSupplies(); changed(); };
  $("clearPerturb").onclick = () => { S.perturb = []; renderPerturb(); changed(); };
  $("objSense").onchange = (ev) => { S.cfg.maximize = ev.target.value === "max"; changed(); };
  $("pfba").onchange = (ev) => { S.cfg.parsimonious = ev.target.checked; changed(); };
  for (const id of ["dynHours", "dynBiomass", "dynPool"]) $(id).onchange = changed;
  $("groupSel").onchange = (ev) => {
    S.grouping = ev.target.value;
    try { localStorage.setItem("metflux.grouping", S.grouping); } catch { /* ignore */ }
    S.sel = null; openGlobal(); renderDetails();
  };
  $("filterSel").onchange = (ev) => { S.filter = ev.target.value; applyFrame(); if (S.view.kind !== "list") map.fit(true, true); };
  $("optInactive").onchange = (ev) => { map.options.inactive = ev.target.checked; };
  $("optParticles").onchange = (ev) => { map.options.particles = ev.target.checked; };
  $("fitBtn").onclick = () => map.fit(true, false);
  $("timeSlider").oninput = (ev) => { stopPlay(); S.frameIdx = +ev.target.value; applyFrame(); renderDetails(); };
  $("playBtn").onclick = () => { if (S.playing) stopPlay(); else { if (S.frameIdx >= S.result.frames.length - 1) S.frameIdx = 0; startPlay(); } };
  if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) { map.options.particles = false; $("optParticles").checked = false; }
}

boot();
