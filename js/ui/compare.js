// Comparison mode: saved scenarios and the differences between one of them and the current situation.
//
// A scenario keeps its settings (medium, tracers, perturbations, events, model edits…), its result, and the
// model objects it was computed with, so that it can be compared after the model has been edited further:
// reactions and metabolites are matched by id.
import { t } from "../i18n.js";
import { escapeHtml as esc, fmtFlux, fmtTime } from "../modelindex.js";
import { IsotopologueSampler } from "../core/isotopologues.js";

const $ = (id) => document.getElementById(id);
const clamp1 = (x) => Math.max(-1, Math.min(1, x));
const small = (s) => ` <small style="color:var(--muted);font-weight:400">${s}</small>`;

/**
 * @param app { S, capture(): settings, opsKey(): string, load(scenario), run(), redraw(), gotoMet, openSubsystem, mediumName }
 */
export function createCompare(app) {
  const { S } = app;
  let seq = 0;

  // --------------------------------------------------------------- scenarios ----
  function save(name) {
    if (!S.result || S.result.frames[S.result.frames.length - 1].status !== "optimal") { alert(t("cmp.noResult")); return null; }
    const def = String.fromCharCode(65 + (S.scenarios.length % 26));
    const asked = name ?? prompt(t("cmp.namePrompt"), def);
    const nm = (asked || "").trim().slice(0, 40);
    if (!nm) return null;
    const old = S.scenarios.find((x) => x.name === nm);
    if (old && !confirm(t("cmp.overwrite", { name: nm }))) return null;
    const sc = {
      id: ++seq, name: nm, created: new Date(), settings: app.capture(), ops: S.edits.map((op) => ({ ...op })), opsKey: app.opsKey(),
      result: S.result, frameIdx: S.frameIdx, ctx: { model: S.model, index: S.index, tracer: S.sim.tracer, exchanges: S.sim.exchanges, structures: S.structures, slug: S.slug },
    };
    sc.summary = summarize(sc);
    if (old) S.scenarios.splice(S.scenarios.indexOf(old), 1, sc); else S.scenarios.push(sc);
    if (old && S.compare === old.id) S.compare = sc.id;
    render();
    return sc;
  }

  /** One line about what makes a scenario what it is. */
  function summarize(sc) {
    const s = sc.settings, f = sc.result.frames[sc.result.frames.length - 1];
    const parts = [app.mediumName(s.medium.id)];
    const tracers = s.medium.components.filter((c) => c.label?.length);
    if (tracers.length) parts.push("⚛ " + tracers.length);
    if (s.perturbations.length) parts.push(t("cmp.nPert", { n: s.perturbations.length }));
    if (sc.ops.length) parts.push(t("cmp.nEdits", { n: sc.ops.length }));
    if (s.mode === "dynamic") parts.push(t("cmp.dyn", { h: s.dynamic.hours, n: s.events.length }));
    return `${parts.join(" · ")} — ${t("cmp.obj")} ${fmtFlux(f.objective)}`;
  }

  const current = () => S.scenarios.find((x) => x.id === S.compare) || null;

  function setCompare(id) {
    S.compare = id;
    attach();
    render();
    app.redraw();
  }

  function remove(sc) {
    S.scenarios = S.scenarios.filter((x) => x !== sc);
    if (S.compare === sc.id) setCompare(null); else render();
  }

  function render() {
    const list = $("scenarioList");
    list.textContent = "";
    $("stopCompare").hidden = !S.compare;
    for (const sc of S.scenarios) {
      const other = sc.ctx.slug !== S.slug;
      const row = document.createElement("div");
      row.className = "scen" + (S.compare === sc.id ? " on" : "") + (other ? " off" : "");
      const pick = document.createElement("input"); pick.type = "radio"; pick.name = "scenPick"; pick.checked = S.compare === sc.id; pick.disabled = other;
      pick.title = other ? t("cmp.otherModel") : t("cmp.pickTitle", { name: sc.name });
      pick.onchange = () => setCompare(sc.id);
      const txt = document.createElement("div"); txt.className = "name";
      txt.innerHTML = `<b>${esc(sc.name)}</b><small>${esc(sc.summary)}</small>`;
      txt.title = other ? t("cmp.otherModel") : t("cmp.pickTitle", { name: sc.name });
      txt.onclick = () => { if (!other) setCompare(S.compare === sc.id ? null : sc.id); };
      const load = document.createElement("button"); load.textContent = "↺"; load.title = t("cmp.loadTitle", { name: sc.name });
      load.onclick = () => app.load(sc);
      const rm = document.createElement("button"); rm.textContent = "✕"; rm.title = t("cmp.removeTitle");
      rm.onclick = () => { if (confirm(t("cmp.removeConfirm", { name: sc.name }))) remove(sc); };
      row.append(pick, txt, load, rm);
      list.appendChild(row);
    }
    if (!S.scenarios.length) list.innerHTML = `<p class="hint">${t("cmp.empty")}</p>`;
    const sc = current();
    $("compareBadge").hidden = !sc;
    if (sc) $("compareBadge").innerHTML = t("cmp.badge", { name: esc(sc.name) });
  }

  // --------------------------------------------------------------- alignment ----
  /** Current model index -> index in the scenario's model (by id); null when they are the same model. */
  function alignment(sc) {
    const cur = S.model, ref = sc.ctx.model;
    if (cur === ref) return null;
    sc.align ||= new WeakMap();
    let a = sc.align.get(cur);
    if (a) return a;
    const rIdx = new Map(ref.rxns.map((r, j) => [r.id, j])), mIdx = new Map(ref.mets.map((m, i) => [m.id, i]));
    a = {
      rxn: Int32Array.from(cur.rxns, (r) => { const j = rIdx.get(r.id); return j === undefined || ref.rxns[j].removed ? -1 : j; }),
      met: Int32Array.from(cur.mets, (m) => { const i = mIdx.get(m.id); return i === undefined || ref.mets[i].removed ? -1 : i; }),
    };
    sc.align.set(cur, a);
    return a;
  }

  /** The scenario frame that corresponds to frame k of the current result. */
  function refFrameIdx(sc, k) {
    const F = sc.result.frames, cur = S.result.frames;
    if (F.length === 1) return 0;
    if (cur.length === 1) return Math.min(sc.frameIdx ?? F.length - 1, F.length - 1);
    const tt = cur[Math.min(k, cur.length - 1)].t;
    let best = 0;
    F.forEach((f, i) => { if (Math.abs(f.t - tt) < Math.abs(F[best].t - tt)) best = i; });
    return best;
  }

  function buildRef(sc, k) {
    const ri = refFrameIdx(sc, k), rf = sc.result.frames[ri], a = alignment(sc);
    const nR = S.model.rxns.length, nM = S.model.mets.length;
    let v = rf.v, metE = rf.metE || null;
    if (a) {
      v = new Float64Array(nR);
      for (let j = 0; j < nR; j++) if (a.rxn[j] >= 0) v[j] = rf.v[a.rxn[j]];
      if (metE) { metE = new Float32Array(nM); for (let m = 0; m < nM; m++) if (a.met[m] >= 0) metE[m] = rf.metE[a.met[m]]; }
    }
    return { v, objective: rf.objective, biomass: rf.biomass, status: rf.status, metE, scen: sc, frame: rf, frameIdx: ri, t: rf.t };
  }

  /** Point every frame of the current result at the compared scenario (or back at the perturbation reference). */
  function attach() {
    if (!S.result) return;
    const sc = current();
    S.result.frames.forEach((f, k) => {
      if (!("pertRef" in f)) f.pertRef = f.ref ?? null;
      f.ref = sc && sc.ctx.slug === S.slug ? buildRef(sc, k) : f.pertRef;
      delete f.flowsBy; delete f.masks; delete f.refFlows;
    });
  }

  // ---------------------------------------------------------------- analyses ----
  function exchangeRows(f) {
    const ref = f.ref, sc = ref.scen, a = alignment(sc), rows = [];
    const seen = new Set();
    for (const [met, ex] of S.sim.exchanges) {
      const x = f.v[ex.rxn] * ex.dir, y = ref.v[ex.rxn] * ex.dir;
      if (Math.abs(x) < 1e-9 && Math.abs(y) < 1e-9) continue;
      if (S.index.currency[S.model.mets[met].b]) continue;
      seen.add(met);
      rows.push({ met, name: S.model.bases[S.model.mets[met].b].n, a: y, b: x, d: x - y });
    }
    void a;
    return rows.sort((p, q) => Math.abs(q.d) - Math.abs(p.d));
  }

  function pathwayRows(f) {
    const n = S.model.subsystems.length, cur = new Float64Array(n), ref = new Float64Array(n);
    S.model.rxns.forEach((r, j) => { if (r.removed) return; cur[r.ss] += Math.abs(f.v[j]); ref[r.ss] += Math.abs(f.ref.v[j]); });
    const rows = [];
    for (let s = 0; s < n; s++) {
      const mx = Math.max(cur[s], ref[s]);
      if (mx < 1e-9 || S.index.isExchangeSub[s]) continue;
      rows.push({ ss: s, a: ref[s], b: cur[s], d: (cur[s] - ref[s]) / mx, abs: Math.abs(cur[s] - ref[s]) });
    }
    return rows.sort((p, q) => q.abs * Math.abs(q.d) - p.abs * Math.abs(p.d));
  }

  function labelRows(f) {
    const A = f.ref.metE, B = f.metE, rows = [];
    if (!A && !B) return rows;
    const turn = S.index.turnover(f.v), turnR = S.index.turnover(f.ref.v);
    for (let m = 0; m < S.model.mets.length; m++) {
      if (S.index.currency[S.model.mets[m].b] || (turn[m] < 1e-7 && turnR[m] < 1e-7)) continue;
      const a = A ? A[m] : 0, b = B ? B[m] : 0;
      if (Math.abs(b - a) < 0.005) continue;
      rows.push({ met: m, a, b, d: b - a });
    }
    return rows.sort((p, q) => Math.abs(q.d) - Math.abs(p.d));
  }

  const arrowRow = (label, a, b, key, share, cls = "") => `<div class="bar-row wide cmp ${cls}" data-go="${key}"><span class="nm" title="${esc(label)}">${esc(label)}</span><span class="val">${a} → ${b}</span><div class="bar"><i style="width:${Math.max(1.5, 100 * Math.abs(share))}%;background:${share >= 0 ? "#ff9f5a" : "#5a96ff"}"></i></div></div>`;

  /** Extra blocks of the summary panel while comparing. */
  function summaryHtml(f) {
    if (!f.ref?.scen) return "";
    const sc = f.ref.scen;
    let h = `<div class="note cmpnote">${t("cmp.summaryNote", { name: esc(sc.name), what: esc(sc.summary) })}${sc.result.frames.length > 1 || S.result.frames.length > 1 ? "<br>" + t("cmp.timeNote", { a: fmtTime(f.ref.t), b: fmtTime(f.t) }) : ""}${sc.opsKey !== app.opsKey() ? "<br>" + t("cmp.modelsDiffer") : ""}</div>`;
    const ex = exchangeRows(f).slice(0, 10);
    if (ex.length) {
      const mx = Math.max(...ex.map((r) => Math.abs(r.d)), 1e-12);
      h += `<h4>${t("cmp.exchanges")}${small(t("cmp.exchUnit"))}</h4>` + ex.map((r) => arrowRow(r.name, fmtFlux(r.a), fmtFlux(r.b), `met:${r.met}`, r.d / mx)).join("");
    }
    const pw = pathwayRows(f).slice(0, 8);
    if (pw.length) h += `<h4>${t("cmp.pathways")}${small(t("cmp.pathUnit"))}</h4>` + pw.map((r) => arrowRow(S.model.subsystems[r.ss], fmtFlux(r.a), fmtFlux(r.b), `sub:${r.ss}`, r.d)).join("");
    const lb = labelRows(f).slice(0, 10);
    if (lb.length) h += `<h4>${t("cmp.label")}${small(t("cmp.labelUnit"))}</h4>` + lb.map((r) => arrowRow(S.index.metName(r.met), (100 * r.a).toFixed(1), (100 * r.b).toFixed(1), `met:${r.met}`, clamp1(3 * r.d))).join("");
    else if (f.metE || f.ref.metE) h += `<h4>${t("cmp.label")}</h4><p class="meta">${t("cmp.labelSame")}</p>`;
    return h;
  }

  // ------------------------------------------------------- isotopologues of A ----
  function refSampler(ref) {
    const sc = ref.scen, rf = ref.frame, c = sc.ctx;
    if (!rf.e) return null;
    if (sc.result.frames.length === 1) return { mid: (m, n, ms) => (rf.sampler ||= new IsotopologueSampler(c.tracer, c.index, rf.v, rf.inputs, rf.e, rf.elements)).mid(m, n, ms) };
    const R = sc.result;
    if (!R.instant) return null;
    const els = R.frames.find((x) => x.e)?.elements;
    R.dynS ||= IsotopologueSampler.dynamic(c.tracer, c.index, R.frames, els, R.dyn.pool, R.instant);
    return { mid: (m, n, ms) => R.dynS.mid(m, n, ms, ref.frameIdx) };
  }

  /** Isotopologue distribution of metabolite m (current model index) in the compared scenario. */
  function refMid(f, m) {
    const ref = f.ref, a = alignment(ref.scen), rm = a ? a.met[m] : m;
    if (rm < 0) return { missing: true };
    const key = "mid:" + rm + ":" + ref.frameIdx;
    const cache = ref.scen.midCache || (ref.scen.midCache = new Map());
    if (cache.has(key)) return cache.get(key);
    const s = refSampler(ref);
    const r = s ? s.mid(rm, 2000, 220) : null;
    cache.set(key, r);
    return r;
  }

  /** Paired bars: scenario (A) and current (B). */
  function pairedMid(da, db) {
    const len = Math.max(da?.length || 0, db?.length || 0);
    let last = len - 1;
    while (last > 1 && (da?.[last] || 0) < 0.002 && (db?.[last] || 0) < 0.002) last--;
    const n = last + 1, every = n > 14 ? Math.ceil(n / 10) : 1;
    const col = (k) => {
      const a = da ? da[k] || 0 : 0, b = db ? db[k] || 0 : 0;
      return `<div class="col pair" title="M+${k}: ${(100 * a).toFixed(1)} % → ${(100 * b).toFixed(1)} %"><i class="a" style="height:${(100 * a).toFixed(1)}%"></i><i class="b" style="height:${(100 * b).toFixed(1)}%"></i></div>`;
    };
    return `<div class="mid paired">${Array.from({ length: n }, (_, k) => col(k)).join("")}</div>
      <div class="mid-axis">${Array.from({ length: n }, (_, k) => `<span>${k % every ? "" : n > 9 ? k : "M+" + k}</span>`).join("")}</div>`;
  }

  /** Fill the comparison block of the metabolite panel. @param cur () => current distribution (or null) */
  function fillMetCompare(box, f, m, cur) {
    const ref = f.ref;
    if (!ref?.scen) { box.hidden = true; return; }
    box.hidden = false;
    const sc = ref.scen, a = alignment(sc), rm = a ? a.met[m] : m;
    const eA = ref.metE ? ref.metE[m] : 0, eB = f.metE ? f.metE[m] : 0;
    let h = `<h4>${t("cmp.metTitle", { name: esc(sc.name) })}</h4>`;
    if (rm < 0) { box.innerHTML = h + `<p class="meta">${t("cmp.metMissing")}</p>`; return; }
    const turnR = (ref.v && S.index.turnover(ref.v)[m]) || 0, turn = S.index.turnover(f.v)[m];
    h += `<div class="cards"><div class="card"><div class="lbl">${t("cmp.turnover")}</div><div style="margin-top:6px">${fmtFlux(turnR)} → <b>${fmtFlux(turn)}</b></div></div>`;
    if (ref.metE || f.metE) h += `<div class="card"><div class="lbl">${t("cmp.enrich")}</div><div style="margin-top:6px">${(100 * eA).toFixed(1)} % → <b>${(100 * eB).toFixed(1)} %</b></div></div>`;
    h += `</div>`;
    box.innerHTML = h + `<div id="cmpMid"><p class="meta">${t("mid.computing")}</p></div>`;
    if (!ref.frame.e && !f.e) { box.querySelector("#cmpMid").innerHTML = `<p class="meta">${t("cmp.noLabelEither")}</p>`; return; }
    setTimeout(() => {
      if (!box.isConnected) return;
      const ra = ref.frame.e ? refMid(f, m) : null, da = ra && !ra.missing ? ra.dist : null;
      const cr = typeof cur === "function" ? cur() : cur, db = cr ? cr.dist : null;
      const host = box.querySelector("#cmpMid");
      if (!host) return;
      if (!da && !db) { host.innerHTML = `<p class="meta">${t("mid.none")}</p>`; return; }
      const unl = (d, o) => d || (o ? o.map((_, k) => (k ? 0 : 1)) : null); // no tracer: everything M+0
      host.innerHTML = pairedMid(unl(da, db), unl(db, da)) + `<div class="meta" style="margin-top:6px"><span class="sw a"></span> ${esc(sc.name)} &nbsp; <span class="sw b"></span> ${t("cmp.current")}<br>${t("cmp.midCaption")}</div>`;
    }, 40);
  }

  // ------------------------------------------------------------------- export ----
  function exportData() {
    const f = app.frame();
    if (!f?.ref?.scen) return null;
    return { name: f.ref.scen.name, summary: f.ref.scen.summary, exchanges: exchangeRows(f), pathways: pathwayRows(f), label: labelRows(f), refMid: (m) => refMid(f, m), t: f.ref.t };
  }

  return { save, render, attach, setCompare, current, summaryHtml, fillMetCompare, exportData, labelRows, alignment };
}
