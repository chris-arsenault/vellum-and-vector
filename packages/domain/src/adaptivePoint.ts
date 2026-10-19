import { adaptiveCell, adaptiveLeafAt, type AdaptiveTopology } from "./adaptiveTopology";
import { evaluateAdaptiveCell, hermitePatch } from "./adaptiveHermite";

import {
  adaptiveFits,
  adaptiveSample as read,
  type AdaptiveSamples as Samples,
} from "./adaptiveFit";
type Fits = ReturnType<typeof adaptiveFits>;
function incident(t: AdaptiveTopology, x: number, y: number, epsilon: number) {
  const leaves = new Set<number>();
  for (const dx of [-epsilon, epsilon])
    for (const dy of [-epsilon, epsilon]) {
      const leaf = adaptiveLeafAt(t, x + dx, y + dy);
      if (leaf >= 0) leaves.add(leaf);
    }
  return [...leaves];
}
function corner(
  t: AdaptiveTopology,
  values: Samples,
  x: number,
  y: number,
  epsilon: number,
  fit: Fits
): number {
  const cells = incident(t, x, y, epsilon);
  const hanging = cells
    .filter((i) => {
      const b = adaptiveCell(t, i);
      return (x > b[0] && x < b[2]) || (y > b[1] && y < b[3]);
    })
    .sort((a, b) => t.levels[t.leaves[a]] - t.levels[t.leaves[b]]);
  if (hanging.length) return constrainedCorner(t, values, hanging[0], x, y, epsilon, fit);
  let sum = 0,
    weight = 0;
  for (const i of cells) {
    const b = adaptiveCell(t, i),
      g = fit(i);
    const w = 1 / ((b[2] - b[0]) * (b[3] - b[1]));
    const dx = x - (b[0] + b[2]) / 2,
      dy = y - (b[1] + b[3]) / 2;
    sum +=
      w *
      (read(values, i) + g[0] * dx + g[1] * dy + g[2] * dx * dx + g[3] * dx * dy + g[4] * dy * dy);
    weight += w;
  }
  const value = sum / weight;
  if (x <= t.bounds[0] || x >= t.bounds[2] || y <= t.bounds[1] || y >= t.bounds[3]) return value;
  const samples = cells.map((i) => read(values, i));
  return Math.max(Math.min(...samples), Math.min(Math.max(...samples), value));
}
function constrainedCorner(
  t: AdaptiveTopology,
  values: Samples,
  i: number,
  x: number,
  y: number,
  epsilon: number,
  fit: Fits
) {
  const b = adaptiveCell(t, i),
    vertical = x === b[0] || x === b[2];
  const a = corner(t, values, vertical ? x : b[0], vertical ? b[1] : y, epsilon, fit);
  const z = corner(t, values, vertical ? x : b[2], vertical ? b[3] : y, epsilon, fit);
  const fraction = vertical ? (y - b[1]) / (b[3] - b[1]) : (x - b[0]) / (b[2] - b[0]);
  const length = vertical ? b[3] - b[1] : b[2] - b[0];
  return (
    a + (z - a) * fraction - fit(i)[vertical ? 4 : 2] * length * length * fraction * (1 - fraction)
  );
}

function unconstrainedVertex(
  t: AdaptiveTopology,
  values: Samples,
  cells: number[],
  point: { x: number; y: number; epsilon: number },
  baseValue: (x: number, y: number, epsilon: number) => number,
  fit: Fits
) {
  const { x, y, epsilon } = point;
  const result = [baseValue(x, y, epsilon), 0, 0, 0];
  let weight = 0;
  for (const i of cells) {
    const b = adaptiveCell(t, i),
      w = 1 / ((b[2] - b[0]) * (b[3] - b[1]));
    const g = fit(i),
      dx = x - (b[0] + b[2]) / 2,
      dy = y - (b[1] + b[3]) / 2;
    result[1] += w * (g[0] + 2 * g[2] * dx + g[3] * dy);
    result[2] += w * (g[1] + g[3] * dx + 2 * g[4] * dy);
    result[3] += w * g[3];
    weight += w;
  }
  result[1] /= weight;
  result[2] /= weight;
  result[3] /= weight;
  // Shared endpoint slope limits keep monotone face curves within their data.
  for (const i of cells) {
    const b = adaptiveCell(t, i);
    for (const [a, z, axis] of [
      [x === b[0] ? b[2] : b[0], y, 1],
      [x, y === b[1] ? b[3] : b[1], 2],
    ]) {
      const distance = axis === 1 ? a - x : z - y;
      const secant = (baseValue(a, z, epsilon) - result[0]) / distance;
      result[axis] =
        result[axis] * secant <= 0
          ? 0
          : Math.sign(secant) * Math.min(Math.abs(result[axis]), 3 * Math.abs(secant));
    }
  }
  return result;
}
/** Shared vertex values and derivatives also constrain fine faces to their coarse patch. */
export function prepareAdaptivePatches(t: AdaptiveTopology, values: Samples) {
  const coefficients = new Map<number, Float64Array>();
  const fit = adaptiveFits(t, values);
  const vertices = new Map<string, number[]>(),
    baseValues = new Map<string, number>();
  const baseValue = (x: number, y: number, epsilon: number) => {
    const key = `${x}:${y}`;
    if (!baseValues.has(key)) baseValues.set(key, corner(t, values, x, y, epsilon, fit));
    return baseValues.get(key)!;
  };
  const vertex = (x: number, y: number, epsilon: number): number[] => {
    const key = `${x}:${y}`;
    if (vertices.has(key)) return vertices.get(key)!;
    const cells = incident(t, x, y, epsilon);
    const hanging = cells.find((i) => {
      const b = adaptiveCell(t, i);
      return (x > b[0] && x < b[2]) || (y > b[1] && y < b[3]);
    });
    let result: number[];
    if (hanging !== undefined) {
      const box = adaptiveCell(t, hanging),
        c = patch(hanging);
      const width = box[2] - box[0],
        height = box[3] - box[1];
      const u = (x - box[0]) / width,
        v = (y - box[1]) / height;
      result = [
        hermitePatch(c, u, v),
        hermitePatch(c, u, v, true) / width,
        hermitePatch(c, u, v, false, true) / height,
        hermitePatch(c, u, v, true, true) / (width * height),
      ];
    } else {
      result = unconstrainedVertex(t, values, cells, { x, y, epsilon }, baseValue, fit);
    }
    vertices.set(key, result);
    return result;
  };
  const patch = (i: number): Float64Array => {
    const previous = coefficients.get(i);
    if (previous) return previous;
    const [x0, y0, x1, y1] = adaptiveCell(t, i),
      width = x1 - x0,
      height = y1 - y0;
    const epsilon = Math.min(width, height) * 1e-6;
    const c = Float64Array.from(
      [
        [x0, y0],
        [x1, y0],
        [x0, y1],
        [x1, y1],
      ].flatMap(([x, y]) => {
        const v = vertex(x, y, epsilon);
        return [v[0], v[1] * width, v[2] * height, v[3] * width * height];
      })
    );
    coefficients.set(i, c);
    return c;
  };
  return patch;
}
/** A prepared immutable evaluator computes only cells touched by a query or viewport. */
export function adaptivePointSampler(t: AdaptiveTopology, values: Samples) {
  const patch = prepareAdaptivePatches(t, values);
  return (x: number, y: number) => {
    const i = adaptiveLeafAt(t, x, y);
    if (i < 0) return NaN;
    const [x0, y0, x1, y1] = adaptiveCell(t, i);
    return evaluateAdaptiveCell(
      patch(i),
      read(values, i),
      (x - x0) / (x1 - x0),
      (y - y0) / (y1 - y0)
    );
  };
}
export function sampleAdaptivePoint(t: AdaptiveTopology, values: Samples, x: number, y: number) {
  return adaptivePointSampler(t, values)(x, y);
}
