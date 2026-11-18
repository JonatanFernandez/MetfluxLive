// Library of commercially available isotope tracers (data/tracers.json) and how each one labels the atoms of the
// model's structure.
//
// Uniform tracers label every atom of an element. Position-specific ones ([1,2-13C2]glucose, [5-13C]glutamine...)
// name IUPAC positions; those are found by matching a small reference graph, whose atoms carry the position names,
// onto the heavy atoms of the model's structure (graph isomorphism on element and bonds).

// Reference heavy-atom graphs with position names. Glucose as the pyranose ring the models draw.
const REF = {
  glucose: {
    atoms: [["C1", "C"], ["C2", "C"], ["C3", "C"], ["C4", "C"], ["C5", "C"], ["C6", "C"], ["O1", "O"], ["O2", "O"], ["O3", "O"], ["O4", "O"], ["O5", "O"], ["O6", "O"]],
    bonds: [["C1", "C2"], ["C2", "C3"], ["C3", "C4"], ["C4", "C5"], ["C5", "O5"], ["O5", "C1"], ["C5", "C6"], ["C1", "O1"], ["C2", "O2"], ["C3", "O3"], ["C4", "O4"], ["C6", "O6"]],
  },
  glutamine: {
    atoms: [["C1", "C"], ["C2", "C"], ["C3", "C"], ["C4", "C"], ["C5", "C"], ["O1a", "O"], ["O1b", "O"], ["N2", "N"], ["O5", "O"], ["N5", "N"]],
    bonds: [["C1", "O1a"], ["C1", "O1b"], ["C1", "C2"], ["C2", "N2"], ["C2", "C3"], ["C3", "C4"], ["C4", "C5"], ["C5", "O5"], ["C5", "N5"]],
  },
  "L-lactate": {
    atoms: [["C1", "C"], ["C2", "C"], ["C3", "C"], ["O1a", "O"], ["O1b", "O"], ["O2", "O"]],
    bonds: [["C1", "O1a"], ["C1", "O1b"], ["C1", "C2"], ["C2", "O2"], ["C2", "C3"]],
  },
};

let cache = null;
export async function loadTracers() {
  if (!cache) cache = fetch("data/tracers.json").then((r) => (r.ok ? r.json() : null)).catch(() => null);
  return cache;
}

/** Map reference position names to atom indices of a structure (null when the graphs do not match). */
export function matchPositions(ref, st) {
  const n = st.e.length;
  if (ref.atoms.length !== n) return null;
  const adj = Array.from({ length: n }, () => new Set());
  for (let k = 0; k < st.b.length; k += 4) { adj[st.b[k]].add(st.b[k + 1]); adj[st.b[k + 1]].add(st.b[k]); }
  const names = ref.atoms.map((a) => a[0]), el = ref.atoms.map((a) => a[1]), idx = new Map(names.map((x, i) => [x, i]));
  const radj = Array.from({ length: n }, () => new Set());
  for (const [a, b] of ref.bonds) { radj[idx.get(a)].add(idx.get(b)); radj[idx.get(b)].add(idx.get(a)); }
  const map = new Int32Array(n).fill(-1), used = new Uint8Array(n);
  const go = (i) => {
    if (i === n) return true;
    for (let s = 0; s < n; s++) {
      if (used[s] || st.e[s] !== el[i] || adj[s].size !== radj[i].size) continue;
      let ok = true;
      for (const r of radj[i]) if (r < i && !adj[s].has(map[r])) { ok = false; break; }
      if (!ok) continue;
      map[i] = s; used[s] = 1;
      if (go(i + 1)) return true;
      used[s] = 0; map[i] = -1;
    }
    return false;
  };
  if (!go(0)) return null;
  return new Map(names.map((x, i) => [x, map[i]]));
}

/**
 * Atom labels (Float64Array, 1 = heavy isotope) of a tracer on the model's structure of its metabolite.
 * @returns { label, elements: Set } or null when the structure is missing or a position cannot be placed
 */
export function tracerLabel(tracer, st) {
  if (!st) return null;
  const label = new Float64Array(st.e.length), elements = new Set();
  for (const [el, spec] of Object.entries(tracer.label)) {
    elements.add(el);
    if (spec === "all") { st.e.forEach((e, i) => { if (e === el) label[i] = 1; }); continue; }
    const ref = REF[tracer.met], pos = ref ? matchPositions(ref, st) : null;
    if (!pos) return null;
    for (const p of spec) { const i = pos.get(p); if (i === undefined || st.e[i] !== el) return null; label[i] = 1; }
  }
  return label.some((x) => x > 0) ? { label, elements } : null;
}
