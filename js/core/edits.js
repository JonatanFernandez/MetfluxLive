// Model edits: an ordered list of operations applied on top of a published model (Human-GEM, Mouse-GEM).
//
// Indices of the published model never move: a removed reaction or metabolite stays in the arrays flagged
// `removed` (bounds 0, left out of maps, lists and search) and additions are appended. Results of the
// original and of an edited model can therefore be compared position by position, and the precomputed
// pathway layouts stay valid.
//
// Operations (all references are ids, so that an edit file works in any session):
//   { op: "addMet", id, comp, base?: existing base id | null, name, formula, charge, smiles?, structure? }
//   { op: "removeMet", id }
//   { op: "addRxn", id, name, subsystem, mets: [[metId, coef]], lb, ub, gpr, ec?, unbalancedOk?, atommap?: { k, s } }
//   { op: "removeRxn", id }
//   { op: "editRxn", id, lb?, ub?, gpr?, name? }
// Every operation is validated against the model as it stands when it is applied; an operation with errors
// is skipped (and reported), never half applied.

import { parseFormula } from "./chem.js";

export const EDIT_FORMAT = "metfluxlive-model-edits";
export const BOUND_MAX = 1000;
const ID_RX = /^[A-Za-z0-9_.\-]+$/;
const GENE_RX = /^[A-Za-z0-9_.\-:]+$/;

const issue = (level, key, args = {}) => ({ level, key, args });
export const hasErrors = (list) => list.some((x) => x.level === "error");

/** Syntax check of a GPR rule; returns null when valid, else a translation key. */
export function gprError(rule) {
  const s = String(rule || "").trim();
  if (!s) return null;
  const tok = s.match(/\(|\)|[^\s()]+/g) || [];
  let depth = 0, expectOperand = true;
  for (const w of tok) {
    const lw = w.toLowerCase();
    if (w === "(") { if (!expectOperand) return "gpr.missingOp"; depth++; continue; }
    if (w === ")") { if (expectOperand) return "gpr.empty"; if (--depth < 0) return "gpr.parens"; continue; }
    if (lw === "and" || lw === "or") { if (expectOperand) return "gpr.operator"; expectOperand = true; continue; }
    if (!expectOperand) return "gpr.missingOp";
    if (!GENE_RX.test(w)) return "gpr.badGene";
    expectOperand = false;
  }
  if (depth !== 0) return "gpr.parens";
  if (expectOperand) return "gpr.operator";
  return null;
}
const gprGenes = (rule) => (String(rule || "").match(/[^\s()]+/g) || []).filter((w) => !/^(and|or)$/i.test(w));

/** Can reaction j (with coefficient c for a metabolite) produce / consume that metabolite? */
const canMake = (r, c) => (c > 0 && r.ub > 0) || (c < 0 && r.lb < 0);
const canUse = (r, c) => (c < 0 && r.ub > 0) || (c > 0 && r.lb < 0);

/** Metabolites (indices) among `mets` that no reaction can produce, or none can consume. */
export function deadEnds(model, mets) {
  const make = new Map(), use = new Map(), count = new Map();
  const want = new Set(mets);
  model.rxns.forEach((r) => {
    if (r.removed) return;
    r.m.forEach((m, q) => {
      if (!want.has(m)) return;
      count.set(m, (count.get(m) || 0) + 1);
      if (canMake(r, r.c[q])) make.set(m, true);
      if (canUse(r, r.c[q])) use.set(m, true);
    });
  });
  const out = [];
  for (const m of want) {
    if (model.mets[m].removed) continue;
    if (!count.get(m)) out.push({ met: m, kind: "isolated" });
    else if (!make.get(m)) out.push({ met: m, kind: "notMade" });
    else if (!use.get(m)) out.push({ met: m, kind: "notUsed" });
  }
  return out;
}

/** Element and charge balance of a reaction draft; mets are indices. */
export function balance(model, mets, coefs) {
  const tot = {}, unknown = [];
  let charge = 0, chargeKnown = true;
  mets.forEach((m, q) => {
    const met = model.mets[m], f = parseFormula(model.bases[met.b].f);
    if (!f) { unknown.push(m); return; }
    for (const [el, n] of Object.entries(f)) tot[el] = (tot[el] || 0) + coefs[q] * n;
    if (typeof met.q === "number") charge += coefs[q] * met.q; else chargeKnown = false;
  });
  const off = Object.entries(tot).filter(([, n]) => Math.abs(n) > 1e-6).map(([el, n]) => [el, +n.toFixed(4)]);
  return { off, unknown, charge: chargeKnown && !unknown.length ? +charge.toFixed(4) : null };
}

function lookups(model) {
  const met = new Map(), rxn = new Map(), base = new Map();
  model.mets.forEach((m, i) => met.set(m.id, i));
  model.rxns.forEach((r, j) => rxn.set(r.id, j));
  model.bases.forEach((b, k) => base.set(b.id, k));
  return { met, rxn, base };
}

/** Validation of a new reaction (also used live by the editor dialog). */
export function checkReaction(model, L, d, { structures, editing } = {}) {
  const out = [];
  const id = String(d.id || "").trim();
  if (!id) out.push(issue("error", "chk.rxnNoId"));
  else if (!ID_RX.test(id)) out.push(issue("error", "chk.badId", { id }));
  else if (L.rxn.has(id) && !editing) out.push(issue("error", "chk.rxnDupId", { id }));
  if (!String(d.name || "").trim()) out.push(issue("warn", "chk.rxnNoName"));
  const mets = [], coefs = [], seen = new Set();
  for (const [mid, c] of d.mets || []) {
    const m = L.met.get(mid);
    if (m === undefined) { out.push(issue("error", "chk.metUnknown", { id: mid })); continue; }
    if (model.mets[m].removed) { out.push(issue("error", "chk.metRemoved", { id: mid })); continue; }
    if (!(Number.isFinite(+c) && +c !== 0)) { out.push(issue("error", "chk.badCoef", { id: mid })); continue; }
    if (seen.has(m)) { out.push(issue("error", "chk.metTwice", { id: mid })); continue; }
    seen.add(m); mets.push(m); coefs.push(+c);
  }
  if (!(d.mets || []).length) out.push(issue("error", "chk.rxnEmpty"));
  const lb = +d.lb, ub = +d.ub;
  if (!Number.isFinite(lb) || !Number.isFinite(ub)) out.push(issue("error", "chk.badBounds"));
  else {
    if (lb > ub) out.push(issue("error", "chk.lbAboveUb"));
    if (Math.max(Math.abs(lb), Math.abs(ub)) > BOUND_MAX) out.push(issue("warn", "chk.boundsLarge", { max: BOUND_MAX }));
    if (lb === 0 && ub === 0) out.push(issue("warn", "chk.boundsZero"));
  }
  const ge = gprError(d.gpr);
  if (ge) out.push(issue("error", ge));
  else if (!String(d.gpr || "").trim()) out.push(issue("info", "chk.noGpr"));
  else {
    const known = new Set(model.genes.flatMap((g) => [g[0], g[1]]));
    const fresh = gprGenes(d.gpr).filter((g) => !known.has(g));
    if (fresh.length) out.push(issue("info", "chk.newGenes", { genes: fresh.join(", ") }));
  }
  if (mets.length && mets.length === coefs.length) {
    const boundary = mets.length === 1;
    if (boundary) {
      const c = model.mets[mets[0]].c;
      out.push(issue(c === "e" ? "info" : "warn", c === "e" ? "chk.exchange" : "chk.sinkInside"));
    } else {
      if (!coefs.some((c) => c < 0) || !coefs.some((c) => c > 0)) out.push(issue("error", "chk.oneSided"));
      const bal = balance(model, mets, coefs);
      if (bal.unknown.length) out.push(issue("warn", "chk.noFormula", { mets: bal.unknown.map((m) => model.mets[m].id).join(", ") }));
      else {
        const heavy = bal.off.filter(([el]) => el !== "H");
        const hOff = bal.off.find(([el]) => el === "H");
        if (heavy.length) out.push(issue(d.unbalancedOk ? "warn" : "error", "chk.unbalanced", { els: heavy.map(([el, n]) => `${el} ${n > 0 ? "+" : ""}${n}`).join(", ") }));
        if (hOff) out.push(issue("warn", "chk.hUnbalanced", { n: (hOff[1] > 0 ? "+" : "") + hOff[1] }));
        if (bal.charge !== null && Math.abs(bal.charge) > 1e-6) out.push(issue("warn", "chk.chargeUnbalanced", { n: (bal.charge > 0 ? "+" : "") + bal.charge }));
      }
      const comps = new Set(mets.map((m) => model.mets[m].c));
      if (comps.size > 2) out.push(issue("warn", "chk.manyComps", { n: comps.size }));
      // the same reaction already in the model
      const sig = (ms, cs) => ms.map((m, q) => m + ":" + (+cs[q]).toPrecision(6)).sort().join(" ");
      const me = sig(mets, coefs), meRev = sig(mets, coefs.map((c) => -c));
      const dup = model.rxns.find((r) => !r.removed && r.id !== id && r.m.length === mets.length && (sig(r.m, r.c) === me || sig(r.m, r.c) === meRev));
      if (dup) out.push(issue("warn", "chk.duplicate", { id: dup.id }));
      // atom map
      if (structures) {
        const withSt = mets.filter((m) => structures[model.bases[model.mets[m].b].id]);
        if (!d.atommap?.s?.length) {
          if (withSt.length >= 2) out.push(issue("warn", "chk.noAtomMap"));
        } else {
          const bad = checkAtomMap(model, structures, mets, coefs, d.atommap);
          out.push(...bad);
        }
        const noSt = mets.filter((m) => !structures[model.bases[model.mets[m].b].id] && carbonsOf(model, m) > 0);
        if (noSt.length) out.push(issue("info", "chk.noStructure", { mets: noSt.map((m) => model.bases[model.mets[m].b].n).join(", ") }));
      }
    }
  }
  return { issues: out, mets, coefs };
}

const carbonsOf = (model, m) => parseFormula(model.bases[model.mets[m].b].f)?.C || 0;

/** Atom map sanity: indices in range, element preserved, no atom used twice, product carbons covered. */
export function checkAtomMap(model, structures, mets, coefs, am) {
  const out = [], st = mets.map((m) => structures[model.bases[model.mets[m].b].id] || null);
  const usedS = new Map(), usedP = new Map();
  let wrongEl = 0, range = 0, dirBad = 0;
  for (const seg of am.s) {
    const [sl, pl, pairs] = seg;
    if (!(sl >= 0 && sl < mets.length && pl >= 0 && pl < mets.length)) { range++; continue; }
    if (!(coefs[sl] < 0 && coefs[pl] > 0)) { dirBad++; continue; }
    if (pairs === -1) continue;
    const a = st[sl], b = st[pl];
    if (!a || !b) { range++; continue; }
    for (let k = 0; k < pairs.length; k += 2) {
      const x = pairs[k], y = pairs[k + 1];
      if (x >= a.e.length || y >= b.e.length) { range++; continue; }
      if (a.e[x] !== b.e[y]) wrongEl++;
      const ks = sl + ":" + x, kp = pl + ":" + y;
      usedS.set(ks, (usedS.get(ks) || 0) + 1); usedP.set(kp, (usedP.get(kp) || 0) + 1);
    }
  }
  if (range) out.push(issue("error", "chk.mapRange", { n: range }));
  if (dirBad) out.push(issue("error", "chk.mapDirection", { n: dirBad }));
  if (wrongEl) out.push(issue("error", "chk.mapElement", { n: wrongEl }));
  const over = [...usedP].filter(([k, n]) => n > Math.abs(coefs[+k.split(":")[0]]) + 1e-9).length;
  if (over) out.push(issue("error", "chk.mapTwice", { n: over }));
  // product carbons without a source atom (every stoichiometric copy counts)
  let missing = 0, total = 0;
  mets.forEach((m, q) => {
    if (!(coefs[q] > 0) || !st[q]) return;
    const copies = Math.max(1, Math.round(coefs[q])), whole = am.s.filter((s) => s[1] === q && s[2] === -1).reduce((n, s) => n + (s[3] ?? Math.min(Math.abs(coefs[s[0]]), coefs[q])), 0);
    st[q].e.forEach((el, a) => { if (el !== "C") return; total += copies; missing += Math.max(0, copies - whole - (usedP.get(q + ":" + a) || 0)); });
  });
  if (missing) out.push(issue("warn", "chk.mapPartial", { n: missing, total }));
  return out;
}

/** Validation of a new metabolite. */
export function checkMetabolite(model, L, d) {
  const out = [];
  if (!model.compartments[d.comp]) out.push(issue("error", "chk.badComp"));
  if (d.base) {
    const b = L.base.get(d.base);
    if (b === undefined) out.push(issue("error", "chk.baseUnknown", { id: d.base }));
    else if (L.met.has(d.base + d.comp)) out.push(issue("error", "chk.metExists", { id: d.base + d.comp }));
    return out;
  }
  if (!String(d.name || "").trim()) out.push(issue("error", "chk.metNoName"));
  else if (model.bases.some((b) => b.n.toLowerCase() === String(d.name).trim().toLowerCase())) out.push(issue("warn", "chk.nameTaken", { name: d.name }));
  if (!d.formula) out.push(issue("warn", "chk.metNoFormula"));
  else if (!parseFormula(d.formula)) out.push(issue("error", "chk.badFormula"));
  if (d.charge !== undefined && d.charge !== null && d.charge !== "" && !Number.isInteger(+d.charge)) out.push(issue("error", "chk.badCharge"));
  if (d.smiles && !d.structure) out.push(issue("error", "chk.smilesUnread"));
  if (!d.smiles) out.push(issue("info", "chk.noSmiles"));
  if (d.structure && d.formula && d.smilesFormula) {
    const a = parseFormula(d.formula), b = parseFormula(d.smilesFormula);
    if (a && b) {
      const heavy = (f) => Object.entries(f).filter(([el]) => el !== "H").map(([el, n]) => el + n).sort().join("");
      if (heavy(a) !== heavy(b)) out.push(issue("error", "chk.smilesFormula", { f: d.smilesFormula }));
      else if ((a.H || 0) !== (b.H || 0)) out.push(issue("info", "chk.smilesProton", { f: d.smilesFormula }));
    }
  }
  return out;
}

/**
 * Apply an edit list. @param base { model, structures, atommaps } of the published model.
 * @returns { model, structures, atommaps, results: [{ ok, issues }], touched: Set of met indices }
 */
export function applyEdits(base, ops) {
  const m0 = base.model;
  const model = {
    ...m0, mets: m0.mets.slice(), rxns: m0.rxns.slice(), bases: m0.bases.slice(), subsystems: m0.subsystems.slice(),
    genes: m0.genes.slice(), edits: ops.length, baseCounts: m0.baseCounts || { mets: m0.mets.length, rxns: m0.rxns.length, bases: m0.bases.length, subsystems: m0.subsystems.length },
  };
  const structures = { ...base.structures }, atommaps = { ...base.atommaps };
  const L = lookups(model);
  const results = [], touched = new Set();
  const knownGenes = new Set(model.genes.flatMap((g) => [g[0], g[1]]));
  const addGenes = (rule) => { for (const g of gprGenes(rule)) if (!knownGenes.has(g)) { knownGenes.add(g); model.genes.push([g, g, ""]); } };
  for (const op of ops) {
    let iss = [];
    if (op.op === "addMet") {
      iss = checkMetabolite(model, L, op);
      if (!hasErrors(iss)) {
        let b = op.base ? L.base.get(op.base) : undefined;
        if (b === undefined) {
          const bid = op.id ? String(op.id).replace(new RegExp(op.comp + "$"), "") : newBaseId(L);
          b = model.bases.length;
          model.bases.push({ id: bid, n: String(op.name).trim(), f: op.formula || "", user: true, ...(op.structure ? { s: 1 } : {}) });
          L.base.set(bid, b);
          if (op.structure) structures[bid] = op.structure;
        }
        const id = model.bases[b].id + op.comp;
        const q = op.charge === "" || op.charge === null || op.charge === undefined ? undefined : +op.charge;
        L.met.set(id, model.mets.length);
        touched.add(model.mets.length);
        model.mets.push({ id, b, c: op.comp, ...(q !== undefined ? { q } : {}), user: true });
      }
    } else if (op.op === "removeMet") {
      const m = L.met.get(op.id);
      if (m === undefined) iss.push(issue("error", "chk.metUnknown", { id: op.id }));
      else if (model.mets[m].removed) iss.push(issue("warn", "chk.alreadyRemoved", { id: op.id }));
      else {
        const users = model.rxns.filter((r) => !r.removed && r.m.includes(m));
        if (users.length) iss.push(issue("error", "chk.metInUse", { id: op.id, n: users.length, list: users.slice(0, 5).map((r) => r.id).join(", ") }));
        else model.mets[m] = { ...model.mets[m], removed: true };
      }
    } else if (op.op === "addRxn") {
      const chk = checkReaction(model, L, op, { structures });
      iss = chk.issues;
      if (!hasErrors(iss)) {
        let ss = model.subsystems.indexOf(String(op.subsystem || "").trim());
        if (ss < 0) { ss = model.subsystems.length; model.subsystems.push(String(op.subsystem || "").trim() || "User reactions"); }
        const r = { id: op.id.trim(), n: String(op.name || "").trim() || op.id.trim(), m: chk.mets, c: chk.coefs, lb: +op.lb, ub: +op.ub, ss, user: true };
        if (String(op.gpr || "").trim()) { r.g = String(op.gpr).trim(); addGenes(r.g); }
        if (op.ec) r.ec = String(op.ec).split(/[,;\s]+/).filter(Boolean);
        L.rxn.set(r.id, model.rxns.length);
        model.rxns.push(r);
        if (op.atommap?.s?.length) atommaps[r.id] = { k: op.atommap.k || "user", s: op.atommap.s, ...(op.atommap.c != null ? { c: op.atommap.c } : {}) };
        else delete atommaps[r.id];
        for (const m of chk.mets) touched.add(m);
      }
    } else if (op.op === "removeRxn") {
      const j = L.rxn.get(op.id);
      if (j === undefined) iss.push(issue("error", "chk.rxnUnknown", { id: op.id }));
      else if (model.rxns[j].removed) iss.push(issue("warn", "chk.alreadyRemoved", { id: op.id }));
      else if (model.rxns[j].obj) iss.push(issue("error", "chk.removeObjective"));
      else {
        model.rxns[j] = { ...model.rxns[j], removed: true, lb: 0, ub: 0 };
        for (const m of model.rxns[j].m) touched.add(m);
      }
    } else if (op.op === "editRxn") {
      const j = L.rxn.get(op.id);
      if (j === undefined) iss.push(issue("error", "chk.rxnUnknown", { id: op.id }));
      else if (model.rxns[j].removed) iss.push(issue("error", "chk.rxnRemoved", { id: op.id }));
      else {
        const r = { ...model.rxns[j] };
        if (op.lb !== undefined) r.lb = +op.lb;
        if (op.ub !== undefined) r.ub = +op.ub;
        if (!Number.isFinite(r.lb) || !Number.isFinite(r.ub)) iss.push(issue("error", "chk.badBounds"));
        else if (r.lb > r.ub) iss.push(issue("error", "chk.lbAboveUb"));
        if (op.gpr !== undefined) { const ge = gprError(op.gpr); if (ge) iss.push(issue("error", ge)); else r.g = String(op.gpr).trim(); }
        if (op.name !== undefined && String(op.name).trim()) r.n = String(op.name).trim();
        if (!hasErrors(iss)) {
          if (!r.g) delete r.g; else addGenes(r.g);
          r.edited = true;
          model.rxns[j] = r;
          for (const m of r.m) touched.add(m);
        }
      }
    } else iss.push(issue("error", "chk.unknownOp", { op: op.op }));
    results.push({ ok: !hasErrors(iss), issues: iss });
  }
  return { model, structures, atommaps, results, touched };
}

function newBaseId(L) {
  for (let k = 1; ; k++) { const id = "USR" + String(k).padStart(4, "0"); if (!L.base.has(id)) return id; }
}

/** Next free ids for the editor's defaults. */
export function freeIds(model) {
  const L = lookups(model);
  let r = 1;
  while (L.rxn.has("USR_R" + String(r).padStart(3, "0"))) r++;
  return { rxn: "USR_R" + String(r).padStart(3, "0"), base: newBaseId(L) };
}

export const modelLookups = lookups;

/** Problems of the edited model as a whole: dead ends and isolated metabolites created by the edits. */
export function modelIssues(edited) {
  const { model, touched } = edited, out = [];
  for (const d of deadEnds(model, touched)) {
    const met = model.mets[d.met];
    out.push(issue(d.kind === "isolated" ? "warn" : "warn", "chk.dead." + d.kind, { id: met.id, name: model.bases[met.b].n }));
  }
  const blocked = [];
  const dead = new Set(deadEnds(model, touched).map((d) => d.met));
  model.rxns.forEach((r) => { if (!r.removed && r.user && r.m.some((m) => dead.has(m))) blocked.push(r.id); });
  if (blocked.length) out.push(issue("warn", "chk.blocked", { list: blocked.join(", ") }));
  return out;
}

// ------------------------------------------------------------------------- layout ----
/**
 * Pathway maps for an edited model: removed reactions leave the maps, added reactions are placed next to
 * the metabolites they share with the map (new metabolites around them), new pathways get a ring layout.
 */
export function editedLayout(layout, model) {
  if (!model.edits) return layout;
  const subs = { ...layout.subs };
  const addTo = new Map();
  model.rxns.forEach((r, j) => { if (r.user && !r.removed) { if (!addTo.has(r.ss)) addTo.set(r.ss, []); addTo.get(r.ss).push(j); } });
  for (const [ss, L0] of Object.entries(layout.subs)) {
    if (!L0.r.some((j) => model.rxns[j].removed) && !addTo.has(+ss)) continue;
    subs[ss] = filterLayout(L0, model);
  }
  for (const [ss, list] of addTo) subs[ss] = placeReactions(subs[ss] || { m: [], mx: [], my: [], r: [], rx: [], ry: [] }, model, list);
  const global = { ...layout.global, nodes: layout.global.nodes.slice() };
  const has = new Set(global.nodes.map((n) => n.ss));
  let x1 = -Infinity, y0 = Infinity;
  for (const n of global.nodes) { x1 = Math.max(x1, n.x + n.r); y0 = Math.min(y0, n.y - n.r); }
  let k = 0;
  for (const ss of addTo.keys()) if (!has.has(ss)) global.nodes.push({ ss, x: x1 + 2, y: y0 + 2.5 * k++, n: addTo.get(ss).length, r: 0.7 });
  return { ...layout, subs, global };
}

function filterLayout(L0, model) {
  const L = { m: [], mx: [], my: [], r: [], rx: [], ry: [] };
  L0.r.forEach((j, k) => { if (!model.rxns[j].removed) { L.r.push(j); L.rx.push(L0.rx[k]); L.ry.push(L0.ry[k]); } });
  const live = new Set(L.r.flatMap((j) => model.rxns[j].m));
  L0.m.forEach((m, k) => { if (!model.mets[m].removed && live.has(m)) { L.m.push(m); L.mx.push(L0.mx[k]); L.my.push(L0.my[k]); } });
  return L;
}

function placeReactions(L0, model, list) {
  const L = { m: L0.m.slice(), mx: L0.mx.slice(), my: L0.my.slice(), r: L0.r.slice(), rx: L0.rx.slice(), ry: L0.ry.slice() };
  const pos = new Map(L.m.map((m, k) => [m, [L.mx[k], L.my[k]]]));
  let x1 = 0, y0 = 0, y1 = 0;
  if (L.m.length) { x1 = Math.max(...L.mx); y0 = Math.min(...L.my); y1 = Math.max(...L.my); }
  let free = 0;
  for (const j of list) {
    if (L.r.includes(j)) continue;
    const r = model.rxns[j], known = r.m.filter((m) => pos.has(m));
    let cx, cy;
    if (known.length) {
      cx = known.reduce((s, m) => s + pos.get(m)[0], 0) / known.length + 0.8;
      cy = known.reduce((s, m) => s + pos.get(m)[1], 0) / known.length + 0.6;
    } else { cx = x1 + 3; cy = y0 + 3 * free++; }
    // nudge away from reactions already there
    for (let tries = 0; tries < 12 && L.r.some((_, k) => Math.hypot(L.rx[k] - cx, L.ry[k] - cy) < 0.7); tries++) cy += 0.8;
    L.r.push(j); L.rx.push(+cx.toFixed(2)); L.ry.push(+cy.toFixed(2));
    const fresh = r.m.filter((m) => !pos.has(m));
    fresh.forEach((m, i) => {
      const a = (2 * Math.PI * i) / Math.max(1, fresh.length) + 0.4, x = cx + 1.6 * Math.cos(a), y = cy + 1.6 * Math.sin(a);
      pos.set(m, [x, y]); L.m.push(m); L.mx.push(+x.toFixed(2)); L.my.push(+y.toFixed(2));
    });
  }
  void y1;
  return L;
}

/** Edit list -> file contents. */
export function editsFile(model, ops) {
  const meta = model.meta || {};
  return { format: EDIT_FORMAT, version: 1, model: { id: meta.id, version: meta.version, slug: meta.slug }, created: new Date().toISOString(), operations: ops };
}

/** File contents -> edit list (throws a translation key on bad input). */
export function readEditsFile(obj) {
  const o = obj && obj.format === EDIT_FORMAT ? obj : obj?.model_edits?.format === EDIT_FORMAT ? obj.model_edits : null;
  if (!o || !Array.isArray(o.operations)) throw new Error("imp.notEdits");
  return { model: o.model || {}, ops: o.operations.filter((x) => x && typeof x.op === "string") };
}
