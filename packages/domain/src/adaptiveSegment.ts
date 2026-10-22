import { adaptiveCell } from "./adaptiveTopology";
import { visitAdaptiveOverlap } from "./adaptiveTransfer";
import { preparedAdaptiveInterpolator, type PreparedAdaptiveCoefficients } from "./adaptivePoint";
import { bernsteinPatchSegment } from "./bernsteinPatch";
import type { Bounds } from "./spatial";
import type { EncloseSegment } from "./sampleSegmentBounds";

type Point = [number, number];
function clip(a: Point, b: Point, box: Bounds) {
  let low = 0,
    high = 1;
  for (const axis of [0, 1]) {
    const d = b[axis] - a[axis];
    if (d === 0) {
      if (a[axis] < box[axis] || a[axis] > box[axis + 2]) return null;
      continue;
    }
    const first = (box[axis] - a[axis]) / d,
      last = (box[axis + 2] - a[axis]) / d;
    low = Math.max(low, Math.min(first, last));
    high = Math.min(high, Math.max(first, last));
  }
  return high > low ? [low, high] : null;
}
export function adaptiveSegmentReader(
  field: PreparedAdaptiveCoefficients,
  positiveSupport = false
): EncloseSegment {
  const read = preparedAdaptiveInterpolator(field, undefined, positiveSupport);
  return (a, b) => {
    if (a[0] === b[0] && a[1] === b[1])
      return { range: [read(...a), read(...a)], derivative: [0, 0] };
    const result = {
      range: [Infinity, -Infinity] as Point,
      derivative: [Infinity, -Infinity] as Point,
    };
    const box: Bounds = [
      Math.min(a[0], b[0]),
      Math.min(a[1], b[1]),
      Math.max(a[0], b[0]),
      Math.max(a[1], b[1]),
    ];
    // The overlap iterator selects areas. Expand only its search envelope so
    // horizontal/vertical segments also visit cells on either side of a face.
    for (const axis of [0, 1])
      if (box[axis] === box[axis + 2]) {
        const epsilon = Math.max(1, Math.abs(box[axis])) * Number.EPSILON * 4;
        box[axis] -= epsilon;
        box[axis + 2] += epsilon;
      }
    visitAdaptiveOverlap(field.topology, box, (i) => {
      const bounds = adaptiveCell(field.topology, i),
        span = clip(a, b, bounds),
        cell = field.cells[i];
      if (!span) return;
      const uv = (t: number): Point =>
        [0, 1].map((axis) =>
          Math.max(
            0,
            Math.min(
              1,
              (a[axis] + (b[axis] - a[axis]) * t - bounds[axis]) / (bounds[axis + 2] - bounds[axis])
            )
          )
        ) as Point;
      const data = bernsteinPatchSegment(cell.bernstein, uv(span[0]), uv(span[1]));
      const raw = positiveSupport && cell.low === 0 && cell.high > 0;
      const limit = (value: number) =>
        raw ? value : Math.max(cell.low, Math.min(cell.high, value));
      const clipped = !raw && (data.range[1] <= cell.low || data.range[0] >= cell.high);
      const crosses = !raw && (data.range[0] < cell.low || data.range[1] > cell.high);
      const derivative: Point = clipped
        ? [0, 0]
        : (data.derivative.map((v) => v / (span[1] - span[0])) as Point);
      if (crosses) {
        derivative[0] = Math.min(0, derivative[0]);
        derivative[1] = Math.max(0, derivative[1]);
      }
      result.range[0] = Math.min(result.range[0], limit(data.range[0]));
      result.range[1] = Math.max(result.range[1], limit(data.range[1]));
      result.derivative[0] = Math.min(result.derivative[0], derivative[0]);
      result.derivative[1] = Math.max(result.derivative[1], derivative[1]);
    });
    return result;
  };
}
