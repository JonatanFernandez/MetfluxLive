// Explorer of what a cell-type context switches off: blocked reactions (with pathway and the genes not detected)
// and genes not detected (with the reactions they block and their pathways). Filterable, sortable, CSV export.
// Used in the app (Knockout / knockdown section) and in the catalogue page (contexts.html).

import { t } from "../i18n.js";
import { offGenesOf } from "../core/contexts.js";

const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const norm = (s) => String(s || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
const MAX_ROWS = 400;

/**
 * Generic tabbed table: tabs = { key: { label, cols: [[field, i18n key, numeric?]], rows: [{...}] } }, with a filter,
 * sortable columns, CSV export and clickable cells (opts.link(field, row) -> { attr, value } or null).
 */
export function renderTabs(box, tabs, opts = {}) {
  let tab = Object.keys(tabs)[0], key = null, dir = 1;
  box.innerHTML = `<div class="ctt"><div class="ctt-bar">${Object.entries(tabs).map(([k, T]) => `<button data-tab="${k}">${esc(T.label)}</button>`).join("")}
    <input type="search" placeholder="${esc(t("ctt.filter"))}" autocomplete="off" spellcheck="false"><button data-csv>${t("ctt.csv")}</button></div>
    <div class="ctt-count"></div><div class="ctt-scroll"><table><thead><tr></tr></thead><tbody></tbody></table></div>${opts.note ? `<p class="ctt-note">${opts.note}</p>` : ""}</div>`;
  const q = box.querySelector("input"), head = box.querySelector("thead tr"), body = box.querySelector("tbody"), count = box.querySelector(".ctt-count");
  const visible = () => {
    const T = tabs[tab], words = norm(q.value).split(/\s+/).filter(Boolean);
    let rows = T.rows.filter((r) => { const hay = norm(T.cols.map(([k]) => r[k]).join(" | ")); return words.every((w) => hay.includes(w)); });
    if (key) rows = rows.slice().sort((a, b) => dir * (typeof a[key] === "number" ? a[key] - b[key] : String(a[key]).localeCompare(String(b[key]))));
    return rows;
  };
  const render = () => {
    const T = tabs[tab];
    box.querySelectorAll("[data-tab]").forEach((b) => b.classList.toggle("on", b.dataset.tab === tab));
    head.innerHTML = T.cols.map(([k, l]) => `<th data-k="${k}">${esc(t(l))}${key === k ? (dir > 0 ? " ▲" : " ▼") : ""}</th>`).join("");
    const rows = visible();
    count.textContent = t("ctt.showing", { n: Math.min(rows.length, MAX_ROWS), total: rows.length });
    body.innerHTML = rows.slice(0, MAX_ROWS).map((r) => "<tr>" + T.cols.map(([k, , num]) => {
      const v = esc(r[k]), ln = opts.link?.(k, r);
      return ln ? `<td><span class="linkish" ${ln.attr}="${esc(ln.value)}">${v}</span></td>` : `<td${num ? ' class="num"' : ""}>${v}</td>`;
    }).join("") + "</tr>").join("");
  };
  box.querySelector(".ctt-bar").onclick = (ev) => {
    const b = ev.target.closest("button");
    if (!b) return;
    if (b.dataset.tab) { tab = b.dataset.tab; key = null; render(); }
    if (b.hasAttribute("data-csv")) {
      const T = tabs[tab], rows = visible(), cell = (x) => `"${String(x).replace(/"/g, '""')}"`;
      const csv = [T.cols.map(([, l]) => cell(t(l))).join(","), ...rows.map((r) => T.cols.map(([k]) => cell(r[k])).join(","))].join("\n");
      const a = document.createElement("a");
      a.href = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
      a.download = `${(opts.name || "table").replace(/[^\w.-]+/g, "_")}_${tab}.csv`;
      a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    }
  };
  head.onclick = (ev) => { const k = ev.target.closest("th")?.dataset.k; if (!k) return; dir = key === k ? -dir : 1; key = k; render(); };
  body.onclick = (ev) => { const el = ev.target.closest("[data-j],[data-g]"); if (!el) return; if (el.dataset.j !== undefined) opts.onRxn?.(+el.dataset.j); else opts.onGene?.(el.dataset.g); };
  q.oninput = render;
  render();
}

/**
 * What a context switches off: blocked reactions and genes not detected.
 * @param opts { name: for the CSV file, onRxn(j), onGene(sym) }
 */
export function renderCtxTable(box, model, off, blocked, opts = {}) {
  const geneInfo = new Map(model.genes.map((g) => [g[1], g]));
  const rxRows = Array.from(blocked, (j) => {
    const r = model.rxns[j];
    return { j, name: r.n, id: r.id, path: model.subsystems[r.ss] || "", genes: offGenesOf(r.g, off).join(" ") };
  });
  const byGene = new Map([...off].map((g) => [g, { rx: 0, paths: new Set() }]));
  for (const row of rxRows) for (const g of row.genes.split(" ")) { const o = byGene.get(g); if (o) { o.rx++; o.paths.add(row.path); } }
  const geneRows = [...byGene].map(([g, o]) => ({ sym: g, gname: geneInfo.get(g)?.[2] || "", nrx: o.rx, paths: [...o.paths].sort().join("; ") }));
  renderTabs(box, {
    rxns: { label: t("ctt.rxns", { n: rxRows.length }), rows: rxRows, cols: [["name", "ctt.th.rxn"], ["id", "ctt.th.id"], ["path", "ctt.th.path"], ["genes", "ctt.th.offGenes"]] },
    genes: { label: t("ctt.genes", { n: geneRows.length }), rows: geneRows, cols: [["sym", "ctt.th.gene"], ["gname", "ctt.th.gname"], ["nrx", "ctt.th.nrx", 1], ["paths", "ctt.th.paths"]] },
  }, { ...opts, name: "celltype_" + (opts.name || "context"), note: t("ctt.note"),
    link: (k, r) => (k === "name" && opts.onRxn ? { attr: "data-j", value: r.j } : k === "sym" && opts.onGene ? { attr: "data-g", value: r.sym } : null) });
}

/** Compare two contexts: pathways, reactions and genes switched off in only one of them. */
export function renderCtxCompare(box, model, a, b) {
  const geneInfo = new Map(model.genes.map((g) => [g[1], g]));
  const ba = new Set(a.blocked), bb = new Set(b.blocked);
  const paths = new Map();
  const bump = (j, k) => { const ss = model.rxns[j].ss; const o = paths.get(ss) || { a: 0, b: 0, onlyA: 0, onlyB: 0 }; o[k]++; paths.set(ss, o); };
  for (const j of ba) { bump(j, "a"); if (!bb.has(j)) bump(j, "onlyA"); }
  for (const j of bb) { bump(j, "b"); if (!ba.has(j)) bump(j, "onlyB"); }
  const pathRows = [...paths].filter(([, o]) => o.onlyA || o.onlyB).map(([ss, o]) => ({ path: model.subsystems[ss], a: o.a, b: o.b, onlyA: o.onlyA, onlyB: o.onlyB, diff: o.onlyA - o.onlyB }));
  pathRows.sort((x, y) => Math.abs(y.diff) - Math.abs(x.diff) || (y.onlyA + y.onlyB) - (x.onlyA + x.onlyB));
  const rxRow = (j, where) => ({ where, name: model.rxns[j].n, id: model.rxns[j].id, path: model.subsystems[model.rxns[j].ss] || "", genes: offGenesOf(model.rxns[j].g, where === a.name ? a.off : b.off).join(" ") });
  const rxRows = [...[...ba].filter((j) => !bb.has(j)).map((j) => rxRow(j, a.name)), ...[...bb].filter((j) => !ba.has(j)).map((j) => rxRow(j, b.name))];
  const gRow = (g, where) => ({ where, sym: g, gname: geneInfo.get(g)?.[2] || "" });
  const gRows = [...[...a.off].filter((g) => !b.off.has(g)).map((g) => gRow(g, a.name)), ...[...b.off].filter((g) => !a.off.has(g)).map((g) => gRow(g, b.name))];
  const nA = rxRows.filter((r) => r.where === a.name).length;
  box.insertAdjacentHTML("beforeend", "");
  const sum = `<p class="ctt-sum">${t("cmpc.summary", { a: esc(a.name), b: esc(b.name), ra: nA, rb: rxRows.length - nA, ga: gRows.filter((r) => r.where === a.name).length, gb: gRows.filter((r) => r.where !== a.name).length, both: [...ba].filter((j) => bb.has(j)).length })}</p>`;
  const holder = document.createElement("div");
  box.innerHTML = sum; box.appendChild(holder);
  renderTabs(holder, {
    paths: { label: t("cmpc.paths", { n: pathRows.length }), rows: pathRows, cols: [["path", "ctt.th.path"], ["onlyA", "cmpc.onlyA"], ["onlyB", "cmpc.onlyB"], ["a", "cmpc.blockedA"], ["b", "cmpc.blockedB"]].map(([k, l]) => [k, l, k !== "path"]) },
    rxns: { label: t("ctt.rxns", { n: rxRows.length }), rows: rxRows, cols: [["where", "cmpc.where"], ["name", "ctt.th.rxn"], ["id", "ctt.th.id"], ["path", "ctt.th.path"], ["genes", "ctt.th.offGenes"]] },
    genes: { label: t("ctt.genes", { n: gRows.length }), rows: gRows, cols: [["where", "cmpc.whereGene"], ["sym", "ctt.th.gene"], ["gname", "ctt.th.gname"]] },
  }, { name: `compare_${a.name}_vs_${b.name}`, note: t("cmpc.note", { a: esc(a.name), b: esc(b.name) }) });
}

export const CTT_CSS = `
.ctt-bar { display: flex; flex-wrap: wrap; gap: 6px; align-items: center; margin: 6px 0; }
.ctt-bar button { background: var(--panel2); border: 1px solid var(--line); border-radius: 6px; color: var(--text); padding: 2px 8px; cursor: pointer; font: inherit; font-size: 12px; }
.ctt-bar button.on { border-color: var(--accent); color: var(--accent); }
.ctt-bar input { flex: 1; min-width: 120px; background: var(--panel2); border: 1px solid var(--line); border-radius: 6px; color: var(--text); padding: 3px 6px; font: inherit; font-size: 12px; }
.ctt-count, .ctt-note { color: var(--muted); font-size: 11px; margin: 2px 0; }
.ctt-sum { font-size: 13px; margin: 6px 0; }
.ctt-scroll { max-height: 360px; overflow: auto; border: 1px solid var(--line); border-radius: 6px; }
.ctt table { border-collapse: collapse; width: 100%; font-size: 12px; }
.ctt th, .ctt td { text-align: left; padding: 3px 6px; border-bottom: 1px solid var(--line); vertical-align: top; }
.ctt th { position: sticky; top: 0; background: var(--panel); cursor: pointer; white-space: nowrap; }
.ctt td.num, .ctt th { text-align: center; } /* numbers under centred headers read better in wide tables */
`;
