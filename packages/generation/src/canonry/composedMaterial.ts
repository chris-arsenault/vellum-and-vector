import { boundsIndex, rectangle, spatial, type Bounds } from "@atlas/domain";
import type { Geometry } from "geojson";
import type { PhysicalField } from "./field";
import { provinceBounds } from "./provinceGeography";
import { prepareMotionPieces, type MotionPiece } from "./motionPieces";
import { affineGeometry, affinePoint, halfPlane, type MaterialPoint } from "./materialAffine";
import { materialCellTransfers } from "./materialCells";
import { materialArrivals, type MaterialArrival } from "./materialArrivals";
import { materialImage } from "./materialImage";

function densityOrder(a: MotionPiece, b: MotionPiece) {
  if (a.density === b.density) return 0;
  if (!Number.isFinite(a.density) || !Number.isFinite(b.density))
    return a.density > b.density ? 1 : -1;
  const difference = a.density - b.density;
  return Math.abs(difference) <= 8 * Number.EPSILON * Math.max(a.density, b.density)
    ? 0
    : Math.sign(difference);
}
function tieRegion(first: MaterialArrival, other: MaterialArrival) {
  const a = first.inverse!,
    b = other.inverse!,
    box = spatial.bounds(other.image);
  // The mask is an area even when the arrival is a line or point. Expanding
  // only its degenerate bounding axes does not change the clipped arrival.
  if (box[0] === box[2]) {
    box[0] -= 1;
    box[2] += 1;
  }
  if (box[1] === box[3]) {
    box[1] -= 1;
    box[3] += 1;
  }
  let x = b[0] - a[0],
    y = b[1] - a[1],
    c = b[4] - a[4];
  if (x === 0 && y === 0 && c === 0) {
    x = b[2] - a[2];
    y = b[3] - a[3];
    c = b[5] - a[5];
  }
  if (x === 0 && y === 0) return c < 0 ? other.image : null;
  const region = halfPlane(box, x, y, c);
  return region ? spatial.intersection(other.image, region) : null;
}
type CoveredArrival = MaterialArrival & { covers: ReturnType<typeof spatial.pointCoverage> };
function insideBounds(x: number, y: number, bounds: Bounds) {
  return x >= bounds[0] && x <= bounds[2] && y >= bounds[1] && y <= bounds[3];
}
function arrivalReader(bounds: Bounds, images: ReturnType<typeof boundsIndex<CoveredArrival>>) {
  return (x: number, y: number): MaterialPoint | null => {
    if (!insideBounds(x, y, bounds)) return null;
    let best: MaterialPoint | null = null,
      owner: MotionPiece | undefined;
    for (const piece of images([x, y, x, y])) {
      if (!piece.covers({ x, y, z: 0 })) continue;
      const source = affinePoint(piece.inverse, [x, y]),
        order = owner ? densityOrder(piece, owner) : 1;
      if (order > 0 || (order === 0 && sourceBefore(source, best))) {
        owner = piece;
        best = source;
      }
    }
    return best;
  };
}
function sourceBefore(source: MaterialPoint, other: MaterialPoint | null) {
  return (
    other !== null && (source[0] < other[0] || (source[0] === other[0] && source[1] < other[1]))
  );
}
/** Prepared local affine material map, used by both integration and geography. */
export function composedMaterialTransport(map: PhysicalField, step: number) {
  const pieces = prepareMotionPieces(map, step),
    bounds = provinceBounds(map),
    domain = rectangle(bounds);
  const arrivals = materialArrivals(pieces).map((piece) => ({
    ...piece,
    covers: spatial.pointCoverage(piece.image),
  }));
  const images = boundsIndex(
      arrivals.map((value) => ({ bounds: spatial.bounds(value.image), value }))
    ),
    sources = boundsIndex(pieces.map((value) => ({ bounds: spatial.bounds(value.source), value }))),
    arrivalSources = boundsIndex(
      arrivals.map((value) => ({ bounds: spatial.bounds(value.source), value }))
    ),
    winnerSources = new Map<MaterialArrival, Geometry | null>();
  const winnerSource = (piece: MaterialArrival) => {
    if (winnerSources.has(piece)) return winnerSources.get(piece)!;
    let winner = spatial.intersection(piece.image, domain);
    for (const other of images(spatial.bounds(piece.image))) {
      if (!winner) break;
      if (other === piece) continue;
      const order = densityOrder(other, piece);
      const mask = order > 0 ? other.image : order === 0 ? tieRegion(piece, other) : null;
      if (mask) winner = spatial.difference(winner, mask);
    }
    const source = winner ? affineGeometry(winner, piece.inverse!) : null;
    winnerSources.set(piece, source);
    return source;
  };
  return {
    sourceAt: arrivalReader(bounds, images),
    contributions: materialCellTransfers(map.mesh, pieces),
    displacementAt(x: number, y: number): MaterialPoint {
      const piece = sources([x, y, x, y]).find((p) =>
        spatial.pointCoverage(p.source)({ x, y, z: 0 })
      );
      if (!piece) return [0, 0];
      const target = affinePoint(piece.forward, [x, y]);
      return [target[0] - x, target[1] - y];
    },
    transport(geometry: Geometry): Geometry | null {
      const result: Geometry[] = [];
      for (const piece of arrivalSources(spatial.bounds(geometry))) {
        const winner = winnerSource(piece),
          part = winner && spatial.intersection(geometry, winner);
        if (part) {
          const image = spatial.intersection(piece.image, materialImage(part, piece.forward));
          if (image) result.push(image);
        }
      }
      return result.length ? spatial.unionAll(result) : null;
    },
  };
}
