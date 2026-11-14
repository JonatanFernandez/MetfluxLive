// Chemistry for the model editor: SMILES -> structure, atom maps of new reactions.
// Uses RDKit MinimalLib (WebAssembly, vendor/rdkit), loaded on demand. Structures use the same format as
// data/<slug>/structures.json, written by tools/build_model.py:
//   { e: element per heavy atom, h: H count, q?: formal charge, x, y: 2D depiction, b: [a, b, order, wedge]*, sym?: orbits }
// with atoms in canonical-SMILES order.

let R = null, loading = null;

/** For Node tests: hand over an initialised RDKit module. */
export function setRDKit(rdkit) { R = rdkit; }
export const rdkitReady = () => !!R;

export function loadRDKit() {
  if (R) return Promise.resolve(R);
  if (loading) return loading;
  loading = new Promise((resolve, reject) => {
    const base = new URL("../../vendor/rdkit/", import.meta.url).href;
    const go = () => window.initRDKitModule({ locateFile: (f) => base + f }).then((r) => { R = r; resolve(r); }, reject);
    if (window.initRDKitModule) { go(); return; }
    const s = document.createElement("script");
    s.src = base + "RDKit_minimal.js";
    s.onload = go;
    s.onerror = () => { loading = null; reject(new Error("RDKit could not be loaded")); };
    document.head.appendChild(s);
  });
  return loading;
}

const SYMBOLS = ["*", "H", "He", "Li", "Be", "B", "C", "N", "O", "F", "Ne", "Na", "Mg", "Al", "Si", "P", "S", "Cl", "Ar", "K", "Ca",
  "Sc", "Ti", "V", "Cr", "Mn", "Fe", "Co", "Ni", "Cu", "Zn", "Ga", "Ge", "As", "Se", "Br", "Kr", "Rb", "Sr", "Y", "Zr", "Nb", "Mo",
  "Tc", "Ru", "Rh", "Pd", "Ag", "Cd", "In", "Sn", "Sb", "Te", "I", "Xe"];

/** Element counts of a formula ("C6H12O6", "C3H5O3R"); null when it cannot be read. */
export function parseFormula(f) {
  if (!f || typeof f !== "string") return null;
  const s = f.replace(/\s+/g, "");
  if (!/^([A-Z][a-z]?\d*)+$/.test(s)) return null;
  const out = {};
  for (const [, el, n] of s.matchAll(/([A-Z][a-z]?)(\d*)/g)) out[el] = (out[el] || 0) + (n ? parseInt(n, 10) : 1);
  return out;
}

/** Hill order: C, H, then alphabetical. */
export function formatFormula(counts) {
  const keys = Object.keys(counts).filter((k) => counts[k] > 0);
  const order = keys.includes("C") ? ["C", "H", ...keys.filter((k) => k !== "C" && k !== "H").sort()] : keys.sort();
  return order.filter((k) => counts[k] > 0).map((k) => k + (counts[k] === 1 ? "" : counts[k])).join("");
}

const jsonAtoms = (mol) => {
  const j = JSON.parse(mol.get_json()).molecules[0];
  const atoms = j.atoms.map((a) => ({ z: a.z ?? 6, h: a.impHs ?? 0, q: a.chg ?? 0 }));
  const bonds = (j.bonds || []).map((b) => ({ a: b.atoms[0], b: b.atoms[1], o: b.bo ?? 1, stereo: b.stereo }));
  return { atoms, bonds };
};

/** Coordinates and atom-map numbers of a V2000 molblock, in atom order. */
function molblockAtoms(mb) {
  const lines = mb.split("\n"), n = parseInt(lines[3].slice(0, 3), 10), out = [];
  for (let i = 0; i < n; i++) {
    const L = lines[4 + i];
    out.push({ x: parseFloat(L.slice(0, 10)), y: parseFloat(L.slice(10, 20)), map: parseInt(L.slice(60, 63), 10) || 0 });
  }
  return out;
}

/**
 * Groups of atoms interchangeable by a proper (rotational) symmetry — port of proper_orbits() in
 * tools/build_model.py: mirror-only symmetries (the prochiral arms of citrate) are not scrambled.
 */
function properOrbits(mol, atoms, bonds) {
  const n = atoms.length;
  if (n > 120) return [];
  let matches;
  try { matches = JSON.parse(mol.get_substruct_matches(mol, JSON.stringify({ uniquify: false, useChirality: true, maxMatches: 2000 }))); } catch { return []; }
  if (!Array.isArray(matches) || matches.length <= 1 || matches.length >= 2000) return [];
  const nbr = atoms.map(() => []), bondOrders = atoms.map(() => []);
  for (const b of bonds) { nbr[b.a].push(b.b); nbr[b.b].push(b.a); bondOrders[b.a].push(b.o); bondOrders[b.b].push(b.o); }
  const parent = Array.from({ length: n }, (_, i) => i);
  const find = (a) => { while (parent[a] !== a) { parent[a] = parent[parent[a]]; a = parent[a]; } return a; };
  for (const m of matches) {
    const sig = m.atoms;
    if (sig.every((x, i) => x === i)) continue;
    let proper = true;
    for (let a = 0; a < n && proper; a++) {
      if (sig[a] !== a) continue;
      const nh = atoms[a].h, ns = nbr[a];
      if (ns.length + nh !== 4 || nh >= 2 || bondOrders[a].some((o) => o !== 1)) continue;
      const seen = new Set();
      let transpositions = 0;
      for (const x of ns) {
        if (seen.has(x)) continue;
        let len = 0, y = x;
        while (!seen.has(y)) { seen.add(y); y = sig[y]; len++; }
        transpositions += len - 1;
      }
      if (transpositions % 2 === 1) proper = false;
    }
    if (!proper) continue;
    for (let i = 0; i < n; i++) { const a = find(i), b = find(sig[i]); if (a !== b) parent[a] = b; }
  }
  const groups = new Map();
  for (let i = 0; i < n; i++) { const r = find(i); if (!groups.has(r)) groups.set(r, []); groups.get(r).push(i); }
  return [...groups.values()].filter((g) => g.length > 1);
}

/**
 * Read a SMILES. Returns { smiles (canonical), st (structure), formula, charge } or throws an Error whose
 * message is a translation key ("chem.badSmiles", "chem.empty", "chem.multi").
 */
export function smilesToStructure(smiles) {
  if (!R) throw new Error("chem.noRdkit");
  const s = String(smiles || "").trim();
  if (!s) throw new Error("chem.empty");
  if (s.includes(">")) throw new Error("chem.isReaction");
  const m0 = R.get_mol(s);
  if (!m0 || !m0.is_valid()) { m0?.delete(); throw new Error("chem.badSmiles"); }
  const canon = m0.get_smiles();
  m0.delete();
  if (canon.includes(".")) throw new Error("chem.multi");
  const mol = R.get_mol(canon); // atom order = canonical SMILES order, as in build_model.py
  try {
    const { atoms, bonds } = jsonAtoms(mol);
    if (!atoms.length) throw new Error("chem.empty");
    const sym = properOrbits(mol, atoms, bonds);
    mol.set_new_coords(true);
    const pos = molblockAtoms(mol.get_molblock());
    const counts = {};
    let charge = 0;
    for (const a of atoms) {
      const el = SYMBOLS[a.z] || "X";
      if (el !== "*") counts[el] = (counts[el] || 0) + 1;
      if (a.h) counts.H = (counts.H || 0) + a.h;
      charge += a.q;
    }
    const st = {
      e: atoms.map((a) => (a.z === 0 ? "R" : SYMBOLS[a.z] || "X")), h: atoms.map((a) => a.h),
      x: pos.map((p) => +p.x.toFixed(2)), y: pos.map((p) => +(-p.y).toFixed(2)),
      b: bonds.flatMap((b) => [b.a, b.b, b.o === 2 || b.o === 3 ? b.o : 1, 0]),
    };
    if (atoms.some((a) => a.q)) st.q = atoms.map((a) => a.q);
    if (sym.length) st.sym = sym;
    if (!counts.R && atoms.some((a) => a.z === 0)) counts.R = atoms.filter((a) => a.z === 0).length;
    return { smiles: canon, st, formula: formatFormula(counts), charge };
  } finally { mol.delete(); }
}

/** Structure dict -> V2000 molblock (kekulé bonds, charges), for RDKit. */
export function structureToMolblock(st, keep = null) {
  const idx = keep || st.e.map((_, i) => i), at = new Map(idx.map((a, k) => [a, k]));
  const bonds = [];
  for (let k = 0; k < st.b.length; k += 4) if (at.has(st.b[k]) && at.has(st.b[k + 1])) bonds.push([at.get(st.b[k]) + 1, at.get(st.b[k + 1]) + 1, st.b[k + 2]]);
  const f = (x, w, d) => x.toFixed(d).padStart(w);
  const L = ["", "  MetfluxLive", "", `${String(idx.length).padStart(3)}${String(bonds.length).padStart(3)}  0  0  0  0  0  0  0  0999 V2000`];
  for (const a of idx) {
    const el = st.e[a] === "R" ? "*" : st.e[a];
    L.push(`${f(st.x[a], 10, 4)}${f(-st.y[a], 10, 4)}${f(0, 10, 4)} ${el.padEnd(3)} 0  0  0  0  0  0  0  0  0  0  0  0`);
  }
  for (const [a, b, o] of bonds) L.push(`${String(a).padStart(3)}${String(b).padStart(3)}${String(o).padStart(3)}  0`);
  const chg = idx.map((a, k) => [k + 1, st.q ? st.q[a] : 0]).filter((x) => x[1]);
  for (let i = 0; i < chg.length; i += 8) {
    const part = chg.slice(i, i + 8);
    L.push(`M  CHG${String(part.length).padStart(3)}${part.map(([a, q]) => `${String(a).padStart(4)}${String(q).padStart(4)}`).join("")}`);
  }
  L.push("M  END");
  return L.join("\n");
}

// ------------------------------------------------------------------ graph matching ----
const graphOf = (e, bondsFlat, step = 4) => {
  const adj = e.map(() => []);
  for (let k = 0; k < bondsFlat.length; k += step) { adj[bondsFlat[k]].push(bondsFlat[k + 1]); adj[bondsFlat[k + 1]].push(bondsFlat[k]); }
  return { el: e, adj };
};

/**
 * Atom correspondence between two molecular graphs (heavy atoms, elements and connectivity only, so that
 * protonation state, charges and bond orders may differ). Returns map A -> B, or null.
 */
export function isoMatch(A, B, limit = 400000) {
  const n = A.el.length;
  if (n !== B.el.length) return null;
  const key = (G, i) => G.el[i] + G.adj[i].length;
  const countKeys = (G) => { const c = new Map(); G.el.forEach((_, i) => c.set(key(G, i), (c.get(key(G, i)) || 0) + 1)); return c; };
  const ca = countKeys(A), cb = countKeys(B);
  for (const [k, v] of ca) if (cb.get(k) !== v) return null;
  // visiting order: BFS from the rarest atom, so that every atom after the first has a mapped neighbour
  const order = [], seen = new Uint8Array(n);
  while (order.length < n) {
    let start = -1;
    for (let i = 0; i < n; i++) if (!seen[i] && (start < 0 || ca.get(key(A, i)) < ca.get(key(A, start)))) start = i;
    const q = [start]; seen[start] = 1;
    while (q.length) { const x = q.shift(); order.push(x); for (const y of A.adj[x]) if (!seen[y]) { seen[y] = 1; q.push(y); } }
  }
  const map = new Int32Array(n).fill(-1), used = new Uint8Array(n);
  let steps = 0;
  const ok = (a, b) => {
    if (key(A, a) !== key(B, b)) return false;
    for (const y of A.adj[a]) if (map[y] >= 0 && !B.adj[b].includes(map[y])) return false;
    return true;
  };
  const go = (k) => {
    if (k === n) return true;
    if (++steps > limit) return false;
    const a = order[k];
    const mappedNbr = A.adj[a].find((y) => map[y] >= 0);
    const cands = mappedNbr !== undefined ? B.adj[map[mappedNbr]] : B.el.map((_, i) => i);
    for (const b of cands) {
      if (used[b] || !ok(a, b)) continue;
      map[a] = b; used[b] = 1;
      if (go(k + 1)) return true;
      map[a] = -1; used[b] = 0;
    }
    return false;
  };
  return go(0) ? Array.from(map) : null;
}

/** Heavy-atom graph of a structure. */
export const structGraph = (st) => graphOf(st.e.map((x) => (x === "R" ? "*" : x)), st.b);

/**
 * Atom map of a reaction from an atom-mapped reaction SMILES ("[CH3:1][C:2]...>>...", e.g. from RXNMapper).
 * @param parts reaction participants [{ loc, st, side: -1 substrate | 1 product, coef }]
 * @returns { s: segments [sl, pl, pairs], notes: [{ key, ... }] }
 */
export function mapFromMappedSmiles(rxnSmiles, parts) {
  if (!R) throw new Error("chem.noRdkit");
  const sides = String(rxnSmiles || "").trim().split(">");
  if (sides.length !== 3) throw new Error("chem.notReaction");
  const comps = (txt, side) => txt.split(".").filter(Boolean).map((smi) => {
    const mol = R.get_mol(smi);
    if (!mol || !mol.is_valid()) { mol?.delete(); throw new Error("chem.badComponent:" + smi); }
    try {
      const { atoms, bonds } = jsonAtoms(mol), pos = molblockAtoms(mol.get_molblock());
      const heavy = atoms.map((a, i) => (a.z !== 1 ? i : -1)).filter((i) => i >= 0), at = new Map(heavy.map((a, k) => [a, k]));
      const flat = [];
      for (const b of bonds) if (at.has(b.a) && at.has(b.b)) flat.push(at.get(b.a), at.get(b.b));
      return { smi, side, g: graphOf(heavy.map((i) => SYMBOLS[atoms[i].z] || "X"), flat, 2), maps: heavy.map((i) => pos[i].map) };
    } finally { mol.delete(); }
  });
  const list = [...comps(sides[0], -1), ...comps(sides[2], 1)].filter((c) => c.g.el.length); // [H+] has no heavy atom
  const notes = [];
  // assign every component to a participant of the same side with the same skeleton (stoichiometric copies allowed)
  const left = new Map(parts.map((p) => [p.loc, Math.round(Math.abs(p.coef)) || 1]));
  const assigned = [];
  for (const c of list) {
    let hit = null;
    for (const p of parts) {
      if (p.side !== c.side || !p.st || !(left.get(p.loc) > 0)) continue;
      const m = isoMatch(c.g, structGraph(p.st));
      if (m) { hit = { p, m }; break; }
    }
    if (!hit) { notes.push({ key: "map.compUnmatched", smi: c.smi }); continue; }
    left.set(hit.p.loc, left.get(hit.p.loc) - 1);
    assigned.push({ ...c, loc: hit.p.loc, toAtom: hit.m });
  }
  // atom-map number -> substrate component and atom; one segment per (substrate copy, product copy)
  const fromNum = new Map();
  assigned.forEach((c, ci) => { if (c.side < 0) c.maps.forEach((num, k) => { if (num) fromNum.set(num, [ci, c.loc, c.toAtom[k]]); }); });
  const seg = new Map();
  let mapped = 0, total = 0;
  assigned.forEach((c, pi) => {
    if (c.side < 0) return;
    c.maps.forEach((num, k) => {
      total++;
      const src = num ? fromNum.get(num) : undefined;
      if (!src) return;
      const [ci, sl, sa] = src, kk = ci + ":" + pi;
      if (!seg.has(kk)) seg.set(kk, [sl, c.loc, []]);
      seg.get(kk)[2].push(sa, c.toAtom[k]);
      mapped++;
    });
  });
  for (const p of parts) if (p.st && p.st.e.some((e) => e !== "H") && left.get(p.loc) === (Math.round(Math.abs(p.coef)) || 1)) notes.push({ key: "map.partMissing", loc: p.loc });
  return { s: [...seg.values()], mapped, total, notes };
}

/**
 * Automatic atom map by repeated maximum common substructure — the browser version of greedy_mcs() in
 * tools/build_atommaps.py (elements must match, bond orders may change).
 */
export function mcsMap(parts, rounds = 10) {
  if (!R) throw new Error("chem.noRdkit");
  // every stoichiometric copy is a molecule of its own (2 pyruvate -> acetoin + 2 CO2)
  const items = [];
  for (const p of parts) {
    if (!p.st) continue;
    const copies = Math.max(1, Math.min(4, Math.round(Math.abs(p.coef)) || 1));
    for (let k = 0; k < copies; k++) items.push({ ...p, key: p.loc + "#" + k, alive: new Set(p.st.e.map((_, i) => i)) });
  }
  const subs = items.filter((p) => p.side < 0), prods = items.filter((p) => p.side > 0);
  const frag = (p) => {
    const keep = [...p.alive];
    const mol = R.get_mol(structureToMolblock(p.st, keep), JSON.stringify({ sanitize: true, removeHs: false }));
    return { mol, keep };
  };
  const pairs = new Map();
  for (let round = 0; round < rounds; round++) {
    let best = null;
    for (const sp of subs) {
      if (sp.alive.size < 2) continue;
      for (const pp of prods) {
        if (pp.alive.size < 2) continue;
        const bound = Math.min(sp.alive.size, pp.alive.size);
        if (best && bound <= best.n) continue;
        const fs = frag(sp), fp = frag(pp);
        try {
          if (!fs.mol || !fp.mol) continue;
          const list = new R.MolList();
          list.append(fs.mol); list.append(fp.mol);
          const res = JSON.parse(R.get_mcs_as_json(list, JSON.stringify({ AtomCompare: "Elements", BondCompare: "Any", Timeout: 2 })));
          list.delete();
          if (!res.numAtoms || res.numAtoms < 2 || (best && res.numAtoms <= best.n)) continue;
          const qm = R.get_qmol(res.smarts);
          const a = JSON.parse(fs.mol.get_substruct_match(qm) || "{}").atoms, b = JSON.parse(fp.mol.get_substruct_match(qm) || "{}").atoms;
          qm.delete();
          if (!a || !b || a.length !== b.length) continue;
          best = { n: res.numAtoms, sp, pp, sa: a.map((x) => fs.keep[x]), pa: b.map((x) => fp.keep[x]) };
        } finally { fs.mol?.delete(); fp.mol?.delete(); }
      }
    }
    if (!best) break;
    const k = best.sp.key + "|" + best.pp.key;
    if (!pairs.has(k)) pairs.set(k, [best.sp.loc, best.pp.loc, []]);
    best.sa.forEach((x, i) => { pairs.get(k)[2].push(x, best.pa[i]); best.sp.alive.delete(x); best.pp.alive.delete(best.pa[i]); });
  }
  return [...pairs.values()];
}
