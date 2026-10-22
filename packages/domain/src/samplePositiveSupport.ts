import {
  supportCandidates,
  type SampleCoefficients,
  type SampleEnclosure,
  type SampleSupport,
} from "./smoothSamples";
import { projectedEnclosure } from "./sampleSegmentBounds";
import type { Bounds } from "./spatial";

/** Area closure of f > 0 for nonnegative compact Hermite jets. Each positive
 * jet is strictly positive inside its support disk. Cardinal zero stations are
 * punctures smaller than the contour's geometric tolerance. Corner clamping
 * can extend zeros into areas; explicit half-plane predicates retain those.
 * This describes the existing basis; it does not interpolate membership labels.
 */
export function samplePositiveSupport(
  support: SampleSupport,
  values: ArrayLike<number>,
  coefficients: SampleCoefficients
) {
  const radius = support.spacing * 2.5,
    radius2 = radius * radius;
  for (let i = 0; i < values.length; i++) {
    if (
      !Number.isFinite(values[i]) ||
      !Number.isFinite(coefficients.dx[i]) ||
      !Number.isFinite(coefficients.dy[i]) ||
      values[i] < 0 ||
      Math.hypot(coefficients.dx[i], coefficients.dy[i]) * radius > values[i]
    )
      return null;
  }
  const extent: Bounds = [Infinity, Infinity, -Infinity, -Infinity];
  for (let i = 0; i < values.length; i++) {
    extent[0] = Math.min(extent[0], support.x[i] + support.origin[0]);
    extent[1] = Math.min(extent[1], support.y[i] + support.origin[1]);
    extent[2] = Math.max(extent[2], support.x[i] + support.origin[0]);
    extent[3] = Math.max(extent[3], support.y[i] + support.origin[1]);
  }
  const corners: { x: number; y: number; sx: number; sy: number }[] = [];
  for (let i = 0; i < values.length; i++) {
    const x = support.x[i] + support.origin[0],
      y = support.y[i] + support.origin[1];
    if (
      values[i] === 0 &&
      (x === extent[0] || x === extent[2]) &&
      (y === extent[1] || y === extent[3])
    )
      corners.push({ x, y, sx: x === extent[0] ? 1 : -1, sy: y === extent[1] ? 1 : -1 });
  }
  const clamp = (v: number, axis: number) => Math.max(extent[axis], Math.min(extent[axis + 2], v));
  const enclose = (box: Bounds): SampleEnclosure => {
    const b: Bounds = [clamp(box[0], 0), clamp(box[1], 1), clamp(box[2], 0), clamp(box[3], 1)];
    const terms = supportCandidates(support, b, Math.SQRT2 * radius)
      .filter((i) => values[i] > 0)
      .map((i) => {
        const dx = [
          b[0] - support.origin[0] - support.x[i],
          b[2] - support.origin[0] - support.x[i],
        ];
        const dy = [
          b[1] - support.origin[1] - support.y[i],
          b[3] - support.origin[1] - support.y[i],
        ];
        const near = Math.max(0, dx[0], -dx[1]) ** 2 + Math.max(0, dy[0], -dy[1]) ** 2;
        const far = Math.max(dx[0] ** 2, dx[1] ** 2) + Math.max(dy[0] ** 2, dy[1] ** 2);
        return { low: radius2 - far, high: radius2 - near, dx, dy };
      });
    const low = Math.max(-radius2, ...terms.map((t) => t.low));
    const high = Math.max(0, ...terms.map((t) => t.high));
    const active = terms.filter((t) => t.high >= low);
    const gradient = (axis: number): [number, number] => {
      const spans = active.map((t) => (axis ? t.dy : t.dx));
      const zero = low <= -radius2 || box[axis] < extent[axis] || box[axis + 2] > extent[axis + 2];
      return [
        Math.min(zero ? 0 : Infinity, ...spans.map((v) => -2 * v[1])),
        Math.max(zero ? 0 : -Infinity, ...spans.map((v) => -2 * v[0])),
      ];
    };
    return intersectEnclosures([
      { range: [low, high], gradient: [gradient(0), gradient(1)] },
      ...corners.map((corner) => cornerEnclosure(box, corner, radius)),
    ]);
  };
  const at = (x: number, y: number) => {
    const px = clamp(x, 0),
      py = clamp(y, 1);
    let value = -radius2;
    for (const i of supportCandidates(support, [px, py, px, py], Math.SQRT2 * radius)) {
      if (values[i] <= 0) continue;
      const dx = px - support.origin[0] - support.x[i],
        dy = py - support.origin[1] - support.y[i];
      value = Math.max(value, radius2 - dx * dx - dy * dy);
    }
    for (const corner of corners)
      value = Math.min(
        value,
        Math.max((x - corner.x) * corner.sx * radius, (y - corner.y) * corner.sy * radius)
      );
    return value;
  };
  return Object.assign(at, {
    enclose,
    segment: (a: [number, number], b: [number, number]) =>
      projectedEnclosure(
        enclose([
          Math.min(a[0], b[0]),
          Math.min(a[1], b[1]),
          Math.max(a[0], b[0]),
          Math.max(a[1], b[1]),
        ]),
        a,
        b
      ),
  });
}

function cornerEnclosure(
  box: Bounds,
  corner: { x: number; y: number; sx: number; sy: number },
  scale: number
): SampleEnclosure {
  const { x, y } = corner,
    sx = corner.sx * scale,
    sy = corner.sy * scale;
  const xs = [(box[0] - x) * sx, (box[2] - x) * sx],
    ys = [(box[1] - y) * sy, (box[3] - y) * sy];
  const xl = Math.min(...xs),
    xh = Math.max(...xs),
    yl = Math.min(...ys),
    yh = Math.max(...ys);
  const gx = xh < yl ? [0] : xl > yh ? [sx] : [0, sx];
  const gy = yh < xl ? [0] : yl > xh ? [sy] : [0, sy];
  return {
    range: [Math.max(xl, yl), Math.max(xh, yh)],
    gradient: [
      [Math.min(...gx), Math.max(...gx)],
      [Math.min(...gy), Math.max(...gy)],
    ],
  };
}
function intersectEnclosures(terms: SampleEnclosure[]): SampleEnclosure {
  const high = Math.min(...terms.map((term) => term.range[1]));
  const active = terms.filter((term) => term.range[0] <= high);
  const gradient = (axis: number): [number, number] => [
    Math.min(...active.map((term) => term.gradient[axis][0])),
    Math.max(...active.map((term) => term.gradient[axis][1])),
  ];
  return {
    range: [Math.min(...terms.map((term) => term.range[0])), high],
    gradient: [gradient(0), gradient(1)],
  };
}
