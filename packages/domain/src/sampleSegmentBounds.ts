import type { SampleSupport, SampleEnclosure } from "./smoothSamples";
import { weightEnclosure, weightedDerivative } from "./smoothSampleBounds";
import type { Bounds } from "./spatial";
type Point = [number, number];
export interface SegmentEnclosure {
  range: [number, number];
  derivative: [number, number];
}
export type EncloseSegment = (a: Point, b: Point) => SegmentEnclosure;
export function createSegmentReader(
  support: SampleSupport,
  values: ArrayLike<number>,
  jet: (i: number) => Point,
  read: (x: number, y: number) => number,
  enclose: (box: Bounds, candidates?: number[], level?: number) => SampleEnclosure,
  extent: Bounds,
  candidates: (box: Bounds) => number[]
) {
  return (a: Point, b: Point, level?: number) => {
    const box: Bounds = [
      Math.min(a[0], b[0]),
      Math.min(a[1], b[1]),
      Math.max(a[0], b[0]),
      Math.max(a[1], b[1]),
    ];
    if (box[0] < extent[0] || box[1] < extent[1] || box[2] > extent[2] || box[3] > extent[3])
      return projectedEnclosure(enclose(box, undefined, level), a, b);
    return sampleSegmentBounds(support, values, jet, read, a, b, candidates(box), level);
  };
}

/** Project a box enclosure when clamping bends the query path at support edges. */
export function projectedEnclosure(data: SampleEnclosure, a: Point, b: Point): SegmentEnclosure {
  const project = (d: number, [low, high]: Point): Point =>
    d === 0 ? [0, 0] : [Math.min(d * low, d * high), Math.max(d * low, d * high)];
  const x = project(b[0] - a[0], data.gradient[0]),
    y = project(b[1] - a[1], data.gradient[1]);
  return { range: data.range, derivative: [x[0] + y[0], x[1] + y[1]] };
}

/** Bound the same weighted jets along p(t)=a+t(b-a), t in[0,1]. */
export function sampleSegmentBounds(
  support: SampleSupport,
  values: ArrayLike<number>,
  jet: (i: number) => Point,
  read: (x: number, y: number) => number,
  a: Point,
  b: Point,
  candidates: number[],
  level?: number
): SegmentEnclosure {
  const ex = b[0] - a[0],
    ey = b[1] - a[1],
    length2 = ex * ex + ey * ey,
    radius2 = (support.spacing * 2.5) ** 2;
  const weight = (s: number) =>
    s >= radius2 ? 0 : s === 0 ? Infinity : (1 - s / radius2) ** 4 / s;
  const terms = candidates.flatMap((i) => {
    const dx = a[0] - support.origin[0] - support.x[i],
      dy = a[1] - support.origin[1] - support.y[i],
      dot = dx * ex + dy * ey,
      t = length2 ? Math.max(0, Math.min(1, -dot / length2)) : 0,
      near = (dx + t * ex) ** 2 + (dy + t * ey) ** 2;
    if (near >= radius2) return [];
    const far = Math.max(dx * dx + dy * dy, (dx + ex) ** 2 + (dy + ey) ** 2),
      [gx, gy] = jet(i),
      first = values[i] + gx * dx + gy * dy,
      last = values[i] + gx * (dx + ex) + gy * (dy + ey);
    return [
      {
        low: Math.min(first, last),
        high: Math.max(first, last),
        weightLow: weight(far),
        weightHigh: weight(near),
        near,
        far,
        projection: [Math.min(dot, dot + length2), Math.max(dot, dot + length2)] as Point,
        slope: gx * ex + gy * ey,
      },
    ];
  });
  const hull: Point = [Math.min(...terms.map((t) => t.low)), Math.max(...terms.map((t) => t.high))];
  const unknown: Point = [-Infinity, Infinity];
  if (!terms.length) return { range: [NaN, NaN], derivative: unknown };
  if (level !== undefined && (hull[0] > level || hull[1] <= level))
    return { range: hull, derivative: unknown };
  const center = read((a[0] + b[0]) / 2, (a[1] + b[1]) / 2),
    range = weightEnclosure(terms, center);
  if (terms.some((t) => !Number.isFinite(t.weightHigh)) || !terms.some((t) => t.weightLow > 0))
    return { range, derivative: unknown };
  const derivative = weightedDerivative(
      terms,
      range,
      radius2,
      (t) => t.projection,
      (t) => t.slope
    ),
    variation = Math.max(Math.abs(derivative[0]), Math.abs(derivative[1])) / 2;
  return {
    range: [
      Math.min(center, Math.max(range[0], center - variation)),
      Math.max(center, Math.min(range[1], center + variation)),
    ],
    derivative,
  };
}
