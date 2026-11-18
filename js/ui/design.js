// Tracer experiment designer: which commercially available tracer, and which metabolites to measure, tell two
// hypotheses apart (mode A: saved scenarios) or make one flux visible (mode B: a reaction at both ends of its
// flux range). For every tracer and situation the label is propagated on that situation's fluxes, isotopologue
// distributions of the measurable metabolites are sampled (whole cell: compartments mixed by their production
// flux), and each pair of situations is scored by how far apart its distributions are in units of the
// measurement error: sqrt(sum_k (p_k - q_k)^2) / sd. With more than two situations the worst-separated pair counts.

import { t } from "../i18n.js";
import { IsotopologueSampler, withNaturalAbundance } from "../core/isotopologues.js";
import { loadTracers, tracerLabel } from "../core/tracerlib.js";
import { attachSearch } from "./search.js";

const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const DEFAULT_TRACERS = ["glc_u", "glc_12", "glc_1", "gln_u", "gln_5", "lac_u"];
export const DEFAULT_MEASURED = ["L-lactate", "pyruvate", "alanine", "serine", "glycine", "citrate", "AKG", "succinate", "fumarate", "malate", "aspartate", "glutamate", "glutamine", "ribose-5-phosphate", "palmitate"];

export function createDesign(app) {
  const { S } = app;
  let dlg = null, lib = null, rxnPick = null, results = null;

  function build() {
    dlg = document.createElement("dialog");
    dlg.className = "editor design";
    dlg.innerHTML = `<form method="dialog"><header><h3>${t("des.title")}</h3><a class="link" data-docs="design" target="_blank" href="docs.html">${t("obj.help")}</a><span style="flex:1"></span><button class="icon" value="cancel" aria-label="${esc(t("h.close"))}">✕</button></header>
      <p class="hint">${t("des.intro")}</p>
      <div class="tabs des-mode"><button type="button" data-mode="A" class="on">${t("des.modeA")}</button><button type="button" data-mode="B">${t("des.modeB")}</button></div>
      <div class="des-A"><p class="hint">${t("des.modeAHint")}</p><div id="desScen"></div></div>
      <div class="des-B" hidden><p class="hint">${t("des.modeBHint")}</p><div class="add"><input id="desRxn" type="search" placeholder="${esc(t("des.rxnPh"))}" autocomplete="off" spellcheck="false"><div id="desRxnRes" class="dropdown" hidden></div></div><div id="desRxnSel" class="meta"></div></div>
      <h4>${t("des.tracers")}</h4><div id="desTracers" class="des-tracers"></div>
      <h4>${t("des.measured")}</h4><input id="desMeasured" type="text" spellcheck="false" style="width:100%"><p class="hint">${t("des.measuredHint")}</p>
      <div class="row"><label>${t("des.sd")} <input id="desSd" type="number" min="0.1" step="0.1" value="1" style="width:5em"> ${t("des.sdUnit")}</label>
        <label><input id="desNat" type="checkbox"> ${t("mid.natToggle")}</label></div>
      <footer><span id="desStatus" class="hint" style="flex:1"></span><button type="button" id="desRun" class="primary">${t("des.run")}</button></footer>
      <div id="desOut"></div></form>`;
    document.body.appendChild(dlg);
    dlg.querySelector(".des-mode").onclick = (ev) => {
      const b = ev.target.closest("[data-mode]"); if (!b) return;
      dlg.querySelectorAll(".des-mode button").forEach((x) => x.classList.toggle("on", x === b));
      dlg.querySelector(".des-A").hidden = b.dataset.mode !== "A"; dlg.querySelector(".des-B").hidden = b.dataset.mode !== "B";
    };
    attachSearch(dlg.querySelector("#desRxn"), dlg.querySelector("#desRxnRes"), () => S.search, (it) => { rxnPick = it.ref; dlg.querySelector("#desRxnSel").textContent = t("des.rxnChosen", { n: S.model.rxns[it.ref].n }); }, { filter: (it) => it.type === "rxn", limit: 60 });
    dlg.querySelector("#desRun").onclick = run;
    dlg.querySelector("#desOut").addEventListener("click", (ev) => { const c = ev.target.closest("[data-cell]"); if (c) showCell(...c.dataset.cell.split("|")); });
  }

  async function open() {
    lib = lib || (await loadTracers());
    if (!dlg) build();
    app.applyDocsLinks?.(dlg);
    // mode A: the current situation and the saved scenarios made on the same model edits
    const sc = S.scenarios.filter((x) => x.ctx.slug === S.slug && x.opsKey === app.opsKey());
    dlg.querySelector("#desScen").innerHTML = [`<label><input type="checkbox" data-sc="now" checked> ${esc(t("cmp.now"))}</label>`, ...sc.map((x, i) => `<label><input type="checkbox" data-sc="${x.id}"${i < 1 ? " checked" : ""}> ${esc(x.name)}</label>`)].join("") + (sc.length ? "" : `<p class="warn">${t("des.needScen")}</p>`);
    // tracers whose metabolite is in the current medium
    const inMedium = new Set(S.supplies.filter((it) => S.sim.exchanges.has(it.met)).map((it) => S.model.bases[S.model.mets[it.met].b].n));
    const groups = new Map();
    for (const tr of lib?.tracers || []) { if (!groups.has(tr.use)) groups.set(tr.use, []); groups.get(tr.use).push(tr); }
    dlg.querySelector("#desTracers").innerHTML = [...groups].map(([use, trs]) => `<div><b>${t("trl.use." + use)}</b> ${trs.map((tr) => {
      const ok = inMedium.has(tr.met);
      return `<label title="${esc(ok ? tr.item : t("des.notInMedium"))}" class="${ok ? "" : "off"}"><input type="checkbox" data-tr="${tr.id}"${ok && DEFAULT_TRACERS.includes(tr.id) ? " checked" : ""}${ok ? "" : " disabled"}> ${esc(tr.name)}</label>`;
    }).join(" ")}</div>`).join("");
    const known = new Set(S.model.bases.map((b) => b.n));
    if (!dlg.querySelector("#desMeasured").value) dlg.querySelector("#desMeasured").value = DEFAULT_MEASURED.filter((n) => known.has(n)).join(", ");
    dlg.showModal();
  }

  /** Whole-cell isotopologue distribution of a metabolite: compartments mixed by their production flux. */
  function wholeCellMid(sampler, v, base, nat, elements) {
    const { index, model } = S;
    const mets = index.metsOfBase[base].filter((m) => !model.mets[m].removed);
    const acc = []; let wsum = 0;
    for (const m of mets) {
      let prod = 0;
      for (let p = index.rxnStart[m]; p < index.rxnStart[m + 1]; p++) { const x = v[index.rxnList[p]] * index.rxnCoef[p]; if (x > 0) prod += x; }
      if (!(prod > 1e-9)) continue;
      const r = sampler.mid(m, 1200, 120);
      if (!r) continue;
      let d = r.dist;
      if (nat) d = withNaturalAbundance(d, model.bases[base].f, elements) || d;
      d.forEach((p, k) => { acc[k] = (acc[k] || 0) + prod * p; });
      wsum += prod;
    }
    return wsum > 0 ? acc.map((x) => (x || 0) / wsum) : null;
  }
  const dist = (p, q) => { let s = 0; for (let k = 0; k < Math.max(p.length, q.length); k++) { const d = (p[k] || 0) - (q[k] || 0); s += d * d; } return Math.sqrt(s); };
  const tick = () => new Promise((r) => setTimeout(r, 0));

  async function run() {
    const status = dlg.querySelector("#desStatus"), out = dlg.querySelector("#desOut");
    const modeB = !dlg.querySelector(".des-B").hidden;
    const sd = Math.max(0.1, +dlg.querySelector("#desSd").value || 1) / 100, nat = dlg.querySelector("#desNat").checked;
    const tracers = [...dlg.querySelectorAll("[data-tr]:checked")].map((x) => lib.tracers.find((tr) => tr.id === x.dataset.tr));
    const nameToBase = new Map(S.model.bases.map((b, i) => [b.n.toLowerCase(), i]));
    const measured = dlg.querySelector("#desMeasured").value.split(/[,;\n]/).map((x) => x.trim()).filter(Boolean);
    const bases = measured.map((n) => [n, nameToBase.get(n.toLowerCase())]).filter(([, b]) => b !== undefined);
    const unknown = measured.filter((n) => !nameToBase.has(n.toLowerCase()));
    // the situations to tell apart: { name, v, src }
    let sits = [];
    if (!modeB) {
      for (const cb of dlg.querySelectorAll("[data-sc]:checked")) {
        if (cb.dataset.sc === "now") { const f = app.frame(); if (f?.status === "optimal" && S.result.frames.length === 1) sits.push({ name: t("cmp.now"), v: f.v, src: f }); continue; }
        const sc = S.scenarios.find((x) => x.id === +cb.dataset.sc), f = sc?.result.frames[sc.result.frames.length - 1];
        if (f?.status === "optimal") sits.push({ name: sc.name, v: f.v, src: f });
      }
      if (sits.length < 2) { status.innerHTML = `<span class="warn">${t("des.need2")}</span>`; return; }
    } else {
      if (rxnPick === null) { status.innerHTML = `<span class="warn">${t("des.needRxn")}</span>`; return; }
      status.textContent = t("des.fva"); app.setProgress?.(true);
      const r = await S.sim.fluxRanges(app.runCfg(), S.supplies, [rxnPick], app.frame()?.ref?.v, { solutions: true, cycles: 0.05 });
      const [vmin, vmax] = r.solutions?.[0] || [];
      if (!vmin || !vmax || Math.abs(r.ranges[0][1] - r.ranges[0][0]) < 1e-6) { status.innerHTML = `<span class="warn">${t("des.fixedRxn")}</span>`; app.setProgress?.(null); return; }
      const src = app.frame();
      sits = [{ name: t("des.atMin", { x: app.fmtFlux(r.ranges[0][0]) }), v: vmin, src }, { name: t("des.atMax", { x: app.fmtFlux(r.ranges[0][1]) }), v: vmax, src }];
    }
    if (!tracers.length || !bases.length) { status.innerHTML = `<span class="warn">${t("des.needTracers")}</span>`; app.setProgress?.(null); return; }
    dlg.querySelector("#desRun").disabled = true;
    const t0 = performance.now(), mids = new Map(); // tracer id -> situation index -> base -> dist
    let k = 0;
    for (const tr of tracers) {
      const base = S.model.bases.findIndex((b) => b.n === tr.met), st = S.structures[S.model.bases[base].id], lab = tracerLabel(tr, st);
      const per = [];
      for (const sit of sits) {
        status.textContent = t("des.progress", { i: ++k, n: tracers.length * sits.length, s: Math.round((performance.now() - t0) / 1000) });
        app.setProgress?.((k - 1) / (tracers.length * sits.length));
        await tick();
        if (!lab) { per.push(null); continue; }
        const labels = new Map();
        for (const it of S.supplies) if (S.model.mets[it.met].b === base) labels.set(it.met, lab.label);
        const tr2 = S.sim.traceFlux(sit.v, sit.src, labels);
        const sampler = new IsotopologueSampler(S.sim.tracer, S.index, sit.v, tr2.inputs, tr2.e, lab.elements);
        const m = new Map();
        for (const [, b] of bases) m.set(b, wholeCellMid(sampler, sit.v, b, nat, lab.elements));
        per.push(m);
      }
      mids.set(tr.id, per);
    }
    // score: worst-separated pair of situations, in units of the measurement error
    const score = (tid, b) => {
      const per = mids.get(tid); let worst = Infinity;
      for (let i = 0; i < sits.length; i++) for (let j = i + 1; j < sits.length; j++) {
        const p = per[i]?.get(b), q = per[j]?.get(b);
        if (!p || !q) return null;
        worst = Math.min(worst, dist(p, q) / sd);
      }
      return worst;
    };
    const rows = tracers.map((tr) => {
      const cells = bases.map(([n, b]) => ({ n, b, s: score(tr.id, b) }));
      const top = cells.map((c) => c.s ?? 0).sort((a, b) => b - a).slice(0, 3);
      return { tr, cells, total: top.reduce((s, x) => s + x, 0) };
    }).sort((a, b) => b.total - a.total);
    results = { sits, mids, rows, bases, sd };
    app.setProgress?.(null);
    status.textContent = t("des.done", { s: Math.round((performance.now() - t0) / 1000) }) + (unknown.length ? " " + t("des.unknown", { list: unknown.join(", ") }) : "");
    dlg.querySelector("#desRun").disabled = false;
    render(out);
  }

  function render(out) {
    const { rows, bases, sits } = results, best = rows[0];
    const shade = (s) => (s === null ? "transparent" : `rgba(76,201,240,${Math.min(0.85, s / 20).toFixed(2)})`);
    const top3 = best.cells.filter((c) => c.s !== null).sort((a, b) => b.s - a.s).slice(0, 3);
    let h = `<div class="plain"><b>${t("des.best")}</b> ${t("des.bestText", { tr: esc(best.tr.name), item: esc(best.tr.item), list: top3.map((c) => `${esc(c.n)} (${c.s.toFixed(1)}×)`).join(", "), a: esc(sits[0].name), b: esc(sits[1].name) })}</div>`;
    h += `<div class="ctt-scroll"><table class="des-heat"><thead><tr><th>${t("des.thTracer")}</th>${bases.map(([n]) => `<th>${esc(n)}</th>`).join("")}</tr></thead><tbody>`;
    for (const r of rows) h += `<tr><td title="${esc(t("trl.use." + r.tr.use) + " · " + r.tr.item)}">${esc(r.tr.name)}</td>${r.cells.map((c) => `<td class="num" data-cell="${r.tr.id}|${c.b}" style="background:${shade(c.s)}" title="${esc(t("des.cellTitle"))}">${c.s === null ? "—" : c.s.toFixed(1)}</td>`).join("")}</tr>`;
    h += `</tbody></table></div><p class="hint">${t("des.heatNote", { sd: (results.sd * 100).toFixed(1) })}</p><div id="desCell"></div>`;
    out.innerHTML = h;
    const c = best.cells.filter((x) => x.s !== null).sort((a, b) => b.s - a.s)[0];
    if (c) showCell(best.tr.id, c.b);
  }

  /** Isotopologue distributions of one metabolite under one tracer, side by side for every situation. */
  function showCell(tid, b) {
    const box = dlg.querySelector("#desCell"), per = results.mids.get(tid), tr = lib.tracers.find((x) => x.id === tid);
    if (!box || !per) return;
    const name = S.model.bases[+b].n, K = Math.max(...per.map((m) => m?.get(+b)?.length || 0));
    const colors = ["#4cc9f0", "#ff9f5a", "#5fd38d", "#b48cff"];
    const W = 340, H = 140, P = 22, bw = (W - 2 * P) / Math.max(1, K) / (results.sits.length + 0.5);
    let bars = "";
    for (let k = 0; k < K; k++) results.sits.forEach((s, i) => {
      const p = per[i]?.get(+b)?.[k] || 0, x = P + (k * (results.sits.length + 0.5) + i) * bw, h = (H - 2 * P) * p;
      bars += `<rect x="${x.toFixed(1)}" y="${(H - P - h).toFixed(1)}" width="${(bw - 1).toFixed(1)}" height="${h.toFixed(1)}" fill="${colors[i % 4]}"><title>${esc(s.name)} M+${k}: ${(100 * p).toFixed(1)} %</title></rect>`;
    });
    for (let k = 0; k < K; k++) bars += `<text x="${(P + (k * (results.sits.length + 0.5) + results.sits.length / 2) * bw).toFixed(1)}" y="${H - 6}" text-anchor="middle" font-size="9" fill="var(--muted)">M+${k}</text>`;
    box.innerHTML = `<h4>${esc(name)} · ${esc(tr.name)}</h4><svg viewBox="0 0 ${W} ${H}" width="100%" style="max-width:520px">${bars}<line x1="${P}" y1="${H - P}" x2="${W - P}" y2="${H - P}" stroke="var(--line)"/></svg>
      <div class="des-legend">${results.sits.map((s, i) => `<span><i style="background:${colors[i % 4]}"></i>${esc(s.name)}</span>`).join("")}</div>`;
  }

  function reset() { dlg?.remove(); dlg = null; results = null; } // after a language change
  return { open, reset };
}
