// Unified search over metabolites, reactions (enzymes), genes and pathways.

import { t } from "../i18n.js";

const norm = (s) => String(s || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");

export class SearchIndex {
  constructor(model, index) {
    const items = [];
    model.subsystems.forEach((s, i) => items.push({ type: "sub", ref: i, title: s, sub: t("search.nRxns", { n: index.rxnsOfSub[i].length }), hay: norm(s), w: 3 }));
    model.bases.forEach((b, i) => {
      const comps = index.metsOfBase[i].map((m) => model.mets[m].c).join(", ");
      items.push({
        type: "met", ref: i, title: b.n, sub: [b.f, comps && t("search.comps", { c: comps })].filter(Boolean).join(" · "),
        hay: norm([b.n, b.id, b.f, b.kegg, b.hmdb, b.chebi, b.bigg].filter(Boolean).join(" | ")), name: norm(b.n), w: 2,
      });
    });
    model.rxns.forEach((r, j) => {
      items.push({
        type: "rxn", ref: j, title: r.n === r.id ? r.id : r.n, sub: [r.id, r.ec && "EC " + r.ec.join(", "), model.subsystems[r.ss]].filter(Boolean).join(" · "),
        hay: norm([r.n, r.id, r.ec && r.ec.join(" "), r.kegg, r.rhea, r.bigg].filter(Boolean).join(" | ")), name: norm(r.n), w: 1,
      });
    });
    // gene -> reactions
    const bySymbol = new Map();
    model.rxns.forEach((r, j) => {
      if (!r.g) return;
      for (const tok of new Set(r.g.split(/[\s()]+/))) {
        if (!tok || tok === "and" || tok === "or") continue;
        let l = bySymbol.get(tok); if (!l) bySymbol.set(tok, (l = [])); l.push(j);
      }
    });
    this.geneRxns = bySymbol;
    for (const [id, sym, name] of model.genes) {
      const ref = bySymbol.has(sym) ? sym : id; // the token used in the GPR rules
      const rx = bySymbol.get(ref) || [];
      if (!rx.length) continue;
      items.push({ type: "gene", ref, title: sym || id, sub: [name, t("search.nRxns", { n: rx.length })].filter(Boolean).join(" · "), hay: norm([sym, id, name].join(" | ")), name: norm(sym), w: 2 });
    }
    this.items = items;
  }

  query(q, limit = 40) {
    q = norm(q).trim();
    if (q.length < 2) return [];
    const words = q.split(/\s+/);
    const out = [];
    for (const it of this.items) {
      let score = 0, ok = true;
      for (const w of words) {
        const p = it.hay.indexOf(w);
        if (p < 0) { ok = false; break; }
        const boundary = p === 0 || /[\s|,;:()\-\[\]\/]/.test(it.hay[p - 1]);
        score += boundary ? 6 : 2;
      }
      if (!ok) continue;
      const name = it.name ?? it.hay;
      if (name === q) score += 60;
      else if (name.startsWith(q)) score += 30;
      score += it.w - Math.min(8, name.length / 12);
      out.push([score, it]);
    }
    out.sort((a, b) => b[0] - a[0]);
    return out.slice(0, limit).map((x) => x[1]);
  }
}

/** Attach a dropdown search to an <input>. */
export function attachSearch(input, listEl, getIndex, onPick, opts = {}) {
  let results = [], active = 0;
  const render = () => {
    listEl.textContent = "";
    if (!results.length) { listEl.hidden = true; return; }
    results.forEach((it, i) => {
      const row = document.createElement("div");
      row.className = "sr-row" + (i === active ? " active" : "");
      const badge = document.createElement("span"); badge.className = `badge b-${it.type}`; badge.textContent = t("search." + it.type);
      const txt = document.createElement("div"); txt.className = "sr-text";
      const title = document.createElement("div"); title.className = "sr-title"; title.textContent = it.title;
      const subtitle = document.createElement("div"); subtitle.className = "sr-sub"; subtitle.textContent = it.sub;
      txt.append(title, subtitle); row.append(badge, txt);
      row.addEventListener("mousedown", (ev) => { ev.preventDefault(); pick(i); });
      listEl.appendChild(row);
    });
    listEl.hidden = false;
    listEl.children[active]?.scrollIntoView({ block: "nearest" });
  };
  const pick = (i) => {
    const it = results[i];
    if (!it) return;
    listEl.hidden = true; input.blur();
    if (opts.clear !== false) input.value = "";
    onPick(it);
  };
  const run = () => {
    const idx = getIndex();
    results = idx ? idx.query(input.value, opts.limit || 40) : [];
    if (opts.filter) results = results.filter(opts.filter);
    active = 0; render();
  };
  input.addEventListener("input", run);
  input.addEventListener("focus", run);
  input.addEventListener("blur", () => setTimeout(() => { listEl.hidden = true; }, 120));
  input.addEventListener("keydown", (ev) => {
    if (ev.key === "ArrowDown") { active = Math.min(results.length - 1, active + 1); render(); ev.preventDefault(); }
    else if (ev.key === "ArrowUp") { active = Math.max(0, active - 1); render(); ev.preventDefault(); }
    else if (ev.key === "Enter") { pick(active); ev.preventDefault(); }
    else if (ev.key === "Escape") { listEl.hidden = true; input.blur(); }
  });
}
