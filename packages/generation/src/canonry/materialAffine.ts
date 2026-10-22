import { spatial, type Bounds } from "@atlas/domain";
import type { Geometry } from "geojson";

export type MaterialPoint = [number, number];
/** x'=a*x+b*y+tx, y'=c*x+d*y+ty, in world metres. */
export type MaterialAffine = [number, number, number, number, number, number];
export const affinePoint = (f: MaterialAffine, [x, y]: MaterialPoint): MaterialPoint => [
  f[0] * x + f[1] * y + f[4],
  f[2] * x + f[3] * y + f[5],
];
export const determinant = (f: MaterialAffine) => f[0] * f[3] - f[1] * f[2];
export function inverseAffine(f: MaterialAffine): MaterialAffine | null {
  const det = determinant(f);
  if (det === 0) return null;
  const inverse: MaterialAffine = [f[3] / det, -f[1] / det, -f[2] / det, f[0] / det, 0, 0];
  inverse[4] = -inverse[0] * f[4] - inverse[1] * f[5];
  inverse[5] = -inverse[2] * f[4] - inverse[3] * f[5];
  return inverse;
}
export function triangleAffine(source: MaterialPoint[], image: MaterialPoint[]): MaterialAffine {
  const [a, b, c] = source,
    [p, q, r] = image;
  const basis: MaterialAffine = [b[0] - a[0], c[0] - a[0], b[1] - a[1], c[1] - a[1], a[0], a[1]];
  const inverse = inverseAffine(basis)!;
  const dx = [q[0] - p[0], r[0] - p[0]],
    dy = [q[1] - p[1], r[1] - p[1]];
  return [
    dx[0] * inverse[0] + dx[1] * inverse[2],
    dx[0] * inverse[1] + dx[1] * inverse[3],
    dy[0] * inverse[0] + dy[1] * inverse[2],
    dy[0] * inverse[1] + dy[1] * inverse[3],
    p[0] + dx[0] * inverse[4] + dx[1] * inverse[5],
    p[1] + dy[0] * inverse[4] + dy[1] * inverse[5],
  ];
}
export function affineGeometry(geometry: Geometry, f: MaterialAffine): Geometry {
  if (geometry.type === "GeometryCollection")
    return { ...geometry, geometries: geometry.geometries.map((g) => affineGeometry(g, f)) };
  const coordinates = (value: unknown): unknown => {
    const array = value as unknown[];
    return typeof array[0] === "number"
      ? [...affinePoint(f, array as MaterialPoint), ...array.slice(2)]
      : array.map(coordinates);
  };
  return spatial.canonical({
    ...geometry,
    coordinates: coordinates(geometry.coordinates),
  } as Geometry);
}

/** Clip a box by a*x+b*y+c <= 0. Used for inverse cell bounds and equal-density
 * arrival ties, whose inverse-source ordering changes along a straight line. */
export function halfPlane(box: Bounds, a: number, b: number, c: number): Geometry | null {
  const points: MaterialPoint[] = [
    [box[0], box[1]],
    [box[2], box[1]],
    [box[2], box[3]],
    [box[0], box[3]],
  ];
  const output: MaterialPoint[] = [];
  for (let i = 0; i < points.length; i++) {
    const p = points[i],
      q = points[(i + 1) % points.length],
      u = a * p[0] + b * p[1] + c,
      v = a * q[0] + b * q[1] + c;
    if (u <= 0) output.push(p);
    if ((u < 0 && v > 0) || (u > 0 && v < 0)) {
      const t = u / (u - v);
      output.push([p[0] + t * (q[0] - p[0]), p[1] + t * (q[1] - p[1])]);
    }
  }
  return output.length ? spatial.convexHull({ type: "MultiPoint", coordinates: output }) : null;
}
