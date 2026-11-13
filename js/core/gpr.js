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
