import { geometryParts, spatial } from "@atlas/domain";
import type { Geometry, Point, Polygon } from "geojson";
import { affinePoint, halfPlane, type MaterialAffine, type MaterialPoint } from "./materialAffine";

export function geometryPoints(geometry: Geometry): MaterialPoint[] {
  if (geometry.type === "GeometryCollection") return geometry.geometries.flatMap(geometryPoints);
  const visit = (value: unknown): MaterialPoint[] => {
    const array = value as unknown[];
    return typeof array[0] === "number" ? [[array[0], array[1] as number]] : array.flatMap(visit);
  };
  return visit(geometry.coordinates);
}
const compare = (a: MaterialPoint, b: MaterialPoint) => a[0] - b[0] || a[1] - b[1];
function segment(points: MaterialPoint[]): Geometry {
  points.sort(compare);
  const precise = (p: MaterialPoint) =>
    (spatial.canonical({ type: "Point", coordinates: p }) as Point).coordinates;
  const a = precise(points[0]),
    b = precise(points.at(-1)!);
  return a[0] === b[0] && a[1] === b[1]
    ? { type: "Point", coordinates: a }
    : { type: "LineString", coordinates: [a, b] };
}
/** A connected source component has a connected image under a rank-zero/one
 * affine map. Preserve those points/segments instead of dropping source mass. */
export function collapsedGeometry(source: Geometry, forward: MaterialAffine): Geometry {
  const images = geometryParts(source).map((part) =>
    segment(geometryPoints(part).map((p) => affinePoint(forward, p)))
  );
  return images.length === 1 ? images[0] : spatial.unionAll(images);
}
/** Pull each convex target-cell half-plane through the affine map. This also
 * integrates a collapsed source area, for which image-area division is undefined. */
export function sourceInsideCell(
  source: Geometry,
  forward: MaterialAffine,
  target: Polygon
): Geometry | null {
  const ring = target.coordinates[0],
    origin = ring[0];
  let signed = 0;
  for (let i = 1; i < ring.length; i++)
    signed +=
      (ring[i - 1][0] - origin[0]) * (ring[i][1] - origin[1]) -
      (ring[i][0] - origin[0]) * (ring[i - 1][1] - origin[1]);
  const sign = Math.sign(signed),
    bounds = spatial.bounds(source);
  let result: Geometry | null = source;
  for (let i = 1; i < ring.length && result; i++) {
    const p = ring[i - 1],
      q = ring[i],
      x = (q[1] - p[1]) * sign,
      y = -(q[0] - p[0]) * sign;
    const mask = halfPlane(
      bounds,
      x * forward[0] + y * forward[2],
      x * forward[1] + y * forward[3],
      x * (forward[4] - p[0]) + y * (forward[5] - p[1])
    );
    result = mask ? spatial.intersection(result, mask) : null;
  }
  return result;
}
