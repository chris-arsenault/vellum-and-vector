import { DomainError, geometryParts, spatial } from "@atlas/domain";
import type { Geometry, Point } from "geojson";
import {
  affineGeometry,
  affinePoint,
  determinant,
  type MaterialAffine,
  type MaterialPoint,
} from "./materialAffine";
import { collapsedGeometry, geometryPoints } from "./materialCollapse";

/** Retain lower-dimensional geographic images at the declared GIS precision.
 * Conservative integration uses the original affine preimage and source area.
 */
export function materialImage(source: Geometry, forward: MaterialAffine): Geometry {
  if (determinant(forward) === 0) return collapsedGeometry(source, forward);
  try {
    return affineGeometry(source, forward);
  } catch (error) {
    if (!(error instanceof DomainError) || error.code !== "precision_collapse") throw error;
  }
  return boundaryImage(source, forward);
}
function boundaryImage(source: Geometry, forward: MaterialAffine) {
  const edges: Geometry[] = [];
  for (const part of geometryParts(source)) {
    const rings = part.type === "Polygon" ? part.coordinates : [geometryPoints(part)];
    for (const ring of rings) {
      const points = ring.map(
        (p) =>
          (
            spatial.canonical({
              type: "Point",
              coordinates: affinePoint(forward, p as MaterialPoint),
            }) as Point
          ).coordinates
      );
      for (let i = 1; i < points.length; i++) {
        const a = points[i - 1],
          b = points[i];
        edges.push(
          a[0] === b[0] && a[1] === b[1]
            ? { type: "Point", coordinates: a }
            : { type: "LineString", coordinates: [a, b] }
        );
      }
    }
  }
  return spatial.unionAll(edges);
}
