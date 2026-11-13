// Static SVG charts for the results download. Light surface, meant for reports and slides.
// Colours: validated categorical palette (blue, orange, aqua, yellow, magenta, green, violet, red);
// text always in ink colours, never in the series colour.

const INK = "#0b0b0b", INK2 = "#52514e", GRID = "#e4e3df", SURFACE = "#fcfcfb";
export const SERIES = ["#2a78d6", "#eb6834", "#1baf7a", "#eda100", "#e87ba4", "#008300", "#6250d6", "#e34948"];
const FONT = "font-family=\"Inter, 'Segoe UI', Helvetica, Arial, sans-serif\"";
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const clip = (s, n) => (s.length > n ? s.slice(0, n - 1) + "…" : s);

export function num(x) {
  const a = Math.abs(x);
  if (a === 0) return "0";
  if (a >= 100) return x.toFixed(0);
  if (a >= 1) return x.toFixed(2);
  if (a >= 0.001) return x.toPrecision(3);
  return x.toExponential(1);
}

function frame(w, h, title, subtitle, body) {
  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" ${FONT}>
<rect width="${w}" height="${h}" fill="${SURFACE}"/>
<text x="24" y="32" font-size="16" font-weight="600" fill="${INK}">${esc(title)}</text>
${subtitle ? `<text x="24" y="51" font-size="12" fill="${INK2}">${esc(subtitle)}</text>` : ""}
${body}
</svg>
`;
}

/** Bar with a square start on the baseline and a rounded data end. */
function hbar(x, y, w, h, fill) {
  const r = Math.min(4, h / 2, w);
  if (w <= 0.5) return "";
  return `<path d="M${x},${y}h${(w - r).toFixed(1)}a${r},${r} 0 0 1 ${r},${r}v${(h - 2 * r).toFixed(1)}a${r},${r} 0 0 1 -${r},${r}h-${(w - r).toFixed(1)}z" fill="${fill}"/>`;
}
function vbar(x, y0, w, h, fill) {
  const r = Math.min(4, w / 2, h);
  if (h <= 0.5) return "";
  return `<path d="M${x},${y0}v-${(h - r).toFixed(1)}a${r},${r} 0 0 1 ${r},-${r}h${(w - 2 * r).toFixed(1)}a${r},${r} 0 0 1 ${r},${r}v${(h - r).toFixed(1)}z" fill="${fill}"/>`;
}

function legend(items, x, y) {
  let out = "", cx = x;
  for (const [label, color] of items) {
    out += `<rect x="${cx}" y="${y - 9}" width="10" height="10" rx="2" fill="${color}"/><text x="${cx + 15}" y="${y}" font-size="12" fill="${INK2}">${esc(label)}</text>`;
    cx += 30 + label.length * 6.6;
  }
  return out;
}

/**
 * Horizontal bars, one or two series per row.
 * @param o { title, subtitle, rows: [{ label, values: [a] | [a, b] }], series: [name...], unit, colors, format }
 */
export function barChart(o) {
  const rows = o.rows, k = o.series?.length || 1, colors = o.colors || SERIES;
  const fmt = o.format || num;
  const barH = k > 1 ? 9 : 14, rowH = k * barH + (k - 1) * 2 + 10;
  const W = 760, left = 250, right = 80, top = k > 1 ? 92 : 70;
  const H = top + rows.length * rowH + 44;
  const max = Math.max(1e-300, ...rows.flatMap((r) => r.values.map(Math.abs)));
  const pw = W - left - right;
  let body = k > 1 ? legend(o.series.map((s, i) => [s, colors[i]]), 24, 74) : "";
  for (let g = 0; g <= 4; g++) {
    const x = left + (pw * g) / 4;
    body += `<line x1="${x}" x2="${x}" y1="${top - 6}" y2="${H - 38}" stroke="${GRID}" stroke-width="1"/><text x="${x}" y="${H - 22}" font-size="11" fill="${INK2}" text-anchor="middle">${fmt((max * g) / 4)}</text>`;
  }
  if (o.unit) body += `<text x="${W - right}" y="${H - 6}" font-size="11" fill="${INK2}" text-anchor="end">${esc(o.unit)}</text>`;
  rows.forEach((r, i) => {
    const y = top + i * rowH;
    body += `<text x="${left - 10}" y="${y + (rowH - 10) / 2 + 4}" font-size="12" fill="${INK}" text-anchor="end">${esc(clip(r.label, 36))}</text>`;
    r.values.forEach((v, s) => {
      const w = (Math.abs(v) / max) * pw, by = y + s * (barH + 2);
      body += hbar(left, by, w, barH, colors[s]);
      body += `<text x="${left + w + 6}" y="${by + barH / 2 + 4}" font-size="11" fill="${INK2}">${fmt(v)}</text>`;
    });
  });
  body += `<line x1="${left}" x2="${left}" y1="${top - 6}" y2="${H - 38}" stroke="${INK2}" stroke-width="1"/>`;
  return frame(W, H, o.title, o.subtitle, body);
}

/**
 * Lines over a shared x axis.
 * @param o { title, subtitle, x: [..], series: [{ name, y: [..] }], xLabel, yLabel, logX, yMax }
 */
export function lineChart(o) {
  const W = 760, H = 420, left = 64, right = 150, top = 76, bottom = 52;
  const pw = W - left - right, ph = H - top - bottom;
  const xs = o.x, tx = o.logX ? (v) => Math.log10(v) : (v) => v;
  const x0 = tx(xs[0]), x1 = tx(xs[xs.length - 1]);
  const yMax = o.yMax ?? Math.max(1e-300, ...o.series.flatMap((s) => s.y)) * 1.05;
  const px = (v) => left + ((tx(v) - x0) / Math.max(1e-300, x1 - x0)) * pw, py = (v) => top + ph - (Math.min(v, yMax) / yMax) * ph;
  let body = "";
  for (let g = 0; g <= 4; g++) {
    const y = top + ph - (ph * g) / 4;
    body += `<line x1="${left}" x2="${left + pw}" y1="${y}" y2="${y}" stroke="${GRID}" stroke-width="1"/><text x="${left - 8}" y="${y + 4}" font-size="11" fill="${INK2}" text-anchor="end">${num((yMax * g) / 4)}</text>`;
  }
  const ticks = o.logX
    ? (() => { const t = []; for (let e = Math.ceil(x0 - 1e-9); e <= Math.floor(x1 + 1e-9); e++) t.push(Math.pow(10, e)); return t; })()
    : Array.from({ length: 6 }, (_, i) => xs[0] + ((xs[xs.length - 1] - xs[0]) * i) / 5);
  for (const v of ticks) body += `<line x1="${px(v)}" x2="${px(v)}" y1="${top + ph}" y2="${top + ph + 5}" stroke="${INK2}"/><text x="${px(v)}" y="${top + ph + 19}" font-size="11" fill="${INK2}" text-anchor="middle">${num(v)}</text>`;
  body += `<line x1="${left}" x2="${left + pw}" y1="${top + ph}" y2="${top + ph}" stroke="${INK2}" stroke-width="1"/>`;
  body += `<text x="${left + pw / 2}" y="${H - 10}" font-size="12" fill="${INK2}" text-anchor="middle">${esc(o.xLabel || "")}</text>`;
  body += `<text x="${left}" y="${top - 10}" font-size="12" fill="${INK2}">${esc(o.yLabel || "")}</text>`;
  // direct labels at the line ends, pushed apart so that they stay readable
  const ends = o.series.map((s, i) => ({ i, y: py(s.y[s.y.length - 1]) })).sort((a, b) => a.y - b.y);
  for (let i = 1; i < ends.length; i++) if (ends[i].y - ends[i - 1].y < 14) ends[i].y = ends[i - 1].y + 14;
  const over = ends.length ? ends[ends.length - 1].y - (top + ph) : 0;
  if (over > 0) for (const e of ends) e.y -= over;
  const labelY = new Map(ends.map((e) => [e.i, e.y]));
  o.series.forEach((s, i) => {
    const color = SERIES[i % SERIES.length];
    body += `<polyline fill="none" stroke="${color}" stroke-width="2" stroke-linejoin="round" points="${s.y.map((v, k) => `${px(xs[k]).toFixed(1)},${py(v).toFixed(1)}`).join(" ")}"/>`;
    const ly = labelY.get(i);
    body += `<circle cx="${left + pw + 12}" cy="${ly}" r="4" fill="${color}"/><text x="${left + pw + 21}" y="${ly + 4}" font-size="12" fill="${INK}">${esc(clip(s.name, 18))}</text>`;
  });
  return frame(W, H, o.title, o.subtitle, body);
}

/**
 * Small multiples of mass isotopologue distributions.
 * @param o { title, subtitle, panels: [{ name, dist: [p0, p1, ...], note }] }
 */
export function midChart(o) {
  const cols = 3, pw = 232, ph = 150, gapX = 14, gapY = 36, left = 24, top = 76;
  const rowsN = Math.ceil(o.panels.length / cols);
  const W = left * 2 + cols * pw + (cols - 1) * gapX, H = top + rowsN * (ph + gapY) + 8;
  let body = "";
  o.panels.forEach((p, i) => {
    const x = left + (i % cols) * (pw + gapX), y = top + Math.floor(i / cols) * (ph + gapY);
    const n = p.dist.length, plotH = ph - 44, base = y + 22 + plotH, slot = (pw - 8) / n, bw = Math.max(3, Math.min(26, slot - 2));
    body += `<text x="${x}" y="${y + 10}" font-size="12" font-weight="600" fill="${INK}">${esc(clip(p.name, 34))}</text>`;
    body += `<line x1="${x}" x2="${x + pw}" y1="${base}" y2="${base}" stroke="${INK2}" stroke-width="1"/>`;
    body += `<line x1="${x}" x2="${x + pw}" y1="${base - plotH}" y2="${base - plotH}" stroke="${GRID}" stroke-width="1"/>`;
    const every = n > 12 ? Math.ceil(n / 8) : 1;
    p.dist.forEach((v, k) => {
      const cx = x + 4 + k * slot + slot / 2;
      body += vbar(cx - bw / 2, base, bw, v * plotH, SERIES[0]);
      if (k % every === 0) body += `<text x="${cx}" y="${base + 13}" font-size="10" fill="${INK2}" text-anchor="middle">${n > 9 ? k : "M+" + k}</text>`;
      if (v >= 0.05 && n <= 9) body += `<text x="${cx}" y="${base - v * plotH - 3}" font-size="10" fill="${INK}" text-anchor="middle">${(100 * v).toFixed(0)} %</text>`;
    });
    if (p.note) body += `<text x="${x}" y="${base + 27}" font-size="10" fill="${INK2}">${esc(p.note)}</text>`;
  });
  return frame(W, H, o.title, o.subtitle, body);
}
