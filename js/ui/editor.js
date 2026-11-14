// Model editor: list of edits, reaction and metabolite dialogs, removals.
// Edits are operations (js/core/edits.js) re-applied on the published model; this module only builds them.
import { t } from "../i18n.js";
import { escapeHtml as esc, fmtFlux } from "../modelindex.js";
import { attachSearch } from "./search.js";
import { renderMolecule } from "./molecule.js";
import { checkReaction, checkMetabolite, modelLookups, applyEdits, modelIssues, freeIds, hasErrors, BOUND_MAX } from "../core/edits.js";
import { loadRDKit, rdkitReady, smilesToStructure, mcsMap, mapFromMappedSmiles } from "../core/chem.js";

const $ = (id) => document.getElementById(id);
const ICON = { error: "✕", warn: "⚠", info: "ℹ" };

/** Translated list of validation messages. */
export function issuesHtml(list) {
  if (!list.length) return `<div class="iss ok">✓ ${t("chk.allGood")}</div>`;
  const order = { error: 0, warn: 1, info: 2 };
  return [...list].sort((a, b) => order[a.level] - order[b.level]).map((x) => `<div class="iss ${x.level}"><b>${ICON[x.level]}</b><span>${t(x.key, x.args)}</span></div>`).join("");
}

/** Short description of an operation for the edit list. */
export function describeOp(model, op) {
  const L = modelLookups(model);
  const metName = (id) => { const m = L.met.get(id); return m === undefined ? id : `${model.bases[model.mets[m].b].n} [${model.mets[m].c}]`; };
  const rxnName = (id) => { const j = L.rxn.get(id); return j === undefined ? id : model.rxns[j].n; };
  if (op.op === "addMet") return { icon: "+", text: op.base ? t("ed.op.addMetComp", { name: metName(op.base + op.comp), c: op.comp }) : t("ed.op.addMet", { name: op.name, c: op.comp }) };
  if (op.op === "removeMet") return { icon: "−", text: t("ed.op.removeMet", { name: metName(op.id) }) };
  if (op.op === "addRxn") return { icon: "+", text: t("ed.op.addRxn", { name: op.name || op.id, id: op.id }) };
  if (op.op === "removeRxn") return { icon: "−", text: t("ed.op.removeRxn", { name: rxnName(op.id), id: op.id }) };
  if (op.op === "editRxn") {
    const what = [op.lb !== undefined || op.ub !== undefined ? t("ed.op.bounds", { lb: op.lb, ub: op.ub }) : null, op.gpr !== undefined ? t("ed.op.gpr", { g: op.gpr || "—" }) : null, op.name !== undefined ? t("ed.op.name") : null].filter(Boolean).join(", ");
    return { icon: "✎", text: t("ed.op.editRxn", { name: rxnName(op.id), id: op.id, what }) };
  }
  return { icon: "?", text: op.op };
}

/**
 * @param app { S, setEdits(ops), gotoReaction(j), gotoMet(m), notify(msg) }
 */
export function createEditor(app) {
  const { S } = app;

  // ----------------------------------------------------------------- panel ----
  function render() {
    const sec = $("secEdits");
    sec.hidden = !S.editMode && !S.edits.length;
    if (sec.hidden) return;
    const E = S.edited, ops = S.edits;
    const nErr = E ? E.results.filter((r) => !r.ok).length : 0;
    $("editSummary").innerHTML = ops.length ? t("ed.summary", { n: ops.length, model: esc(S.model.meta.name ? S.model.meta.id + " " + S.model.meta.version : S.slug) }) + (nErr ? ` <b class="err">${t("ed.summaryErr", { n: nErr })}</b>` : "") : t("ed.none");
    $("editTools").hidden = !S.editMode;
    $("discardEdits").hidden = !ops.length;
    const list = $("editList");
    list.textContent = "";
    ops.forEach((op, i) => {
      const d = describeOp(S.model, op), res = E?.results[i];
      const row = document.createElement("div");
      const lvl = !res ? "" : !res.ok ? "error" : res.issues.some((x) => x.level === "warn") ? "warn" : "ok";
      row.className = "editrow " + lvl;
      const ic = document.createElement("span"); ic.className = "op"; ic.textContent = d.icon;
      const txt = document.createElement("div"); txt.className = "name"; txt.textContent = d.text;
      txt.title = res ? res.issues.map((x) => ICON[x.level] + " " + t(x.key, x.args)).join("\n") || t("chk.allGood") : "";
      txt.onclick = () => focusOp(op);
      const st = document.createElement("span"); st.className = "st"; st.textContent = lvl === "error" ? "✕" : lvl === "warn" ? "⚠" : "✓"; st.title = txt.title;
      row.append(ic, txt, st);
      if (S.editMode && (op.op === "addRxn" || op.op === "editRxn" || op.op === "addMet")) {
        const ed = document.createElement("button"); ed.textContent = "✎"; ed.title = t("ed.editOp");
        ed.onclick = () => (op.op === "addMet" ? openMetDialog({ op, index: i }) : openRxnDialog({ op, index: i }));
        row.appendChild(ed);
      } else row.appendChild(document.createElement("span"));
      const rm = document.createElement("button"); rm.textContent = "✕"; rm.title = t("ed.undoOp");
      rm.onclick = () => app.setEdits(ops.filter((x) => x !== op));
      rm.hidden = !S.editMode;
      row.appendChild(rm);
      list.appendChild(row);
    });
    const glob = E ? modelIssues(E) : [];
    $("editIssues").innerHTML = glob.length ? `<h4>${t("ed.modelChecks")}</h4>${issuesHtml(glob)}` : "";
  }

  function focusOp(op) {
    const L = modelLookups(S.model);
    if (op.op === "addRxn" || op.op === "removeRxn" || op.op === "editRxn") { const j = L.rxn.get(op.id); if (j !== undefined && !S.model.rxns[j].removed) app.gotoReaction(j); }
    else { const m = L.met.get(op.op === "addMet" ? (op.base || "") + op.comp : op.id) ?? S.model.mets.findIndex((x) => x.user && S.model.bases[x.b].n === op.name && x.c === op.comp); if (m >= 0 && !S.model.mets[m].removed) app.gotoMet(m); }
  }

  // ------------------------------------------------------------- removals ----
  function consequences(extra) {
    const E = applyEdits({ model: S.base.model, structures: S.base.structures, atommaps: S.base.atommaps }, [...S.edits, ...extra]);
    const before = new Set(modelIssues(S.edited).map((x) => x.args.id));
    return modelIssues(E).filter((x) => x.key.startsWith("chk.dead.") && !before.has(x.args.id)).map((x) => "  • " + t(x.key, x.args));
  }

  function removeRxn(j) {
    const r = S.model.rxns[j];
    if (r.obj || j === S.cfg.objective) { alert(t("ed.cantRemoveObjective")); return; }
    if (r.user) { // an added reaction: drop its operation instead
      if (!confirm(t("ed.confirmDropAdded", { name: r.n }))) return;
      app.setEdits(S.edits.filter((op) => !(op.op === "addRxn" && op.id === r.id)));
      return;
    }
    const op = { op: "removeRxn", id: r.id };
    const cons = consequences([op]);
    if (!confirm(t("ed.confirmRemoveRxn", { name: r.n, id: r.id }) + (cons.length ? "\n\n" + t("ed.consequences") + "\n" + cons.slice(0, 12).join("\n") + (cons.length > 12 ? "\n  …" : "") : ""))) return;
    app.setEdits([...S.edits, op]);
  }

  function removeMet(m) {
    const met = S.model.mets[m], name = `${S.model.bases[met.b].n} [${met.c}]`;
    const users = S.model.rxns.map((r, j) => [r, j]).filter(([r]) => !r.removed && r.m.includes(m));
    if (users.some(([r, j]) => r.obj || j === S.cfg.objective)) { alert(t("ed.metInObjective", { name })); return; }
    const ops = users.map(([r]) => ({ op: "removeRxn", id: r.id }));
    ops.push({ op: "removeMet", id: met.id });
    const cons = consequences(ops);
    const msg = users.length ? t("ed.confirmRemoveMetUsed", { name, n: users.length, list: users.slice(0, 8).map(([r]) => "  • " + r.id + " " + r.n).join("\n") + (users.length > 8 ? "\n  …" : "") }) : t("ed.confirmRemoveMet", { name });
    if (!confirm(msg + (cons.length ? "\n\n" + t("ed.consequences") + "\n" + cons.slice(0, 12).join("\n") : ""))) return;
    // added reactions are dropped rather than removed
    const userIds = new Set(users.filter(([r]) => r.user).map(([r]) => r.id));
    const kept = S.edits.filter((op) => !(op.op === "addRxn" && userIds.has(op.id)));
    app.setEdits([...kept, ...ops.filter((op) => !userIds.has(op.id))]);
  }

  // ---------------------------------------------------------- reaction dialog ----
  // draft rows: { base: base id, comp, coef (signed) }
  let D = null;

  function openRxnDialog({ op = null, index = -1, j = null, seedMet = null, copyOf = null } = {}) {
    const model = S.model, dlg = $("rxnDialog");
    const existing = j !== null && !model.rxns[j].user ? model.rxns[j] : null; // a published reaction: bounds, GPR and name only
    const src = op && op.op === "addRxn" ? op : copyOf !== null ? { ...rxnToOp(copyOf), id: freeIds(model).rxn } : existing ? rxnToOp(j) : null;
    const editOp = op && op.op === "editRxn" ? op : null;
    D = {
      index, existing: existing || (editOp ? model.rxns[modelLookups(model).rxn.get(editOp.id)] : null),
      id: src?.id || editOp?.id || freeIds(model).rxn, name: src?.name || "", subsystem: src?.subsystem || "",
      rows: src ? src.mets.map(([id, c]) => { const m = modelLookups(model).met.get(id); return { base: model.bases[model.mets[m].b].id, comp: model.mets[m].c, coef: c }; }) : [],
      lb: src?.lb ?? 0, ub: src?.ub ?? BOUND_MAX, gpr: src?.gpr || "", ec: src?.ec || "", unbalancedOk: !!src?.unbalancedOk,
      atommap: copyOf !== null ? null : src?.atommap || null, mapMode: src?.atommap ? (src.atommap.k === "user" ? "smiles" : "auto") : "auto", mappedSmiles: src?.mappedSmiles || "",
    };
    if (editOp) Object.assign(D, { lb: editOp.lb ?? D.existing.lb, ub: editOp.ub ?? D.existing.ub, gpr: editOp.gpr ?? D.existing.g ?? "", name: editOp.name ?? D.existing.n });
    if (D.existing && !editOp && !op) Object.assign(D, { name: D.existing.n, gpr: D.existing.g || "" });
    if (seedMet !== null) D.rows.push({ base: model.bases[model.mets[seedMet].b].id, comp: model.mets[seedMet].c, coef: -1 });
    if (copyOf !== null) D.name = D.name + " " + t("ed.copySuffix");
    const fixed = !!D.existing;
    $("rxnTitle").textContent = fixed ? t("ed.rxnEditTitle", { id: D.existing.id }) : index >= 0 ? t("ed.rxnEditAdded") : t("ed.rxnNewTitle");
    $("rxnHint").innerHTML = fixed ? t("ed.rxnEditHint") : t("ed.rxnHint");
    for (const id of ["rxId", "rxSub", "rxEc"]) $(id).disabled = fixed;
    $("rxEqBox").hidden = fixed; $("rxMapBox").hidden = fixed;
    $("rxEqFixed").hidden = !fixed;
    if (fixed) $("rxEqFixed").textContent = S.index.equation(modelLookups(model).rxn.get(D.existing.id));
    $("rxId").value = D.id; $("rxName").value = D.name; $("rxSub").value = D.subsystem;
    $("rxLb").value = D.lb; $("rxUb").value = D.ub; $("rxGpr").value = D.gpr; $("rxEc").value = D.ec; $("rxUnbal").checked = D.unbalancedOk;
    $("rxSmiles").value = D.mappedSmiles;
    const dl = $("subList"); dl.textContent = "";
    for (const s of model.subsystems) dl.appendChild(new Option(s));
    renderRows(); setMapMode(D.mapMode, false); validate();
    dlg.onclose = () => {
      if (dlg.returnValue !== "ok" || !D) return;
      save();
    };
    dlg.showModal();
  }

  function rxnToOp(j) {
    const r = S.model.rxns[j], am = S.atommaps[r.id];
    return { op: "addRxn", id: r.id, name: r.n, subsystem: S.model.subsystems[r.ss], mets: r.m.map((m, q) => [S.model.mets[m].id, r.c[q]]), lb: r.lb, ub: r.ub, gpr: r.g || "", ec: (r.ec || []).join(", "), atommap: am ? { k: am.k, s: am.s } : null };
  }

  /** Draft -> reaction metabolites; species that do not exist yet in that compartment are created. */
  function draftMets() {
    const L = modelLookups(S.model), add = [], mets = [];
    for (const row of D.rows) {
      const id = row.base + row.comp;
      if (!L.met.has(id) && !add.some((a) => a.base === row.base && a.comp === row.comp)) add.push({ op: "addMet", base: row.base, comp: row.comp });
      mets.push([id, row.coef]);
    }
    return { add, mets };
  }

  /** The draft as it would be after its new species are created (for validation and atom mapping). */
  function draftModel() {
    const { add, mets } = draftMets();
    if (!add.length) return { model: S.model, structures: S.structures, mets, add };
    const E = applyEdits({ model: S.base.model, structures: S.base.structures, atommaps: S.base.atommaps }, [...S.edits, ...add]);
    return { model: E.model, structures: E.structures, mets, add };
  }

  function readForm() {
    D.id = $("rxId").value.trim(); D.name = $("rxName").value; D.subsystem = $("rxSub").value;
    D.lb = $("rxLb").value === "" ? NaN : +$("rxLb").value; D.ub = $("rxUb").value === "" ? NaN : +$("rxUb").value;
    D.gpr = $("rxGpr").value; D.ec = $("rxEc").value; D.unbalancedOk = $("rxUnbal").checked; D.mappedSmiles = $("rxSmiles").value;
  }

  function renderRows() {
    const model = S.model;
    for (const [side, box] of [[-1, $("rxSubs")], [1, $("rxProds")]]) {
      box.textContent = "";
      D.rows.forEach((row) => {
        if (Math.sign(row.coef) !== side) return;
        const b = model.bases.find((x) => x.id === row.base);
        const div = document.createElement("div"); div.className = "eqrow";
        const c = document.createElement("input"); c.type = "number"; c.min = 0; c.step = "any"; c.value = Math.abs(row.coef); c.title = t("ed.coef");
        c.oninput = () => { row.coef = side * Math.abs(+c.value || 0); D.atommap = D.mapMode === "none" ? null : D.atommap && D.mapMode === "auto" ? null : D.atommap; validate(); };
        const nm = document.createElement("div"); nm.className = "name"; nm.textContent = b ? b.n : row.base; nm.title = (b?.f || "") + " · " + row.base;
        const comp = document.createElement("select"); comp.title = t("ed.compTitle");
        const present = new Set(model.mets.filter((m) => !m.removed && model.bases[m.b].id === row.base).map((m) => m.c));
        for (const [cid, cname] of Object.entries(model.compartments)) comp.add(new Option(`${cid} · ${cname}${present.has(cid) ? "" : " " + t("ed.compNew")}`, cid));
        comp.value = row.comp;
        comp.onchange = () => { row.comp = comp.value; resetAutoMap(); validate(); };
        const rm = document.createElement("button"); rm.type = "button"; rm.textContent = "✕"; rm.title = t("ed.rowRemove");
        rm.onclick = () => { D.rows = D.rows.filter((x) => x !== row); resetAutoMap(); renderRows(); validate(); };
        div.append(c, nm, comp, rm);
        box.appendChild(div);
      });
      if (!box.children.length) box.innerHTML = `<p class="hint">${t(side < 0 ? "ed.noSubs" : "ed.noProds")}</p>`;
    }
  }

  function addRow(baseIdx, side) {
    const model = S.model, b = model.bases[baseIdx];
    const comps = model.mets.filter((m) => !m.removed && m.b === baseIdx).map((m) => m.c);
    const usual = D.rows.length ? D.rows[0].comp : "c";
    const comp = comps.includes(usual) ? usual : comps.includes("c") ? "c" : comps[0] || usual;
    D.rows.push({ base: b.id, comp, coef: side });
    resetAutoMap(); renderRows(); validate();
  }

  const resetAutoMap = () => { if (D.mapMode === "auto") D.atommap = null; };

  function setMapMode(mode, revalidate = true) {
    D.mapMode = mode;
    document.querySelectorAll('#rxMapBox input[name="rxMap"]').forEach((x) => { x.checked = x.value === mode; });
    $("rxSmilesBox").hidden = mode !== "smiles";
    $("rxAutoBtn").hidden = mode !== "auto";
    if (mode === "none") D.atommap = null;
    if (revalidate) validate();
  }

  /** Participants of the draft with their structures, local index = position in the reaction. */
  function parts(dm) {
    return dm.mets.map(([id, c], loc) => {
      const L = modelLookups(dm.model), m = L.met.get(id);
      return { loc, side: Math.sign(c), coef: c, st: m === undefined ? null : dm.structures[dm.model.bases[dm.model.mets[m].b].id] || null, base: m === undefined ? null : dm.model.mets[m].b };
    });
  }

  /** Same compound on both sides (transport, carriers) -> identity; a published reaction with the same compounds -> its map. */
  function ruleMap(P) {
    const segs = [], usedS = new Set(), usedP = new Set();
    for (const s of P) {
      if (s.side >= 0) continue;
      const p = P.find((x) => x.side > 0 && x.base === s.base && !usedP.has(x.loc));
      if (p && s.st) { segs.push([s.loc, p.loc, -1]); usedS.add(s.loc); usedP.add(p.loc); }
    }
    if (segs.length && P.every((x) => usedS.has(x.loc) || usedP.has(x.loc) || !x.st)) return { k: "id", s: segs };
    // a published reaction made of the same compounds (in any compartment)
    const sig = (pairs) => pairs.map(([b, sd]) => b + (sd < 0 ? "-" : "+")).sort().join(" ");
    const want = sig(P.map((x) => [x.base, x.side])), wantRev = sig(P.map((x) => [x.base, -x.side]));
    const model = S.model;
    for (let j = 0; j < S.base.model.rxns.length; j++) {
      const r = model.rxns[j];
      if (r.removed || r.m.length !== P.length || !S.atommaps[r.id]) continue;
      const s = sig(r.m.map((m, q) => [model.mets[m].b, Math.sign(r.c[q])]));
      if (s !== want && s !== wantRev) continue;
      const flip = s !== want, loc = new Map(), taken = new Set();
      r.m.forEach((m, q) => {
        const sd = Math.sign(r.c[q]) * (flip ? -1 : 1);
        const p = P.find((x) => x.base === model.mets[m].b && x.side === sd && !taken.has(x.loc));
        if (p) { taken.add(p.loc); loc.set(q, p.loc); }
      });
      if (loc.size !== P.length) continue;
      const am = S.atommaps[r.id];
      const out = am.s.map((seg) => {
        const a = loc.get(seg[0]), b = loc.get(seg[1]);
        if (!flip) return seg.length > 3 ? [a, b, seg[2], seg[3]] : [a, b, seg[2]];
        const pairs = seg[2] === -1 ? -1 : seg[2].flatMap((_, k) => (k % 2 ? [] : [seg[2][k + 1], seg[2][k]]));
        return seg.length > 3 ? [b, a, pairs, seg[3]] : [b, a, pairs];
      });
      return { k: "inherit", from: r.id, s: out };
    }
    return segs.length ? { k: "id", s: segs, partial: true } : null;
  }

  async function autoMap() {
    readForm();
    const dm = draftModel(), P = parts(dm), status = $("rxMapStatus");
    if (P.length < 2) { status.textContent = t("ed.map.needBoth"); return; }
    let am = ruleMap(P);
    if (!am || am.partial) {
      if (P.filter((x) => x.st).length >= 2) {
        status.textContent = t("ed.map.loading");
        try { await loadRDKit(); } catch (err) { status.textContent = t("ed.map.noRdkit", { msg: err.message }); return; }
        status.textContent = t("ed.map.computing");
        await new Promise((r) => setTimeout(r, 20));
        const done = new Set((am?.s || []).flatMap((s) => [s[0], s[1]]));
        const rest = P.filter((x) => !done.has(x.loc));
        const segs = mcsMap(rest);
        am = { k: am ? "mcs" : "mcs", c: 0.3, s: [...(am?.s || []), ...segs] };
      } else am = am || null;
    }
    D.atommap = am;
    validate();
  }

  async function smilesMap() {
    readForm();
    const status = $("rxMapStatus");
    status.textContent = t("ed.map.loading");
    try { await loadRDKit(); } catch (err) { status.textContent = t("ed.map.noRdkit", { msg: err.message }); return; }
    const dm = draftModel(), P = parts(dm);
    try {
      const r = mapFromMappedSmiles(D.mappedSmiles, P);
      D.atommap = { k: "user", s: r.s };
      D.mapNotes = r.notes;
    } catch (err) {
      D.atommap = null;
      const [key, arg] = err.message.split(":");
      D.mapNotes = [{ key: key.startsWith("chem.") ? key : "chem.badSmiles", smi: arg || "" }];
    }
    validate();
  }

  function mapStatus(dm, P) {
    const am = D.atommap;
    if (D.mapMode === "none") return t("ed.map.none");
    if (!am) return D.mapMode === "smiles" ? t("ed.map.pasteHint") : t("ed.map.notYet");
    let tot = 0, got = 0;
    for (const p of P) {
      if (p.side <= 0 || !p.st) continue;
      const nC = p.st.e.filter((e) => e === "C").length, copies = Math.max(1, Math.round(Math.abs(p.coef)));
      tot += nC * copies;
      let n = 0;
      for (const s of am.s) {
        if (s[1] !== p.loc) continue;
        if (s[2] === -1) n += nC * (s[3] ?? Math.min(Math.abs(P[s[0]].coef), Math.abs(p.coef)));
        else for (let k = 1; k < s[2].length; k += 2) if (p.st.e[s[2][k]] === "C") n++;
      }
      got += Math.min(n, nC * copies);
    }
    const kind = { id: t("ed.map.k.id"), inherit: t("ed.map.k.inherit", { id: am.from || "" }), mcs: t("ed.map.k.mcs"), user: t("ed.map.k.user") }[am.k] || am.k;
    return t("ed.map.status", { kind, got, tot });
  }

  function validate() {
    if (!D) return;
    readForm();
    const save = $("rxSave");
    if (D.existing) {
      const iss = [];
      const fake = { ...D, id: D.existing.id, mets: D.existing.m.map((m, q) => [S.model.mets[m].id, D.existing.c[q]]) };
      for (const x of checkReaction(S.model, modelLookups(S.model), fake, { editing: true }).issues) if (/Bounds|lbAbove|boundsLarge|boundsZero|gpr\.|newGenes|noGpr/.test(x.key)) iss.push(x);
      $("rxIssues").innerHTML = issuesHtml(iss);
      save.disabled = hasErrors(iss);
      return;
    }
    const dm = draftModel(), P = parts(dm);
    const op = { ...D, mets: dm.mets, atommap: D.mapMode === "none" ? null : D.atommap };
    const L = modelLookups(dm.model);
    if (D.index >= 0 && S.edits[D.index]?.id) L.rxn.delete(S.edits[D.index].id); // its own id while editing it
    const res = checkReaction(dm.model, L, op, { structures: dm.structures });
    const iss = res.issues.filter((x) => !(D.mapMode === "none" && x.key === "chk.noAtomMap"));
    if (D.mapMode === "smiles" && D.mapNotes) for (const n of D.mapNotes) iss.push({ level: n.key.startsWith("chem.") ? "error" : "warn", key: n.key, args: { smi: n.smi || "", name: n.loc !== undefined && P[n.loc]?.base !== null ? dm.model.bases[P[n.loc].base].n : "" } });
    for (const a of dm.add) iss.push({ level: "info", key: "chk.willAddSpecies", args: { name: dm.model.bases[dm.model.bases.findIndex((b) => b.id === a.base)].n, c: a.comp } });
    $("rxUnbalWrap").hidden = !res.issues.some((x) => x.key === "chk.unbalanced");
    $("rxMapStatus").textContent = mapStatus(dm, P);
    $("rxIssues").innerHTML = issuesHtml(iss);
    save.disabled = hasErrors(iss);
  }

  function save() {
    readForm();
    if (D.existing) {
      const r = D.existing, op = { op: "editRxn", id: r.id };
      const base = S.base.model.rxns[modelLookups(S.base.model).rxn.get(r.id)] || r;
      if (D.lb !== base.lb || D.ub !== base.ub) { op.lb = D.lb; op.ub = D.ub; }
      if ((D.gpr || "").trim() !== (base.g || "")) op.gpr = D.gpr.trim();
      if (D.name.trim() && D.name.trim() !== base.n) op.name = D.name.trim();
      const others = S.edits.filter((x) => !(x.op === "editRxn" && x.id === r.id));
      app.setEdits(Object.keys(op).length > 2 ? [...others, op] : others);
      return;
    }
    const { add, mets } = draftMets();
    const op = { op: "addRxn", id: D.id, name: D.name.trim(), subsystem: D.subsystem.trim(), mets, lb: D.lb, ub: D.ub, gpr: D.gpr.trim(), ec: D.ec.trim() };
    if (D.unbalancedOk) op.unbalancedOk = true;
    if (D.mapMode !== "none" && D.atommap) op.atommap = { k: D.atommap.k, s: D.atommap.s, ...(D.atommap.c != null ? { c: D.atommap.c } : {}), ...(D.atommap.from ? { from: D.atommap.from } : {}) };
    if (D.mapMode === "smiles" && D.mappedSmiles) op.mappedSmiles = D.mappedSmiles.trim();
    const ops = S.edits.slice();
    if (D.index >= 0) ops.splice(D.index, 1, op); else ops.push(op);
    // new species go before the first reaction that needs them
    const at = D.index >= 0 ? D.index : ops.length - 1;
    ops.splice(at, 0, ...add);
    app.setEdits(ops, op.id);
  }

  // -------------------------------------------------------- metabolite dialog ----
  let M = null;

  function openMetDialog({ op = null, index = -1, base = null, onDone = null } = {}) {
    const dlg = $("metDialog"), model = S.model;
    M = { index, onDone, kind: op?.base || base !== null ? "comp" : "new", base: op?.base || (base !== null ? model.bases[base].id : null), comp: op?.comp || "c", name: op?.name || "", formula: op?.formula || "", charge: op?.charge ?? "", smiles: op?.smiles || "", structure: op?.structure || null, smilesFormula: null };
    const cs = $("mtComp"); cs.textContent = "";
    for (const [cid, cname] of Object.entries(model.compartments)) cs.add(new Option(`${cid} · ${cname}`, cid));
    cs.value = M.comp;
    $("mtName").value = M.name; $("mtFormula").value = M.formula; $("mtCharge").value = M.charge; $("mtSmiles").value = M.smiles;
    $("metTitle").textContent = index >= 0 ? t("ed.metEditTitle") : t("ed.metNewTitle");
    setKind(M.kind);
    if (M.structure) renderMolecule($("mtPreview"), M.structure, { height: 170 }); else $("mtPreview").innerHTML = `<p class="hint">${t("ed.noPreview")}</p>`;
    validateMet();
    dlg.onclose = () => { if (dlg.returnValue === "ok" && M) saveMet(); };
    dlg.showModal();
  }

  function setKind(kind) {
    M.kind = kind;
    document.querySelectorAll('#metDialog input[name="mtKind"]').forEach((x) => { x.checked = x.value === kind; });
    $("mtNewBox").hidden = kind !== "new"; $("mtCompBox").hidden = kind !== "comp";
    renderBaseChip();
    validateMet();
  }

  function renderBaseChip() {
    const b = M.base ? S.model.bases.find((x) => x.id === M.base) : null;
    $("mtBase").innerHTML = b ? `<b>${esc(b.n)}</b> <small>${esc(b.f || "")} · ${t("ed.inComps", { c: S.model.mets.filter((m) => !m.removed && m.b === S.model.bases.indexOf(b)).map((m) => m.c).join(", ") })}</small>` : `<span class="hint">${t("ed.pickBase")}</span>`;
  }

  async function readSmiles() {
    const s = $("mtSmiles").value.trim();
    M.smiles = s; M.structure = null; M.smilesFormula = null; M.smilesErr = null;
    if (!s) { $("mtPreview").innerHTML = `<p class="hint">${t("ed.noPreview")}</p>`; validateMet(); return; }
    $("mtPreview").innerHTML = `<p class="hint">${t(rdkitReady() ? "ed.map.computing" : "ed.map.loading")}</p>`;
    try { await loadRDKit(); } catch (err) { $("mtPreview").innerHTML = `<p class="hint">${esc(t("ed.map.noRdkit", { msg: err.message }))}</p>`; return; }
    try {
      const r = smilesToStructure(s);
      M.structure = r.st; M.smilesFormula = r.formula; M.smiles = r.smiles;
      if (!$("mtFormula").value.trim()) $("mtFormula").value = r.formula;
      if ($("mtCharge").value === "") $("mtCharge").value = r.charge;
      renderMolecule($("mtPreview"), r.st, { height: 170 });
      $("mtSmilesInfo").textContent = t("ed.smilesRead", { f: r.formula, q: r.charge, n: r.st.e.length, smi: r.smiles });
    } catch (err) {
      M.smilesErr = err.message;
      $("mtPreview").innerHTML = `<p class="hint err">${esc(t(err.message))}</p>`;
      $("mtSmilesInfo").textContent = "";
    }
    validateMet();
  }

  function metDraft() {
    if (M.kind === "comp") return { op: "addMet", base: M.base, comp: $("mtComp").value };
    const ch = $("mtCharge").value.trim();
    return { op: "addMet", comp: $("mtComp").value, name: $("mtName").value.trim(), formula: $("mtFormula").value.trim(), charge: ch === "" ? "" : +ch, smiles: $("mtSmiles").value.trim() ? M.smiles : "", structure: $("mtSmiles").value.trim() ? M.structure : null };
  }

  function validateMet() {
    if (!M) return;
    const d = metDraft();
    let iss;
    if (M.kind === "comp" && !M.base) iss = [{ level: "error", key: "chk.pickBase" }];
    else iss = checkMetabolite(S.model, modelLookups(S.model), { ...d, smilesFormula: M.smilesFormula });
    if (M.kind === "new" && $("mtSmiles").value.trim() && $("mtSmiles").value.trim() !== M.smiles && !M.structure) iss = [...iss.filter((x) => x.key !== "chk.smilesUnread"), { level: "error", key: "chk.smilesPending" }];
    if (M.smilesErr) iss.push({ level: "error", key: M.smilesErr });
    $("mtIssues").innerHTML = issuesHtml(iss);
    $("mtSave").disabled = hasErrors(iss);
    const ids = freeIds(S.model);
    $("mtId").textContent = M.kind === "comp" ? (M.base ? M.base + d.comp : "—") : (M.index >= 0 ? "" : ids.base + d.comp);
  }

  function saveMet() {
    const op = metDraft(), ops = S.edits.slice();
    if (M.index >= 0) ops.splice(M.index, 1, op); else ops.push(op);
    const done = M.onDone;
    app.setEdits(ops);
    if (done) done(op);
  }

  // ------------------------------------------------------------------- wiring ----
  function bind() {
    $("editBtn").onclick = () => { S.editMode = !S.editMode; $("editBtn").classList.toggle("on", S.editMode); render(); app.refreshDetails(); };
    $("addRxnBtn").onclick = () => openRxnDialog();
    $("addMetBtn").onclick = () => openMetDialog();
    $("discardEdits").onclick = () => { if (confirm(t("ed.confirmDiscard", { n: S.edits.length }))) app.setEdits([]); };
    attachSearch($("removeSearch"), $("removeResults"), () => S.search, (it) => {
      if (it.type === "rxn") removeRxn(it.ref);
      else if (it.type === "met") { const mets = S.index.metsOfBase[it.ref].filter((m) => !S.model.mets[m].removed); if (mets.length === 1) removeMet(mets[0]); else app.gotoMet(mets[0]); }
    }, { filter: (it) => it.type === "rxn" || it.type === "met", limit: 60 });
    // reaction dialog
    for (const [side, inp, res] of [[-1, "rxAddS", "rxAddSRes"], [1, "rxAddP", "rxAddPRes"]]) attachSearch($(inp), $(res), () => S.search, (it) => addRow(it.ref, side), { filter: (it) => it.type === "met", limit: 60 });
    for (const id of ["rxId", "rxName", "rxSub", "rxLb", "rxUb", "rxGpr", "rxEc", "rxUnbal"]) $(id).addEventListener("input", validate);
    $("rxIrrev").onclick = () => { $("rxLb").value = 0; $("rxUb").value = BOUND_MAX; validate(); };
    $("rxRev").onclick = () => { $("rxLb").value = -BOUND_MAX; $("rxUb").value = BOUND_MAX; validate(); };
    $("rxSwap").onclick = () => { readForm(); D.rows.forEach((r) => { r.coef = -r.coef; }); D.atommap = null; renderRows(); validate(); };
    document.querySelectorAll('#rxMapBox input[name="rxMap"]').forEach((x) => { x.onchange = () => setMapMode(x.value); });
    $("rxAutoBtn").onclick = autoMap;
    $("rxSmilesRead").onclick = smilesMap;
    $("rxNewMet").onclick = () => openMetDialog({ onDone: () => { if ($("rxnDialog").open) { renderRows(); validate(); } } });
    // metabolite dialog
    document.querySelectorAll('#metDialog input[name="mtKind"]').forEach((x) => { x.onchange = () => setKind(x.value); });
    attachSearch($("mtBaseSearch"), $("mtBaseRes"), () => S.search, (it) => { M.base = S.model.bases[it.ref].id; renderBaseChip(); validateMet(); }, { filter: (it) => it.type === "met", limit: 60 });
    for (const id of ["mtName", "mtFormula", "mtCharge", "mtComp"]) $(id).addEventListener("input", validateMet);
    $("mtSmiles").addEventListener("input", validateMet);
    $("mtSmilesRead").onclick = readSmiles;
  }

  return { render, bind, openRxnDialog, openMetDialog, removeRxn, removeMet };
}

export { fmtFlux };
