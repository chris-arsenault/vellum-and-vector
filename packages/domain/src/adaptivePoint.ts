import { adaptiveCell, adaptiveLeafAt, type AdaptiveTopology } from "./adaptiveTopology";
import {
  evaluatePreparedAdaptiveCell,
  prepareAdaptiveCell,
  hermitePatch,
  type PreparedAdaptiveCell,
} from "./adaptiveHermite";
import { adaptivePatchGeometry, type AdaptiveVertex } from "./adaptivePatchGeometry";
import { ByteCache } from "./byteCache";

const adaptiveChannelCacheBytes = 256 * 1024;

import {
  adaptiveFits,
  adaptiveSample as read,
  type AdaptiveSamples as Samples,
} from "./adaptiveFit";
type Fits = ReturnType<typeof adaptiveFits>;
function corner(
  t: AdaptiveTopology,
  values: Samples,
  vertex: AdaptiveVertex,
  fit: Fits,
  baseValue: (x: number, y: number, epsilon: number) => number
): number {
  const { cells, x, y, coarse } = vertex;
  if (coarse !== undefined) return constrainedCorner(t, coarse, vertex, fit, baseValue);
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
  i: number,
  vertex: AdaptiveVertex,
  fit: Fits,
  baseValue: (x: number, y: number, epsilon: number) => number
) {
  const { x, y, epsilon } = vertex;
  const b = adaptiveCell(t, i),
    vertical = x === b[0] || x === b[2];
  const a = baseValue(vertical ? x : b[0], vertical ? b[1] : y, epsilon);
  const z = baseValue(vertical ? x : b[2], vertical ? b[3] : y, epsilon);
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
  const coefficients = new ByteCache<number, PreparedAdaptiveCell>(adaptiveChannelCacheBytes);
  const fit = adaptiveFits(t, values),
    geometry = adaptivePatchGeometry(t);
  const vertices = new ByteCache<number, number[]>(adaptiveChannelCacheBytes),
    baseValues = new ByteCache<number, number>(adaptiveChannelCacheBytes);
  const baseValue = (x: number, y: number, epsilon: number) => {
    const vertex = geometry.vertex(x, y, epsilon);
    const previous = baseValues.get(vertex.id);
    if (previous !== undefined) return previous;
    const result = corner(t, values, vertex, fit, baseValue);
    baseValues.set(vertex.id, result, 80);
    return result;
  };
  const vertex = (point: AdaptiveVertex): number[] => {
    const { id, cells, x, y, epsilon, hanging } = point;
    const previous = vertices.get(id);
    if (previous) return previous;
    let result: number[];
    if (hanging !== undefined) {
      const box = adaptiveCell(t, hanging),
        c = patch(hanging).coefficients;
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
    vertices.set(id, result, 112);
    return result;
  };
  const patch = (i: number): PreparedAdaptiveCell => {
    const previous = coefficients.get(i);
    if (previous) return previous;
    const { width, height, corners } = geometry.cell(i);
    const c = Float64Array.from(
      corners.flatMap((point) => {
        const v = vertex(point);
        return [v[0], v[1] * width, v[2] * height, v[3] * width * height];
      })
    );
    const result = prepareAdaptiveCell(c, read(values, i));
    coefficients.set(i, result, 320);
    return result;
  };
  return patch;
}
/** A prepared immutable evaluator computes only cells touched by a query or viewport. */
export function adaptivePointSampler(
  t: AdaptiveTopology,
  values: Samples,
  locate: AdaptivePointLocator = locateAdaptivePoint,
  patch = prepareAdaptivePatches(t, values)
) {
  return (x: number, y: number) => {
    const { leaf, u, v } = locate(t, x, y);
    return leaf < 0 ? NaN : evaluatePreparedAdaptiveCell(patch(leaf), u, v);
  };
}

function locateAdaptivePoint(t: AdaptiveTopology, x: number, y: number) {
  const leaf = adaptiveLeafAt(t, x, y);
  if (leaf < 0) return { leaf, u: NaN, v: NaN };
  const at = t.leaves[leaf] * 4,
    b = t.boxes;
  return {
    leaf,
    u: (x - b[at]) / (b[at + 2] - b[at]),
    v: (y - b[at + 1]) / (b[at + 3] - b[at + 1]),
  };
}
export type AdaptivePointLocator = typeof locateAdaptivePoint;
/** Share only the current point's location across channels using the same topology. */
export function adaptivePointLocator(): AdaptivePointLocator {
  let x = NaN,
    y = NaN;
  const locations = new Map<AdaptiveTopology, ReturnType<AdaptivePointLocator>>();
  return (t, px, py) => {
    if (px !== x || py !== y) {
      locations.clear();
      x = px;
      y = py;
    }
    if (!locations.has(t)) locations.set(t, locateAdaptivePoint(t, px, py));
    return locations.get(t)!;
  };
}
export function sampleAdaptivePoint(t: AdaptiveTopology, values: Samples, x: number, y: number) {
  return adaptivePointSampler(t, values)(x, y);
}
