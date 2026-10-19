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

/** The sample correction and its first derivatives vanish on every cell face. */
export function adaptivePolynomial(c: Float64Array, center: number, u: number, v: number) {
  const bubble = 256 * (u * (1 - u) * v * (1 - v)) ** 2;
  return hermitePatch(c, u, v) + bubble * (center - hermitePatch(c, 0.5, 0.5));
}

export function evaluateAdaptiveCell(c: Float64Array, center: number, u: number, v: number) {
  const low = Math.min(center, c[0], c[4], c[8], c[12]);
  const high = Math.max(center, c[0], c[4], c[8], c[12]);
  return Math.max(low, Math.min(high, adaptivePolynomial(c, center, u, v)));
}
