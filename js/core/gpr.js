// Gene-protein-reaction rules: "A and (B or C)" -> residual activity of the reaction.
// Complex subunits (and) are limited by the scarcest one; isoenzymes (or) compensate.

const cache = new Map();

function parse(rule) {
  const tok = rule.match(/\(|\)|[^\s()]+/g) || [];
  let p = 0;
  const is = (w) => tok[p] !== undefined && tok[p].toLowerCase() === w;
  const factor = () => {
    if (tok[p] === "(") { p++; const n = expr(); if (tok[p] === ")") p++; return n; }
    return tok[p++];
  };
  const term = () => { let n = factor(); while (is("and")) { p++; n = ["and", n, factor()]; } return n; };
  const expr = () => { let n = term(); while (is("or")) { p++; n = ["or", n, term()]; } return n; };
  return expr();
}

/**
 * @param rule   GPR string (may be empty)
 * @param levels Map gene -> activity in [0, 1]; genes not listed are at 1
 * @returns activity of the reaction in [0, 1]
 */
export function gprActivity(rule, levels) {
  if (!rule) return 1;
  let ast = cache.get(rule);
  if (ast === undefined) cache.set(rule, (ast = parse(rule)));
  const ev = (n) => {
    if (typeof n === "string") return levels.get(n) ?? 1;
    if (!n) return 1;
    const a = ev(n[1]), b = ev(n[2]);
    return n[0] === "or" ? Math.max(a, b) : Math.min(a, b);
  };
  return ev(ast);
}

/**
 * Whether a reaction keeps an enzyme when the genes in `off` are absent (cell types: genes whose mRNA is not detected).
 * Strict (default): every subunit of a complex is needed, as in gprActivity.
 * With `complexes`: a complex of at least `minSize` subunits (an "and" of that many terms; an "or" of isoforms inside it
 * counts as one subunit) is kept when at least `minShare` of its subunits are detected. A single undetected subunit
 * among dozens of well-expressed ones is more often a measurement or annotation problem than a missing complex: in the
 * Human Protein Atlas, NDUFA6 alone would remove respiratory complex I from a quarter of all cell types (docs, section 6).
 */
export function gprPresent(rule, off, { complexes = false, minSize = 5, minShare = 0.8 } = {}) {
  if (!rule) return true;
  let ast = cache.get(rule);
  if (ast === undefined) cache.set(rule, (ast = parse(rule)));
  const flat = (n, op, out = []) => { if (Array.isArray(n) && n[0] === op) { flat(n[1], op, out); flat(n[2], op, out); } else out.push(n); return out; };
  const ev = (n) => {
    if (typeof n === "string") return !off.has(n);
    if (!n) return true;
    if (n[0] === "or") return flat(n, "or").some(ev);
    const parts = flat(n, "and"), ok = parts.filter(ev).length;
    return complexes && parts.length >= minSize ? ok >= minShare * parts.length : ok === parts.length;
  };
  return ev(ast);
}
