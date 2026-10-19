// Canonry PhysicalGeographyGrid.cs and MicrotriangleCoord.cs, commit 0f62584c.
import { round } from "./math";

const rootThree = Number("1.7320508075688772935");
const triangleArea = Number("1.2990381056766579701");
export interface TriangleCoord {
  u: number;
  v: number;
  inverted: boolean;
}
export interface PhysicalMesh {
  count: number;
  contentCount: number;
  contentRadius: number;
  workRadius: number;
  coords: TriangleCoord[];
  indexes: Map<string, number>;
  x: Float32Array | Float64Array;
  y: Float32Array | Float64Array;
  neighbors: Int32Array;
  edgeX: Float32Array;
  edgeY: Float32Array;
  boundary: Uint8Array;
  openBoundary: boolean;
  spacing: number;
  areas: Float64Array;
  origin: [number, number];
  latticeOffset: [number, number];
  bounds: [number, number, number, number];
  edgeLength: Float64Array;
}
const key = (p: TriangleCoord) => `${p.u}:${p.v}:${Number(p.inverted)}`;
function centroid(p: TriangleCoord): [number, number] {
  return [1.5 * (p.u + p.v) + (p.inverted ? 2 : 1), rootThree * 0.5 * (-p.u + p.v)];
}
export function neighborCoord(p: TriangleCoord, edge: number): TriangleCoord {
  const step = p.inverted ? 1 : -1;
  return {
    u: p.u + (edge === 1 ? step : 0),
    v: p.v + (edge === 2 ? step : 0),
    inverted: !p.inverted,
  };
}
function centeredDomain(count: number): TriangleCoord[] {
  const radius = Math.sqrt((count * triangleArea) / Math.PI);
  const extent = Math.ceil((2 * radius) / 3) + 4;
  const candidates: { coord: TriangleCoord; distance: number }[] = [];
  for (let u = -extent; u <= extent; u++)
    for (let v = -extent; v <= extent; v++)
      for (const inverted of [false, true]) {
        const coord = { u, v, inverted },
          [x, y] = centroid(coord);
        candidates.push({ coord, distance: x * x + y * y });
      }
  candidates.sort(
    (a, b) =>
      a.distance - b.distance ||
      a.coord.u - b.coord.u ||
      a.coord.v - b.coord.v ||
      Number(a.coord.inverted) - Number(b.coord.inverted)
  );
  return candidates.slice(0, count).map((candidate) => candidate.coord);
}
export function createMesh(contentCount: number, padding: number): PhysicalMesh {
  const radius = Math.sqrt((contentCount * triangleArea) / Math.PI);
  const count = Math.max(
    contentCount,
    Math.ceil((Math.PI * (radius + padding) ** 2) / triangleArea)
  );
  const coords = centeredDomain(count),
    indexes = new Map(coords.map((p, i) => [key(p), i]));
  const x = new Float32Array(count),
    y = new Float32Array(count);
  for (let i = 0; i < count; i++) [x[i], y[i]] = centroid(coords[i]);
  const mesh: PhysicalMesh = {
    count,
    contentCount,
    contentRadius: Math.hypot(x[contentCount - 1], y[contentCount - 1]),
    workRadius: Math.hypot(x[count - 1], y[count - 1]),
    coords,
    indexes,
    x,
    y,
    neighbors: new Int32Array(count * 3).fill(-1),
    edgeX: new Float32Array(count * 3),
    edgeY: new Float32Array(count * 3),
    boundary: new Uint8Array(count),
    openBoundary: false,
    spacing: 1,
    areas: new Float64Array(count).fill(triangleArea),
    origin: [0, 0],
    latticeOffset: [0, 0],
    bounds: [-radius, -radius, radius, radius],
    edgeLength: new Float64Array(count * 3).fill(1),
  };
  connectMesh(mesh);
  return mesh;
}
function connectMesh(mesh: PhysicalMesh) {
  for (let i = 0; i < mesh.count; i++)
    for (let edge = 0; edge < 3; edge++) {
      const j = mesh.indexes.get(key(neighborCoord(mesh.coords[i], edge))) ?? -1;
      mesh.neighbors[i * 3 + edge] = j;
      if (j < 0) {
        mesh.boundary[i] = 1;
        continue;
      }
      const dx = mesh.x[j] - mesh.x[i],
        dy = mesh.y[j] - mesh.y[i];
      const length = Math.max(0.001, Math.hypot(dx, dy));
      mesh.edgeLength[i * 3 + edge] = length;
      mesh.edgeX[i * 3 + edge] = dx / length;
      mesh.edgeY[i * 3 + edge] = dy / length;
    }
}
export function triangleIdentity(mesh: PhysicalMesh, i: number): number {
  const p = mesh.coords[i];
  return Math.imul(p.u, 73856093) ^ Math.imul(p.v, 19349663) ^ (p.inverted ? 83492791 : 0);
}
export function nearestTriangle(mesh: PhysicalMesh, x: number, y: number): number {
  const latticeX = (x - mesh.latticeOffset[0]) / mesh.spacing,
    latticeY = (y - mesh.latticeOffset[1]) / mesh.spacing;
  let index = -1,
    best = Infinity;
  for (const inverted of [false, true]) {
    const sum = (latticeX - (inverted ? 2 : 1)) / 1.5,
      difference = (2 * latticeY) / rootThree;
    const u = round((sum - difference) * 0.5),
      v = round((sum + difference) * 0.5);
    for (let du = -2; du <= 2; du++)
      for (let dv = -2; dv <= 2; dv++) {
        const candidate = mesh.indexes.get(key({ u: u + du, v: v + dv, inverted }));
        if (candidate === undefined) continue;
        const distance = (mesh.x[candidate] - x) ** 2 + (mesh.y[candidate] - y) ** 2;
        if (distance < best) {
          best = distance;
          index = candidate;
        }
      }
  }
  return index;
}
export function edgeLeadingTo(mesh: PhysicalMesh, i: number, target: number): number {
  for (let edge = 0; edge < 3; edge++) if (mesh.neighbors[i * 3 + edge] === target) return edge;
  return -1;
}
