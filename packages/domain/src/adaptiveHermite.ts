import {
  prepareBernsteinPatch,
  bernsteinPatchValue,
  bernsteinPatchInterval,
} from "./bernsteinPatch";
// Tensor-product cubic Hermite data: value, du, dv and mixed derivative duv at each corner.
const basis = (t: number) => [
  2 * t ** 3 - 3 * t * t + 1,
  -2 * t ** 3 + 3 * t * t,
  t ** 3 - 2 * t * t + t,
  t ** 3 - t * t,
];
const derivative = (t: number) => [
  6 * t * t - 6 * t,
  -6 * t * t + 6 * t,
  3 * t * t - 4 * t + 1,
  3 * t * t - 2 * t,
];

export function hermitePatch(c: Float64Array, u: number, v: number, du = false, dv = false) {
  const x = du ? derivative(u) : basis(u),
    y = dv ? derivative(v) : basis(v);
  let value = 0;
  for (let corner = 0; corner < 4; corner++) {
    const i = corner % 2,
      j = corner >> 1,
      at = corner * 4;
    value +=
      c[at] * x[i] * y[j] +
      c[at + 1] * x[i + 2] * y[j] +
      c[at + 2] * x[i] * y[j + 2] +
      c[at + 3] * x[i + 2] * y[j + 2];
  }
  return value;
}

/** Samples control the shared spline without adding a separate hump inside each cell. */
export function adaptivePolynomial(c: Float64Array, _center: number, u: number, v: number) {
  return hermitePatch(c, u, v);
}

export function evaluateAdaptiveCell(c: Float64Array, center: number, u: number, v: number) {
  return evaluatePreparedAdaptiveCell(prepareAdaptiveCell(c, center), u, v);
}

export function prepareAdaptiveCell(coefficients: Float64Array, center: number) {
  const correction = 0;
  return {
    coefficients,
    correction,
    bernstein: prepareBernsteinPatch(coefficients, correction),
    low: Math.min(center, coefficients[0], coefficients[4], coefficients[8], coefficients[12]),
    high: Math.max(center, coefficients[0], coefficients[4], coefficients[8], coefficients[12]),
  };
}
export type PreparedAdaptiveCell = ReturnType<typeof prepareAdaptiveCell>;

export function preparedAdaptivePolynomial(cell: PreparedAdaptiveCell, u: number, v: number) {
  return bernsteinPatchValue(cell.bernstein, u, v);
}
export function preparedAdaptiveDerivative(
  cell: PreparedAdaptiveCell,
  u: number,
  v: number,
  axis: 0 | 1
) {
  return bernsteinPatchInterval(cell.bernstein, [u, v, u, v], axis)[0];
}
export function evaluatePreparedAdaptiveCell(
  cell: PreparedAdaptiveCell,
  u: number,
  v: number,
  positiveSupport = false
) {
  if (cell.low === cell.high) return cell.low;
  if (positiveSupport && cell.low === 0) return preparedAdaptivePolynomial(cell, u, v);
  return Math.max(cell.low, Math.min(cell.high, preparedAdaptivePolynomial(cell, u, v)));
}
