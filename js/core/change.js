// Change of a flux between two conditions, A (reference) and B (shown), as drawn in the "A → B" map view.
//
// Size and direction are kept apart, so that a reversal is never mistaken for a large change:
//  - size: change of |v| on an asinh scale, asinh(|B|/eps) - asinh(|A|/eps). Well above eps it is the natural log
//    of the fold change (0.2 -> 0.4 gives ln 2); near zero it stays finite (0 -> x is large but not infinite), which
//    a plain log ratio cannot do. log(x + 1) would not work here: fluxes are ~0.001-1 mmol/gDW/h, so +1 flattens them.
//  - kind: "same", "up", "down", "on" (only in B), "off" (only in A), "rev" (runs the other way in B), "zero".

/** mmol/gDW/h: below this a flux counts as zero (the level of the trace secretions, measured.js). */
export const FLUX_EPS = 1e-3;
/** The colour saturates at an 8-fold change. */
export const FOLD_FULL = Math.log(8);

/** Equal within 2 % (and 1e-7). */
export const sameFlux = (a, b) => Math.abs(a - b) <= 1e-7 + 0.02 * Math.max(Math.abs(a), Math.abs(b));

/** asinh change of size, scaled to [-1, 1] (1 = 8-fold or more up). */
export function sizeChange(a, b, eps = FLUX_EPS) {
  const x = (Math.asinh(Math.abs(b) / eps) - Math.asinh(Math.abs(a) / eps)) / FOLD_FULL;
  return Math.max(-1, Math.min(1, x));
}

/** @returns { size in [-1, 1], kind } for a signed flux going from a (condition A) to b (condition B). */
export function fluxChange(a, b, eps = FLUX_EPS) {
  const A = Math.abs(a), B = Math.abs(b);
  if (A <= eps && B <= eps) return { size: 0, kind: A || B ? "same" : "zero" };
  if (A <= eps) return { size: sizeChange(a, b, eps), kind: "on" };
  if (B <= eps) return { size: sizeChange(a, b, eps), kind: "off" };
  if (Math.sign(a) !== Math.sign(b)) return { size: sameFlux(A, B) ? 0 : sizeChange(a, b, eps), kind: "rev" };
  if (sameFlux(a, b)) return { size: 0, kind: "same" };
  return { size: sizeChange(a, b, eps), kind: b > a === a > 0 ? "up" : "down" };
}
