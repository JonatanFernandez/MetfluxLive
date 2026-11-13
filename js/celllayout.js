// Cell view: reactions grouped by (location, pathway) and laid out as a schematic cell.
// A location is a compartment, or a membrane for reactions that span two compartments.

const GAP = 0.42;
const rad = (n) => 0.13 + 0.04 * Math.sqrt(Math.min(n, 450));
const ASPECT = { mito: 1.6, er: 1.9, golgi: 1.7, nuc: 1.1, lyso: 1, perox: 1 };
// preferred organelle centres, as fractions of the cell semi-axes (y grows downwards)
const PREF = { nuc: [-0.42, -0.12], mito: [0.42, -0.26], er: [-0.3, 0.52], golgi: [0.24, 0.55], perox: [0.7, 0.22], lyso: [-0.72, 0.3] };
const SPARE = [[0, -0.6], [0.75, -0.1], [-0.05, 0.1], [-0.7, -0.4], [0.6, 0.6]];

const inEllipse = (x, y, E, grow = 0) => {
  const rx = E.rx + grow, ry = E.ry + grow;
  if (rx <= 0 || ry <= 0) return false;
  const u = (x - E.x) / rx, v = (y - E.y) / ry;
  return u * u + v * v < 1;
};

function perimeter(E, grow, n, fn) {
  for (let k = 0; k < n; k++) {
    const a = (k / n) * 2 * Math.PI;
    if (!fn(E.x + (E.rx + grow) * Math.cos(a), E.y + (E.ry + grow) * Math.sin(a))) return false;
  }
  return true;
}
const ellipseInside = (A, B, margin) => perimeter(A, 0, 24, (x, y) => inEllipse(x, y, B, -margin));
const ellipsesApart = (A, B, margin) => !inEllipse(A.x, A.y, B, margin) && !inEllipse(B.x, B.y, A, margin) &&
  perimeter(A, margin, 32, (x, y) => !inEllipse(x, y, B)) && perimeter(B, margin, 32, (x, y) => !inEllipse(x, y, A));

/** Spread nodes along an ellipse, evenly by arc length. */
function placeRing(nodes, E, phase = -Math.PI / 2) {
  if (!nodes.length) return true;
  const N = 720, pts = [], cum = [0];
  for (let k = 0; k <= N; k++) {
    const a = phase + (k / N) * 2 * Math.PI;
    pts.push([E.x + E.rx * Math.cos(a), E.y + E.ry * Math.sin(a)]);
    if (k) cum.push(cum[k - 1] + Math.hypot(pts[k][0] - pts[k - 1][0], pts[k][1] - pts[k - 1][1]));
  }
  let need = 0;
  for (const n of nodes) need += 2 * n.r + GAP;
  if (need > cum[N]) return false;
  const slack = (cum[N] - need) / nodes.length;
  let s = 0, k = 0;
  for (const n of nodes) {
    const at = s + n.r + (GAP + slack) / 2;
    while (k < N - 1 && cum[k + 1] < at) k++;
    n.x = pts[k][0]; n.y = pts[k][1];
    s += 2 * n.r + GAP + slack;
  }
  return true;
}

/** Greedy packing of circles inside an ellipse (largest first, centre outwards), avoiding holes. */
function packInside(nodes, E, inset, holes = []) {
  if (!nodes.length) return true;
  const step = 0.36;
  let cand = [];
  for (let row = 0, y = E.y - E.ry; y <= E.y + E.ry; y += step * 0.866, row++) {
    for (let x = E.x - E.rx + (row % 2) * step / 2; x <= E.x + E.rx; x += step) {
      const u = (x - E.x) / E.rx, v = (y - E.y) / E.ry, d = u * u + v * v;
      if (d < 1 && !holes.some((h) => inEllipse(x, y, h, 0.1))) cand.push([d, x, y]);
    }
  }
  cand.sort((a, b) => a[0] - b[0]);
  const sorted = [...nodes].sort((a, b) => b.r - a.r);
  const rmin = sorted[sorted.length - 1].r;
  const done = [];
  for (const n of sorted) {
    const hit = cand.find(([, x, y]) => inEllipse(x, y, E, -(n.r + inset)) && !holes.some((h) => inEllipse(x, y, h, n.r + 0.3)) &&
      !done.some((p) => (x - p.x) ** 2 + (y - p.y) ** 2 < (p.r + n.r + GAP) ** 2));
    if (!hit) return false;
    n.x = hit[1]; n.y = hit[2];
    done.push(n);
    // candidates too close for even the smallest remaining node are dropped to keep the scan short
    const reach = n.r + GAP + rmin;
    cand = cand.filter(([, x, y]) => (x - n.x) ** 2 + (y - n.y) ** 2 >= reach * reach);
  }
  return true;
}

const maxR = (nodes) => nodes.reduce((m, n) => Math.max(m, n.r), 0);
const startRy = (nodes, aspect) => {
  let area = 0;
  for (const n of nodes) area += Math.PI * (n.r + GAP / 2 + 0.1) ** 2;
  return Math.max(0.9, Math.sqrt(area / 0.5 / (Math.PI * aspect)));
};

/** Size an organelle around its contents. Returns ellipses centred on the origin. */
function buildOrganelle(inside, ring, aspect, innerRing) {
  const padIn = innerRing ? maxR(innerRing) : maxR(ring);
  let ry = startRy(inside, aspect) + padIn;
  for (let it = 0; it < 120; it++, ry *= 1.06) {
    const E = { x: 0, y: 0, rx: ry * aspect, ry };
    if (!packInside(inside, E, padIn + 0.3)) continue;
    if (!innerRing) {
      if (!placeRing(ring, E)) continue;
      return { outer: E, pad: padIn };
    }
    if (!placeRing(innerRing, E)) continue;
    const d = padIn + maxR(ring) + GAP + 0.15;
    const O = { x: 0, y: 0, rx: E.rx + d, ry: E.ry + d };
    if (!placeRing(ring, O, -Math.PI / 2 + 0.2)) continue;
    return { outer: O, inner: E, pad: maxR(ring) };
  }
  return null;
}

/**
 * @returns null when the model has no recognisable cytosol, otherwise
 *   { groups: [{ ss, loc, rxns }], groupOf: Int32Array, nodes, regions }
 *   regions: [{ loc, x, y, rx, ry, lx, ly, comp, wavy?, dash? }]
 */
export function buildCellLayout(model, index) {
  const role = index.compRole, C = index.roleComp;
  if (!C.cyt) return null;
  const hasInner = !!(C.inner && C.mito);

  // ---- location of every reaction
  const groups = [], byKey = new Map();
  const groupOf = new Int32Array(model.rxns.length).fill(-1);
  model.rxns.forEach((r, j) => {
    const comps = [...new Set(r.m.map((m) => model.mets[m].c))].sort();
    if (!comps.length) return;
    let loc;
    if (hasInner && comps.includes(C.inner)) loc = "mem:" + C.inner;
    else if (comps.length === 1) loc = comps[0];
    else {
      const org = comps.filter((c) => c !== C.cyt && c !== C.ext);
      loc = "mem:" + (org.length ? org[0] : C.ext || comps[0]);
    }
    const key = loc + "#" + r.ss;
    let g = byKey.get(key);
    if (g === undefined) { byKey.set(key, (g = groups.length)); groups.push({ ss: r.ss, loc, rxns: [] }); }
    groups[g].rxns.push(j);
    groupOf[j] = g;
  });
  const nodes = groups.map((g, i) => ({ type: 2, ref: i, ss: g.ss, loc: g.loc, size: g.rxns.length, r: rad(g.rxns.length), x: 0, y: 0 }));
  const at = (loc) => nodes.filter((n) => n.loc === loc);

  // ---- organelles
  const orgs = [];
  for (const c of Object.keys(model.compartments)) {
    if (c === C.cyt || c === C.ext || (hasInner && c === C.inner)) continue;
    const inside = at(c), ring = at("mem:" + c);
    const isMito = hasInner && c === C.mito;
    const innerRing = isMito ? at("mem:" + C.inner) : null;
    if (!inside.length && !ring.length && !(innerRing && innerRing.length)) continue;
    const shape = buildOrganelle(inside, ring, ASPECT[role[c]] || 1.2, innerRing);
    if (!shape) return null;
    const members = [...inside, ...ring, ...(innerRing || [])];
    orgs.push({ c, role: role[c], ...shape, members, bound: { x: 0, y: 0, rx: shape.outer.rx + shape.pad + 0.2, ry: shape.outer.ry + shape.pad + 0.2 } });
  }
  orgs.sort((a, b) => b.bound.rx * b.bound.ry - a.bound.rx * a.bound.ry);

  // ---- the cell
  const cyt = at(C.cyt), plasma = C.ext ? at("mem:" + C.ext) : [], ext = C.ext ? at(C.ext) : [];
  const padE = maxR(plasma), dOut = padE + maxR(ext) + GAP + 0.3;
  let area = 0;
  for (const o of orgs) area += Math.PI * o.bound.rx * o.bound.ry;
  for (const n of cyt) area += Math.PI * (n.r + GAP) ** 2;
  let RY = Math.sqrt(area / 0.42 / (Math.PI * 1.5));
  let cell = null, placed = null;
  for (let it = 0; it < 80 && !cell; it++, RY *= 1.06) {
    const E = { x: 0, y: 0, rx: RY * 1.5, ry: RY };
    placed = [];
    let ok = true, spare = 0;
    for (const o of orgs) {
      const pref = PREF[o.role] || SPARE[spare++ % SPARE.length];
      const px = pref[0] * E.rx, py = pref[1] * E.ry;
      const cand = [];
      for (let y = -E.ry; y <= E.ry; y += 0.6) for (let x = -E.rx; x <= E.rx; x += 0.6) cand.push([(x - px) ** 2 + (y - py) ** 2, x, y]);
      cand.sort((a, b) => a[0] - b[0]);
      const hit = cand.find(([, x, y]) => {
        const B = { ...o.bound, x, y };
        return ellipseInside(B, E, padE + 0.4) && placed.every((p) => ellipsesApart(B, p.B, 0.5));
      });
      if (!hit) { ok = false; break; }
      placed.push({ o, B: { ...o.bound, x: hit[1], y: hit[2] } });
    }
    if (!ok) continue;
    if (!packInside(cyt, E, padE + 0.3, placed.map((p) => p.B))) continue;
    if (!placeRing(plasma, E)) continue;
    const O = { x: 0, y: 0, rx: E.rx + dOut, ry: E.ry + dOut };
    if (!placeRing(ext, O, -Math.PI / 2 + 0.15)) continue;
    cell = { E, O };
  }
  if (!cell) return null;

  // ---- regions (draw order: back to front)
  const regions = [{ loc: C.cyt, comp: C.cyt, ...cell.E, lx: 0, ly: -cell.E.ry + padE + 0.75, cell: true }];
  if (C.ext) regions.push({ loc: C.ext, comp: C.ext, x: 0, y: 0, rx: 0, ry: 0, lx: 0, ly: -cell.O.ry - maxR(ext) - 0.7, labelOnly: true });
  for (const { o, B } of placed) {
    for (const n of o.members) { n.x += B.x; n.y += B.y; }
    regions.push({ loc: o.c, comp: o.c, x: B.x, y: B.y, rx: o.outer.rx, ry: o.outer.ry, lx: B.x, ly: B.y - o.outer.ry - o.pad - 0.45, dash: o.role === "nuc" });
    if (o.inner) regions.push({ loc: "mem:" + C.inner, comp: C.inner, x: B.x, y: B.y, rx: o.inner.rx, ry: o.inner.ry, wavy: 18, noLabel: true });
  }
  return { groups, groupOf, nodes, regions };
}
