import { SmallIntSet } from "@atlas/domain";
import { meshDeltaX, nearestTriangle, type PhysicalMesh } from "./mesh";

type Point = [number, number];
const rootThree = Math.sqrt(3);

function triangle(mesh: PhysicalMesh, cell: number, x: number, y: number): Point[] {
  const sign = mesh.coordInverted[cell] ? 1 : -1,
    sx = mesh.spacing,
    sy = mesh.periodic?.poles?.spacingY ?? sx;
  return [
    [x + sign * sx, y],
    [x - (sign * sx) / 2, y + (sign * rootThree * sy) / 2],
    [x - (sign * sx) / 2, y - (sign * rootThree * sy) / 2],
  ];
}
function area(points: Point[]) {
  let sum = 0;
  const a = points[0];
  for (let i = 1; i + 1 < points.length; i++) {
    const b = points[i],
      c = points[i + 1];
    sum += (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
  }
  return Math.abs(sum) / 2;
}
function clipEdge(points: Point[], a: Point, b: Point): Point[] {
  const signed = (p: Point) => (b[0] - a[0]) * (p[1] - a[1]) - (b[1] - a[1]) * (p[0] - a[0]);
  const result: Point[] = [];
  for (let i = 0; i < points.length; i++) {
    const p = points[i],
      q = points[(i + 1) % points.length],
      first = signed(p),
      second = signed(q);
    if (first >= 0) result.push(p);
    if (first >= 0 !== second >= 0) {
      const t = first / (first - second);
      result.push([p[0] + t * (q[0] - p[0]), p[1] + t * (q[1] - p[1])]);
    }
  }
  return result;
}
function overlap(source: Point[], target: Point[]) {
  let result = source;
  for (let i = 0; i < target.length && result.length; i++)
    result = clipEdge(result, target[i], target[(i + 1) % target.length]);
  return result.length >= 3 ? area(result) : 0;
}
function polarCap(mesh: PhysicalMesh, source: number, y: number) {
  if (!mesh.periodic?.poles) return false;
  const edge = mesh.bounds[3],
    reach = rootThree * mesh.periodic.poles.spacingY;
  // A reflected control volume can fold at a closed edge; use the topology scatter there.
  return Math.abs(y) + reach >= edge || Math.abs(mesh.y[source]) + reach >= edge;
}
function targetOverlap(mesh: PhysicalMesh, cell: number, polygon: Point[], x: number, y: number) {
  const cx = x + meshDeltaX(mesh, mesh.x[cell] - x),
    cy = mesh.y[cell];
  if (Math.abs(cx - x) > mesh.spacing * 2 || Math.abs(cy - y) > mesh.spacing * 2) return 0;
  return overlap(polygon, triangle(mesh, cell, cx, cy));
}
function appendNeighbors(mesh: PhysicalMesh, cell: number, seen: SmallIntSet, queue: number[]) {
  for (let edge = 0; edge < mesh.degree[cell]; edge++) {
    const target = mesh.neighbors[cell * mesh.stride + edge];
    if (target >= 0 && seen.add(target)) queue.push(target);
  }
}

/** Finite control-volume motion, including rigid rotation and repeated longitude images. */
export function triangleOverlap(
  mesh: PhysicalMesh,
  source: number,
  x: number,
  y: number,
  move?: (x: number, y: number) => Point
): [number, number][] | null {
  if (polarCap(mesh, source, y)) return null;
  const nearest = nearestTriangle(mesh, x, y);
  if (nearest < 0) return [];
  const polygon = move
      ? triangle(mesh, source, mesh.x[source], mesh.y[source]).map(([x, y]) => move(x, y))
      : triangle(mesh, source, x, y),
    sourceArea = area(polygon),
    queue = [nearest],
    seen = new SmallIntSet(),
    result: [number, number][] = [];
  seen.add(nearest);
  for (let head = 0; head < queue.length; head++) {
    const cell = queue[head],
      covered = targetOverlap(mesh, cell, polygon, x, y);
    if (covered > sourceArea * 1e-12) result.push([cell, covered / sourceArea]);
    if (head !== 0 && covered <= sourceArea * 1e-12) continue;
    appendNeighbors(mesh, cell, seen, queue);
  }
  return result;
}
