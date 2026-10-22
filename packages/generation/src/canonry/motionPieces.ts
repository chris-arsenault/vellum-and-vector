import { adaptiveCell, visitAdaptiveOverlap, spatial, type Bounds } from "@atlas/domain";
import type { Geometry } from "geojson";
import type { PhysicalField } from "./field";
import { motionRegions, readMotion, type MotionRegion, type MotionValue } from "./motionOwnership";
import {
  determinant,
  inverseAffine,
  affinePoint,
  triangleAffine,
  type MaterialAffine,
  type MaterialPoint,
} from "./materialAffine";
import { materialImage } from "./materialImage";

export interface MotionPiece {
  source: Geometry;
  image: Geometry;
  forward: MaterialAffine;
  inverse: MaterialAffine | null;
  density: number;
}
function piece(source: Geometry, forward: MaterialAffine): MotionPiece {
  const inverse = inverseAffine(forward);
  return {
    source,
    image: materialImage(source, forward),
    forward,
    inverse,
    density: 1 / Math.abs(determinant(forward)),
  };
}
function supportSize(value: MotionValue, box: Bounds) {
  if (typeof value === "number") return Infinity;
  const grid = value.grid,
    topology = grid.prepared?.adaptive?.[value.channel]?.topology ?? grid.topology;
  if (topology) {
    let size = Infinity;
    visitAdaptiveOverlap(topology, box, (i) => {
      const cell = adaptiveCell(topology, i);
      size = Math.min(size, cell[2] - cell[0], cell[3] - cell[1]);
    });
    return size;
  }
  return (
    grid.mesh?.spacing ??
    Math.min(
      (grid.bounds[2] - grid.bounds[0]) / (grid.width! - 1),
      (grid.bounds[3] - grid.bounds[1]) / (grid.height! - 1)
    )
  );
}
function motionError(box: Bounds, move: (p: MaterialPoint) => MaterialPoint) {
  const corners: MaterialPoint[] = [
    [box[0], box[1]],
    [box[2], box[1]],
    [box[2], box[3]],
    [box[0], box[3]],
  ];
  const center: MaterialPoint = [(box[0] + box[2]) / 2, (box[1] + box[3]) / 2];
  let error = 0;
  for (let i = 0; i < corners.length; i++) {
    const triangle = [center, corners[i], corners[(i + 1) % 4]],
      affine = triangleAffine(triangle, triangle.map(move));
    const probes = triangle.map((a, j): MaterialPoint => {
      const b = triangle[(j + 1) % 3];
      return [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
    });
    probes.push([
      triangle.reduce((s, p) => s + p[0], 0) / 3,
      triangle.reduce((s, p) => s + p[1], 0) / 3,
    ]);
    for (const p of probes) {
      const actual = move(p),
        linear = affinePoint(affine, p);
      error = Math.max(error, Math.hypot(actual[0] - linear[0], actual[1] - linear[1]));
    }
  }
  return error;
}
function integrationCells(
  region: MotionRegion,
  detail: number,
  move: (p: MaterialPoint) => MaterialPoint
) {
  const cells: Bounds[] = [],
    pending = [spatial.bounds(region.footprint)],
    candidate = spatial.boundsIntersectionCandidate(region.footprint);
  while (pending.length) {
    const box = pending.pop()!;
    if (!candidate(box)) continue;
    const size = Math.min(supportSize(region.x, box), supportSize(region.y, box)) / detail;
    // Existing authored support provides the initial integration scale. Curved
    // displacement is checked in metres after the actual epoch step, so a
    // large drift cannot silently magnify an acceptable velocity approximation.
    if (Math.max(box[2] - box[0], box[3] - box[1]) <= size && motionError(box, move) <= 10) {
      cells.push(box);
      continue;
    }
    const x = (box[0] + box[2]) / 2,
      y = (box[1] + box[3]) / 2;
    pending.push(
      [box[0], box[1], x, y],
      [x, box[1], box[2], y],
      [x, y, box[2], box[3]],
      [box[0], y, x, box[3]]
    );
  }
  return cells;
}
function cellEdges(cells: Bounds[]) {
  const vertical = new Map<number, Set<number>>(),
    horizontal = new Map<number, Set<number>>();
  for (const box of cells)
    for (const x of [box[0], box[2]])
      for (const y of [box[1], box[3]]) {
        if (!vertical.has(x)) vertical.set(x, new Set());
        if (!horizontal.has(y)) horizontal.set(y, new Set());
        vertical.get(x)!.add(y);
        horizontal.get(y)!.add(x);
      }
  const line = (values: Set<number>, low: number, high: number, reverse = false) => {
    const points = [...values].filter((v) => v >= low && v <= high).sort((a, b) => a - b);
    return (reverse ? points.reverse() : points).slice(0, -1);
  };
  return (b: Bounds): MaterialPoint[] => [
    ...line(horizontal.get(b[1])!, b[0], b[2]).map((x) => [x, b[1]] as MaterialPoint),
    ...line(vertical.get(b[2])!, b[1], b[3]).map((y) => [b[2], y] as MaterialPoint),
    ...line(horizontal.get(b[3])!, b[0], b[2], true).map((x) => [x, b[3]] as MaterialPoint),
    ...line(vertical.get(b[0])!, b[1], b[3], true).map((y) => [b[0], y] as MaterialPoint),
  ];
}
function variablePieces(region: MotionRegion, step: number, detail: number): MotionPiece[] {
  const x = readMotion(region.x),
    y = readMotion(region.y);
  const positions = new Map<string, MaterialPoint>();
  const move = ([a, b]: MaterialPoint): MaterialPoint => {
    const key = `${a},${b}`;
    if (!positions.has(key)) positions.set(key, [a + step * x(a, b), b + step * y(a, b)]);
    return positions.get(key)!;
  };
  const cells = integrationCells(region, detail, move),
    edges = cellEdges(cells),
    result: MotionPiece[] = [];
  for (const box of cells) {
    const boundary = edges(box),
      center: MaterialPoint = [(box[0] + box[2]) / 2, (box[1] + box[3]) / 2];
    for (let i = 0; i < boundary.length; i++) {
      const points = [center, boundary[i], boundary[(i + 1) % boundary.length]];
      const triangle: Geometry = { type: "Polygon", coordinates: [[...points, points[0]]] };
      const source = spatial.intersection(region.footprint, triangle);
      if (!source || spatial.area(source) === 0) continue;
      result.push(piece(source, triangleAffine(points, points.map(move))));
    }
  }
  return result;
}
/** Numerical integration uses authored support/detail only in variable pieces.
 * Shared cell-edge vertices prevent cracks across coarse/fine support faces. */
export function prepareMotionPieces(map: PhysicalField, step: number): MotionPiece[] {
  return motionRegions(map).flatMap((region) =>
    typeof region.x === "number" && typeof region.y === "number"
      ? [piece(region.footprint, [1, 0, 0, 1, region.x * step, region.y * step])]
      : variablePieces(region, step, map.motionDetail ?? 2)
  );
}
