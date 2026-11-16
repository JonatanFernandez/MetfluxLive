// Explorer of what a cell-type context switches off: blocked reactions (with pathway and the genes not detected)
// and genes not detected (with the reactions they block and their pathways). Filterable, sortable, CSV export.
// Used in the app (Knockout / knockdown section) and in the catalogue page (contexts.html).

import { t } from "../i18n.js";
import { offGenesOf } from "../core/contexts.js";

const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const norm = (s) => String(s || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
const MAX_ROWS = 400;

/**
 * @param box     container element
 * @param model   the (possibly edited) model
 * @param off     Set of gene symbols switched off
 * @param blocked Int32Array of blocked reaction indices
 * @param opts    { name: context name for the CSV file, onRxn(j), onGene(sym) }
 */
export function renderCtxTable(box, model, off, blocked, opts = {}) {
  const geneInfo = new Map(model.genes.map((g) => [g[1], g]));
  const rxRows = Array.from(blocked, (j) => {
    const r = model.rxns[j], genes = offGenesOf(r.g, off);
    return { j, name: r.n, id: r.id, path: model.subsystems[r.ss] || "", genes: genes.join(" ") };
  });
  const byGene = new Map([...off].map((g) => [g, { rx: 0, paths: new Set() }]));
  for (const row of rxRows) for (const g of row.genes.split(" ")) { const o = byGene.get(g); if (o) { o.rx++; o.paths.add(row.path); } }
  const geneRows = [...byGene].map(([g, o]) => ({ sym: g, gname: geneInfo.get(g)?.[2] || "", nrx: o.rx, paths: [...o.paths].sort().join("; ") }));
  const tabs = {
    rxns: { rows: rxRows, cols: [["name", "ctt.th.rxn"], ["id", "ctt.th.id"], ["path", "ctt.th.path"], ["genes", "ctt.th.offGenes"]] },
    genes: { rows: geneRows, cols: [["sym", "ctt.th.gene"], ["gname", "ctt.th.gname"], ["nrx", "ctt.th.nrx", 1], ["paths", "ctt.th.paths"]] },
  };
  let tab = "rxns", key = null, dir = 1;
  box.innerHTML = `<div class="ctt"><div class="ctt-bar"><button data-tab="rxns">${t("ctt.rxns", { n: rxRows.length })}</button><button data-tab="genes">${t("ctt.genes", { n: geneRows.length })}</button>
    <input type="search" placeholder="${esc(t("ctt.filter"))}" autocomplete="off" spellcheck="false"><button data-csv>${t("ctt.csv")}</button></div>
    <div class="ctt-count"></div><div class="ctt-scroll"><table><thead><tr></tr></thead><tbody></tbody></table></div><p class="ctt-note">${t("ctt.note")}</p></div>`;
  const q = box.querySelector("input"), head = box.querySelector("thead tr"), body = box.querySelector("tbody"), count = box.querySelector(".ctt-count");
  const visible = () => {
    const T = tabs[tab], words = norm(q.value).split(/\s+/).filter(Boolean);
    let rows = T.rows.filter((r) => { const hay = norm(Object.values(r).join(" | ")); return words.every((w) => hay.includes(w)); });
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
      const v = esc(r[k]);
      if (k === "name" && opts.onRxn) return `<td><span class="linkish" data-j="${r.j}">${v}</span></td>`;
      if (k === "sym" && opts.onGene) return `<td><span class="linkish" data-g="${v}">${v}</span></td>`;
      return `<td${num ? ' class="num"' : ""}>${v}</td>`;
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
      a.download = `celltype_${(opts.name || "context").replace(/[^\w.-]+/g, "_")}_${tab}.csv`;
      a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    }
  };
  head.onclick = (ev) => { const k = ev.target.closest("th")?.dataset.k; if (!k) return; dir = key === k ? -dir : 1; key = k; render(); };
  body.onclick = (ev) => {
    const el = ev.target.closest("[data-j],[data-g]");
    if (!el) return;
    if (el.dataset.j !== undefined) opts.onRxn?.(+el.dataset.j); else opts.onGene?.(el.dataset.g);
  };
  q.oninput = render;
  render();
}

export const CTT_CSS = `
.ctt-bar { display: flex; flex-wrap: wrap; gap: 6px; align-items: center; margin: 6px 0; }
.ctt-bar button { background: var(--panel2); border: 1px solid var(--line); border-radius: 6px; color: var(--text); padding: 2px 8px; cursor: pointer; font: inherit; font-size: 12px; }
.ctt-bar button.on { border-color: var(--accent); color: var(--accent); }
.ctt-bar input { flex: 1; min-width: 120px; background: var(--panel2); border: 1px solid var(--line); border-radius: 6px; color: var(--text); padding: 3px 6px; font: inherit; font-size: 12px; }
.ctt-count, .ctt-note { color: var(--muted); font-size: 11px; margin: 2px 0; }
.ctt-scroll { max-height: 360px; overflow: auto; border: 1px solid var(--line); border-radius: 6px; }
.ctt table { border-collapse: collapse; width: 100%; font-size: 12px; }
.ctt th, .ctt td { text-align: left; padding: 3px 6px; border-bottom: 1px solid var(--line); vertical-align: top; }
.ctt th { position: sticky; top: 0; background: var(--panel); cursor: pointer; white-space: nowrap; }
.ctt td.num { text-align: right; }
`;
