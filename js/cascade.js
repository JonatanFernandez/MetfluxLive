// Cascade view: metabolites ordered by how many reaction steps separate them from the medium.
// Depth 0 = metabolites supplied in the medium; each reaction that can consume a metabolite puts
// its products one step further down. Cofactors (currency metabolites) are ignored, otherwise
// everything would be one step away from everything through ATP or water.

/**
 * Breadth-first depth of every metabolite from the source metabolites.
 * Reaction directions follow the model bounds, not the simulated fluxes, so the order is stable.
 * @returns { depth: Int32Array (-1 = not reachable or currency), max }
 */
export function metDepths(model, index, sources) {
  const { mets, rxns } = model;
  const depth = new Int32Array(mets.length).fill(-1);
  let queue = [];
  for (const m of sources) if (depth[m] < 0 && !index.currency[mets[m].b]) { depth[m] = 0; queue.push(m); }
  const done = new Uint8Array(rxns.length);
  let max = 0;
  while (queue.length) {
    const next = [];
    for (const m of queue) {
      for (let p = index.rxnStart[m]; p < index.rxnStart[m + 1]; p++) {
        const j = index.rxnList[p];
        if (done[j]) continue;
        const r = rxns[j], c = index.rxnCoef[p];
        if (r.m.length < 2) continue;
        // m must be consumable: on the left of a forward reaction, or on the right of a reversible one
        if (!((c < 0 && r.ub > 0) || (c > 0 && r.lb < 0))) continue;
        if (r.lb < 0 && r.ub > 0) done[j] = 1; // a reversible reaction reaches all its metabolites at once
        for (let q = 0; q < r.m.length; q++) {
          const x = r.m[q];
          if (depth[x] >= 0 || r.c[q] * c > 0 || index.currency[mets[x].b]) continue;
          depth[x] = depth[m] + 1; next.push(x);
          if (depth[x] > max) max = depth[x];
        }
      }
    }
    queue = next;
  }
  return { depth, max };
}

const median = (a) => { a.sort((x, y) => x - y); return a.length ? a[(a.length - 1) >> 1] : -1; };

/** Order the items of each row by the mean position of their neighbours in the other rows. */
function untangle(rows, neighbours, sweeps = 8) {
  const posOf = new Map();
  const index = () => rows.forEach((row) => row.forEach((id, i) => posOf.set(id, row.length > 1 ? i / (row.length - 1) : 0.5)));
  index();
  for (let s = 0; s < sweeps; s++) {
    const order = s % 2 ? [...rows.keys()].reverse() : [...rows.keys()];
    for (const k of order) {
      const row = rows[k], key = new Map();
      row.forEach((id, i) => {
        const nb = neighbours.get(id);
        let sum = 0, n = 0;
        if (nb) for (const o of nb) if (posOf.has(o)) { sum += posOf.get(o); n++; }
        key.set(id, n ? sum / n : posOf.get(id) ?? i);
      });
      row.sort((a, b) => key.get(a) - key.get(b));
      row.forEach((id, i) => posOf.set(id, row.length > 1 ? i / (row.length - 1) : 0.5));
    }
  }
}

/**
 * Global cascade: pathway bubbles in rows, the pathways closest to the medium on top.
 * @param gNodes layout.global.nodes [{ ss, r, n }], gEdges [[ssA, ssB, w]]
 * @returns { pos: Map ss -> [x, y], level: Map ss -> median depth, guides: [{ y, depth }] }
 */
export function cascadeGlobal(model, index, gNodes, gEdges, D) {
  const level = new Map();
  for (const n of gNodes) {
    const ds = [], seen = new Set();
    for (const j of index.rxnsOfSub[n.ss]) for (const m of model.rxns[j].m) {
      if (seen.has(m)) continue;
      seen.add(m);
      if (D.depth[m] >= 0) ds.push(D.depth[m]);
    }
    const md = median(ds);
    level.set(n.ss, md < 0 ? D.max + 1 : md);
  }
  const sorted = [...gNodes].sort((a, b) => level.get(a.ss) - level.get(b.ss) || b.n - a.n);
  const GAP = 1.15;
  let total = 0;
  for (const n of sorted) total += 2 * n.r + GAP;
  const W = Math.sqrt(1.9 * total * 1.9);
  const rows = [];
  let cur = [], w = 0;
  for (const n of sorted) {
    if (cur.length && w + 2 * n.r + GAP > W) { rows.push(cur); cur = []; w = 0; }
    cur.push(n); w += 2 * n.r + GAP;
  }
  if (cur.length) rows.push(cur);
  const byId = new Map(gNodes.map((n) => [n.ss, n]));
  const nb = new Map();
  for (const [a, b] of gEdges) {
    if (!byId.has(a) || !byId.has(b)) continue;
    (nb.get(a) || nb.set(a, []).get(a)).push(b); (nb.get(b) || nb.set(b, []).get(b)).push(a);
  }
  const idRows = rows.map((row) => row.map((n) => n.ss));
  untangle(idRows, nb, 10);
  const pos = new Map(), guides = [];
  let y = 0;
  idRows.forEach((row) => {
    const ns = row.map((id) => byId.get(id));
    const rmax = ns.reduce((m, n) => Math.max(m, n.r), 0);
    let width = 0;
    for (const n of ns) width += 2 * n.r + GAP;
    const gap = GAP + Math.max(0, (W - width) / Math.max(1, ns.length)) * 0.6;
    let x = -(width + (gap - GAP) * ns.length) / 2;
    y += rmax;
    // alternate nodes are nudged up and down so that neighbouring labels do not collide
    ns.forEach((n, i) => { pos.set(n.ss, [x + n.r + gap / 2, y + (i % 2 ? 0.42 : -0.1)]); x += 2 * n.r + gap; });
    const ds = ns.map((n) => level.get(n.ss));
    guides.push({ y: y - rmax - 0.55, from: Math.min(...ds), to: Math.max(...ds) });
    y += rmax + 1.75;
  });
  return { pos, level, guides, width: W };
}

/**
 * Cascade layout of one pathway map: metabolites in rows by level, reactions between the rows they connect.
 * @param L layout.subs[ss] { m, r } (metabolite and reaction indices of the map)
 * @returns { mx, my, rx, ry, guides }
 */
export function cascadeSub(model, L, D) {
  const DX = 2.5, DY = 2.5, WRAP = 12;
  const inMap = new Map(L.m.map((m, k) => [m, k]));
  // Levels are counted inside the pathway: its metabolites closest to the medium are the entry (level 0)
  // and every reaction of the map leads one level down. Counting from the medium itself would flatten
  // the picture, because a rich medium reaches most intermediates in two or three steps.
  const local = new Map();
  const consumers = new Map(); // met -> [[reaction position, coefficient]]
  L.r.forEach((j, k) => model.rxns[j].m.forEach((m, q) => { if (inMap.has(m)) (consumers.get(m) || consumers.set(m, []).get(m)).push([k, model.rxns[j].c[q]]); }));
  const reachable = L.m.filter((m) => D.depth[m] >= 0);
  let gmin = Infinity, deepest = 0;
  for (const m of reachable) gmin = Math.min(gmin, D.depth[m]);
  for (;;) {
    let g = Infinity;
    for (const m of reachable) if (!local.has(m) && D.depth[m] < g) g = D.depth[m];
    if (g === Infinity) break;
    // a branch that the entry does not lead to starts as deep as its own distance from the medium allows
    const start = local.size ? Math.min(g - gmin, deepest) : 0;
    let queue = reachable.filter((m) => !local.has(m) && D.depth[m] === g);
    for (const m of queue) local.set(m, start);
    while (queue.length) {
      const next = [];
      for (const m of queue) for (const [k, c] of consumers.get(m) || []) {
        const r = model.rxns[L.r[k]];
        if (!((c < 0 && r.ub > 0) || (c > 0 && r.lb < 0))) continue;
        r.m.forEach((x, q) => {
          if (!inMap.has(x) || local.has(x) || r.c[q] * c > 0 || D.depth[x] < 0) return;
          local.set(x, local.get(m) + 1); next.push(x);
          if (local.get(x) > deepest) deepest = local.get(x);
        });
      }
      queue = next;
    }
  }
  const top = deepest;
  const dOf = (m) => (local.has(m) ? local.get(m) : top + 1);
  const levels = [...new Set(L.m.map(dOf))].sort((x, y) => x - y);
  // neighbours through the reactions of the map
  const nb = new Map();
  const rxnMets = L.r.map((j) => model.rxns[j].m.filter((m) => inMap.has(m)));
  for (const ms of rxnMets) for (const a of ms) for (const b of ms) if (a !== b) (nb.get(a) || nb.set(a, []).get(a)).push(b);
  const rows = levels.map((d) => L.m.filter((m) => dOf(m) === d));
  untangle(rows, nb, 12);
  const mx = new Array(L.m.length), my = new Array(L.m.length), guides = [];
  let y = 0;
  rows.forEach((row, k) => {
    const lines = Math.ceil(row.length / WRAP), per = Math.ceil(row.length / lines);
    guides.push({ y: y - DY * 0.42, level: levels[k], unreachable: levels[k] > top });
    row.forEach((m, i) => {
      const line = Math.floor(i / per), col = i % per, n = Math.min(per, row.length - line * per);
      // wrapped lines are shifted by half a step, like bricks
      mx[inMap.get(m)] = (col - (n - 1) / 2) * DX + (line % 2 ? DX / 2 : 0);
      my[inMap.get(m)] = y + line * DY * 0.55;
    });
    y += DY + (lines - 1) * DY * 0.55;
  });
  // reactions: between their metabolites
  const rx = new Array(L.r.length), ry = new Array(L.r.length);
  L.r.forEach((j, k) => {
    const ms = rxnMets[k];
    if (!ms.length) { rx[k] = 0; ry[k] = y; return; }
    let sx = 0, sy = 0, y0 = Infinity, y1 = -Infinity;
    for (const m of ms) { const i = inMap.get(m); sx += mx[i]; sy += my[i]; y0 = Math.min(y0, my[i]); y1 = Math.max(y1, my[i]); }
    rx[k] = sx / ms.length;
    ry[k] = y1 - y0 < 0.3 ? y0 + DY * 0.45 : sy / ms.length;
  });
  // push apart reactions that landed on the same spot
  const band = new Map();
  L.r.forEach((_, k) => { const b = Math.round(ry[k] / 0.7); (band.get(b) || band.set(b, []).get(b)).push(k); });
  for (const ks of band.values()) {
    ks.sort((a, b) => rx[a] - rx[b]);
    for (let i = 1; i < ks.length; i++) if (rx[ks[i]] - rx[ks[i - 1]] < 0.95) rx[ks[i]] = rx[ks[i - 1]] + 0.95;
  }
  // metabolites and reactions never share a spot
  L.r.forEach((_, k) => {
    for (let i = 0; i < L.m.length; i++) if (Math.abs(mx[i] - rx[k]) < 0.5 && Math.abs(my[i] - ry[k]) < 0.5) { ry[k] += 0.75; break; }
  });
  return { mx, my, rx, ry, guides };
}
