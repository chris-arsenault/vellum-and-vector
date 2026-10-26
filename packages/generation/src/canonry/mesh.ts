// Canonry PhysicalGeographyGrid.cs and MicrotriangleCoord.cs, commit 0f62584c.
import { round } from "./math";
import { adaptiveLeafAt, type AdaptiveTopology } from "@atlas/domain";

const rootThree = Number("1.7320508075688772935");
const triangleArea = Number("1.2990381056766579701");
export interface TriangleCoord {
  u: number;
  v: number;
  inverted: boolean;
}
export interface PhysicalMesh {
  /** Only full-width world meshes identify their east/west edges. */
  periodic?: { width: number; columns: number; poles?: { rows: number; spacingY: number } };
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
  degree: Int32Array;
  stride: number;
  cellWidth: Float64Array;
  cellHeight: Float64Array;
  faceLength: Float64Array;
  faceDistance: Float64Array;
  contentAreas: Float64Array;
  topology: AdaptiveTopology | null;
  cellToLeaf: Int32Array;
  leafToCell: Int32Array;
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
    degree: new Int32Array(count).fill(3),
    stride: 3,
    cellWidth: new Float64Array(count).fill(Math.sqrt(triangleArea)),
    cellHeight: new Float64Array(count).fill(Math.sqrt(triangleArea)),
    faceLength: new Float64Array(count * 3).fill(Math.sqrt(3)),
    faceDistance: new Float64Array(count * 3).fill(1),
    contentAreas: Float64Array.from({ length: count }, (_, i) =>
      i < contentCount ? triangleArea : 0
    ),
    topology: null,
    cellToLeaf: Int32Array.from({ length: count }, (_, i) => i),
    leafToCell: Int32Array.from({ length: count }, (_, i) => i),
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
  if (mesh.topology)
    return (
      Math.imul(round((mesh.x[i] + mesh.origin[0]) * 1000), 73856093) ^
      Math.imul(round((mesh.y[i] + mesh.origin[1]) * 1000), 19349663)
    );
  const p = mesh.coords[i];
  return Math.imul(p.u, 73856093) ^ Math.imul(p.v, 19349663) ^ (p.inverted ? 83492791 : 0);
}
function latticeCandidate(mesh: PhysicalMesh, x: number, y: number, inverted: boolean) {
  const sum = (x - (inverted ? 2 : 1)) / 1.5,
    difference = (2 * y) / rootThree,
    u = (sum - difference) / 2,
    v = (sum + difference) / 2,
    w = -u - v;
  let a = round(u),
    b = round(v);
  const c = round(w),
    du = Math.abs(a - u),
    dv = Math.abs(b - v),
    dw = Math.abs(c - w);
  // Cube rounding gives the nearest site on each triangular sublattice.
  if (du > dv && du > dw) a = -b - c;
  else if (dv > dw) b = -a - c;
  return mesh.indexes.get(`${a}:${b}:${Number(inverted)}`);
}
export function nearestTriangle(mesh: PhysicalMesh, x: number, y: number): number {
  [x, y] = meshPoint(mesh, x, y);
  if (mesh.topology) {
    const leaf = adaptiveLeafAt(mesh.topology, x + mesh.origin[0], y + mesh.origin[1]);
    return leaf < 0 ? -1 : mesh.leafToCell[leaf];
  }
  const latticeX = (x - mesh.latticeOffset[0]) / mesh.spacing,
    latticeY = (y - mesh.latticeOffset[1]) / (mesh.periodic?.poles?.spacingY ?? mesh.spacing);
  const a = latticeCandidate(mesh, latticeX, latticeY, false),
    b = latticeCandidate(mesh, latticeX, latticeY, true);
  if (a !== undefined && b !== undefined)
    return meshDeltaX(mesh, mesh.x[a] - x) ** 2 + (mesh.y[a] - y) ** 2 <=
      meshDeltaX(mesh, mesh.x[b] - x) ** 2 + (mesh.y[b] - y) ** 2
      ? a
      : b;
  // The clipped outer work boundary can omit a nearest infinite-lattice site.
  return boundaryTriangle(mesh, x, y, latticeX, latticeY);
}
function boundaryTriangle(
  mesh: PhysicalMesh,
  x: number,
  y: number,
  latticeX: number,
  latticeY: number
) {
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
        const distance =
          meshDeltaX(mesh, mesh.x[candidate] - x) ** 2 + (mesh.y[candidate] - y) ** 2;
        if (distance < best) {
          best = distance;
          index = candidate;
        }
      }
  }
  return index;
}
/** Short east/west displacement within a periodic metre chart. */
export function meshDeltaX(mesh: PhysicalMesh, dx: number): number {
  const width = mesh.periodic?.width;
  return width ? dx - Math.round(dx / width) * width : dx;
}
/** Canonical local easting; numerical padding remains ordinary on open meshes. */
export function meshPointX(mesh: PhysicalMesh, x: number): number {
  const width = mesh.periodic?.width;
  if (!width) return x;
  return ((((x + width / 2) % width) + width) % width) - width / 2;
}
/** Closed latitude edges reflect overflow locally; longitude always remains cylindrical. */
export function meshPoint(mesh: PhysicalMesh, x: number, y: number): [number, number] {
  if (mesh.periodic?.poles) {
    const height = mesh.bounds[3] - mesh.bounds[1];
    const band = Math.floor((y + height / 2) / height);
    const phase = (y + height / 2) / height - band;
    y = Math.abs(band % 2) ? height / 2 - phase * height : -height / 2 + phase * height;
  }
  return [meshPointX(mesh, x), y];
}
/** Short segment in the cylindrical chart, including repeated longitude images. */
export function meshLineDelta(mesh: PhysicalMesh, a: [number, number], b: [number, number]) {
  return [meshDeltaX(mesh, b[0] - a[0]), b[1] - a[1]];
}
export function edgeLeadingTo(mesh: PhysicalMesh, i: number, target: number): number {
  for (let edge = 0; edge < mesh.degree[i]; edge++)
    if (mesh.neighbors[i * mesh.stride + edge] === target) return edge;
  return -1;
}
