import type { SampleEnclosure } from "./smoothSamples";
type Interval = [number, number];
export interface WeightedJet {
  low: number;
  high: number;
  weightLow: number;
  weightHigh: number;
  near: number;
  far: number;
}
interface Term extends WeightedJet {
  dx: Interval;
  dy: Interval;
  gx: number;
  gy: number;
}
export function weightEnclosure(
  terms: Pick<WeightedJet, "low" | "high" | "weightLow" | "weightHigh">[],
  reference = (terms[0].low + terms[0].high) / 2
): Interval {
  const prefix = new Float64Array(2 * (terms.length + 1)),
    suffix = new Float64Array(prefix.length);
  // Exclude a term without subtracting its potentially dominant weight from
  // the total: that subtraction can erase every other source contribution.
  for (let i = 0; i < terms.length; i++) {
    prefix[2 * i + 2] = prefix[2 * i] + terms[i].weightLow;
    prefix[2 * i + 3] = prefix[2 * i + 1] + terms[i].weightHigh;
    const j = terms.length - i - 1;
    suffix[2 * j] = suffix[2 * j + 2] + terms[j].weightLow;
    suffix[2 * j + 1] = suffix[2 * j + 3] + terms[j].weightHigh;
  }
  let low = reference,
    high = reference,
    minimum = Infinity,
    maximum = -Infinity;
  for (const [i, term] of terms.entries()) {
    const otherLow = prefix[2 * i] + suffix[2 * i + 2],
      otherHigh = prefix[2 * i + 1] + suffix[2 * i + 3];
    const a =
        term.weightLow === Infinity
          ? 1
          : term.weightLow === 0
            ? 0
            : term.weightLow / (term.weightLow + otherHigh),
      b = term.weightHigh === Infinity ? 1 : term.weightHigh / (term.weightHigh + otherLow);
    low += Math.min(a * (term.low - reference), b * (term.low - reference));
    high += Math.max(a * (term.high - reference), b * (term.high - reference));
    minimum = Math.min(minimum, term.low);
    maximum = Math.max(maximum, term.high);
  }
  return [Math.max(low, minimum), Math.min(high, maximum)];
}
function multiply(a: Interval, b: Interval): Interval {
  const values = [a[0] * b[0], a[0] * b[1], a[1] * b[0], a[1] * b[1]];
  return [Math.min(...values), Math.max(...values)];
}
// d/dr² of (1-r²/R²)^4/r² is negative and increases to zero on its support.
function weightDerivative(r2: number, radius2: number) {
  if (r2 >= radius2) return 0;
  return (-((1 - r2 / radius2) ** 3) * (1 + (3 * r2) / radius2)) / (r2 * r2);
}
export function weightedDerivative<T extends WeightedJet>(
  terms: T[],
  range: Interval,
  radius2: number,
  coordinate: (term: T) => Interval,
  slope: (term: T) => number
): Interval {
  let low = 0,
    high = 0,
    denominatorLow = 0,
    denominatorHigh = 0;
  for (const t of terms) {
    const dw = multiply(
        [2 * weightDerivative(t.near, radius2), 2 * weightDerivative(t.far, radius2)],
        coordinate(t)
      ),
      residual = multiply(dw, [t.low - range[1], t.high - range[0]]),
      g = slope(t),
      jet = multiply([t.weightLow, t.weightHigh], [g, g]);
    low += residual[0] + jet[0];
    high += residual[1] + jet[1];
    denominatorLow += t.weightLow;
    denominatorHigh += t.weightHigh;
  }
  return multiply([low, high], [1 / denominatorHigh, 1 / denominatorLow]);
}
/** Mean-value enclosure converges quadratically near a stationary extremum. */
export function derivativeEnclosure(
  terms: Term[],
  range: Interval,
  radius2: number,
  center: number,
  halfSize: Interval
): SampleEnclosure {
  if (terms.every((t) => t.low === range[0] && t.high === range[0] && t.gx === 0 && t.gy === 0))
    return {
      range,
      gradient: [
        [0, 0],
        [0, 0],
      ],
    };
  if (terms.some((t) => !Number.isFinite(t.weightHigh)) || !terms.some((t) => t.weightLow > 0))
    return (
      cardinalEnclosure(terms, range, radius2) ?? {
        range,
        gradient: [
          [-Infinity, Infinity],
          [-Infinity, Infinity],
        ],
      }
    );
  const gx = weightedDerivative(
      terms,
      range,
      radius2,
      (t) => t.dx,
      (t) => t.gx
    ),
    gy = weightedDerivative(
      terms,
      range,
      radius2,
      (t) => t.dy,
      (t) => t.gy
    );
  const variation =
    Math.max(Math.abs(gx[0]), Math.abs(gx[1])) * halfSize[0] +
    Math.max(Math.abs(gy[0]), Math.abs(gy[1])) * halfSize[1];
  return {
    // Include the evaluated midpoint when interval arithmetic rounds inward.
    range: [
      Math.min(center, Math.max(range[0], center - variation)),
      Math.max(center, Math.min(range[1], center + variation)),
    ],
    gradient: [gx, gy],
  };
}

/** Divide the cardinal rational basis by its singular anchor weight. The
 * resulting ratios and their derivatives remain finite, including at the node. */
function cardinalEnclosure(
  terms: Term[],
  range: Interval,
  radius2: number
): SampleEnclosure | null {
  const anchor = terms.reduce((a, b) => (a.far < b.far ? a : b));
  if (anchor.far >= radius2 || terms.some((t) => t !== anchor && t.near === 0)) return null;
  const inverse = (s: number) => s / (1 - s / radius2) ** 4;
  const inverseDerivative = (s: number) => (1 + (3 * s) / radius2) / (1 - s / radius2) ** 5;
  const reciprocal: Interval = [inverse(anchor.near), inverse(anchor.far)];
  const reciprocalSlope: Interval = [
    2 * inverseDerivative(anchor.near),
    2 * inverseDerivative(anchor.far),
  ];
  const ratios = terms.map((t) =>
    t === anchor ? ([1, 1] as Interval) : multiply([t.weightLow, t.weightHigh], reciprocal)
  );
  const denominator: Interval = [
    ratios.reduce((s, r) => s + r[0], 0),
    ratios.reduce((s, r) => s + r[1], 0),
  ];
  const gradient = (axis: "dx" | "dy", slope: "gx" | "gy"): Interval => {
    const dr = multiply(reciprocalSlope, anchor[axis]);
    let low = 0,
      high = 0;
    terms.forEach((t, i) => {
      const jet = multiply(ratios[i], [t[slope], t[slope]]);
      let contribution: Interval = [0, 0];
      if (t !== anchor) {
        const dw = multiply(
          [2 * weightDerivative(t.near, radius2), 2 * weightDerivative(t.far, radius2)],
          t[axis]
        );
        const a = multiply(dw, reciprocal),
          b = multiply([t.weightLow, t.weightHigh], dr);
        contribution = multiply([a[0] + b[0], a[1] + b[1]], [t.low - range[1], t.high - range[0]]);
      }
      low += jet[0] + contribution[0];
      high += jet[1] + contribution[1];
    });
    return multiply([low, high], [1 / denominator[1], 1 / denominator[0]]);
  };
  return { range, gradient: [gradient("dx", "gx"), gradient("dy", "gy")] };
}
