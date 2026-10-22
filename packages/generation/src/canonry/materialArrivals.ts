import { geometryParts, spatial } from "@atlas/domain";
import type { Geometry, Point } from "geojson";
import { affinePoint, type MaterialAffine, type MaterialPoint } from "./materialAffine";
import { geometryPoints } from "./materialCollapse";
import type { MotionPiece } from "./motionPieces";

export interface MaterialArrival extends MotionPiece {
  inverse: MaterialAffine;
}

function edgeArrival(piece: MotionPiece, a: MaterialPoint, b: MaterialPoint): MaterialArrival {
  const precise = (p: MaterialPoint) =>
    (spatial.canonical({ type: "Point", coordinates: affinePoint(piece.forward, p) }) as Point)
      .coordinates;
  const p = precise(a),
    q = precise(b);
  const dx = q[0] - p[0],
    dy = q[1] - p[1],
    lengthSquared = dx * dx + dy * dy;
  const sx = b[0] - a[0],
    sy = b[1] - a[1];
  const inverse: MaterialAffine =
    lengthSquared === 0
      ? [0, 0, 0, 0, a[0], a[1]]
      : [
          (sx * dx) / lengthSquared,
          (sx * dy) / lengthSquared,
          (sy * dx) / lengthSquared,
          (sy * dy) / lengthSquared,
          0,
          0,
        ];
  if (lengthSquared !== 0) {
    inverse[4] = a[0] - inverse[0] * p[0] - inverse[1] * p[1];
    inverse[5] = a[1] - inverse[2] * p[0] - inverse[3] * p[1];
  }
  return {
    ...piece,
    inverse,
    image:
      lengthSquared === 0
        ? { type: "Point", coordinates: p }
        : { type: "LineString", coordinates: [p, q] },
  };
}

function boundaryEdges(geometry: Geometry): [MaterialPoint, MaterialPoint][] {
  return geometryParts(geometry).flatMap((part) => {
    const rings = part.type === "Polygon" ? part.coordinates : [geometryPoints(part)];
    return rings.flatMap((ring) =>
      ring
        .slice(1)
        .map(
          (p, i) => [ring[i] as MaterialPoint, p as MaterialPoint] as [MaterialPoint, MaterialPoint]
        )
    );
  });
}

/** A collapsed area's lexicographically first preimage lies on its boundary.
 * Boundary edges supply exact affine candidates; ordinary arrival comparison
 * selects their lower envelope, including holes and disconnected components.
 * Numeric integration still retains the entire source area exactly once.
 */
export function materialArrivals(pieces: MotionPiece[]): MaterialArrival[] {
  return pieces.flatMap((piece) => {
    if (piece.inverse && spatial.area(piece.image) > 0) return [piece as MaterialArrival];
    return boundaryEdges(piece.source).flatMap(([a, b]) => [
      edgeArrival(piece, a, b),
      edgeArrival(piece, b, a),
    ]);
  });
}
