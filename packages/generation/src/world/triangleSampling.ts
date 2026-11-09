import type { PhysicalMesh } from "./mesh";
import { nearestTriangle, meshDeltaX, meshPoint } from "./mesh";
import { triangleVertex, triangleVertexMembership } from "./triangleVertices";
import { CellList, SmallIntSet } from "@atlas/domain";

export interface TriangleSample {
  cell: number;
  cells: number[];
  weights: number[];
}
const rootThree = Math.sqrt(3);
/** Piecewise linear fans share vertex averages across faces. Centre samples are exact. */
function barycentricAt(mesh: PhysicalMesh, cell: number, x: number, y: number) {
  const sign = mesh.inverted(cell) ? -1 : 1,
    dx = (meshDeltaX(mesh, x - mesh.x(cell)) / mesh.spacing) * sign,
    dy = (y - mesh.y(cell)) / (mesh.periodic?.poles?.spacingY ?? mesh.spacing);
  return [(1 - 2 * dx) / 3, (1 + dx) / 3 - dy / rootThree, (1 + dx) / 3 + dy / rootThree];
}
function locate(mesh: PhysicalMesh, x: number, y: number, hint = -1) {
  [x, y] = meshPoint(mesh, x, y);
  // In an equilateral mesh, the triangle is also its centroid's nearest-cell region.
  // Distorted pole rows retain the lattice owner's location rule.
  if (hint >= 0 && !mesh.periodic?.poles) {
    const barycentric = barycentricAt(mesh, hint, x, y),
      minimum = Math.min(...barycentric);
    if (minimum >= 0) return { cell: hint, barycentric, minimum };
    const neighbor = faceNeighbor(mesh, hint, barycentric.indexOf(minimum)),
      adjacent = barycentricAt(mesh, neighbor, x, y),
      inside = Math.min(...adjacent);
    if (inside >= 0) return { cell: neighbor, barycentric: adjacent, minimum: inside };
  }
  const cell = nearestTriangle(mesh, x, y);
  if (cell < 0) return { cell, barycentric: [0, 0, 0], minimum: 0 };
  const barycentric = barycentricAt(mesh, cell, x, y);
  // Clamp only at the outer numerical boundary where a full triangle may be absent.
  return { cell, barycentric, minimum: Math.max(0, Math.min(...barycentric)) };
}
function fanWeights(barycentric: number[], minimum: number) {
  const maximum = Math.max(...barycentric),
    middle = 1 - minimum - maximum;
  return {
    center: 3 * minimum,
    vertex: Math.max(0, maximum - middle),
    face: Math.max(0, 2 * (middle - minimum)),
    corner: barycentric.indexOf(maximum),
    opposite: barycentric.indexOf(Math.min(...barycentric)),
  };
}
function faceNeighbor(mesh: PhysicalMesh, cell: number, opposite: number) {
  const edge = mesh.inverted(cell) && opposite > 0 ? 3 - opposite : opposite;
  const neighbor = mesh.neighbor(cell, edge);
  return neighbor < 0 ? cell : neighbor;
}
export function triangleSample(mesh: PhysicalMesh, x: number, y: number): TriangleSample {
  const { cell, barycentric, minimum } = locate(mesh, x, y);
  if (cell < 0) return { cell, cells: [], weights: [] };
  const fan = fanWeights(barycentric, minimum),
    cells = [cell, faceNeighbor(mesh, cell, fan.opposite)],
    weights = [fan.center + fan.face / 2, fan.face / 2],
    members = triangleVertex(mesh, cell, fan.corner).members;
  for (const member of members) {
    cells.push(member);
    weights.push(fan.vertex / members.length);
  }
  const total = weights.reduce((sum, value) => sum + value, 0);
  return { cell, cells, weights: weights.map((value) => value / total) };
}
export function triangleValue(sample: TriangleSample, values: ArrayLike<number>) {
  if (!sample.cells.length) return 0;
  const base = values[sample.cells[0]];
  let value = 0;
  for (let i = 0; i < sample.cells.length; i++)
    value += sample.weights[i] * (values[sample.cells[i]] - base);
  return base + value;
}
/** Average differences so a constant field remains constant, including at contour thresholds. */
function vertexMean(members: ArrayLike<number>, read: (i: number) => number) {
  const base = read(members[0]);
  let sum = 0;
  for (let i = 0; i < members.length; i++) sum += read(members[i]) - base;
  return base + sum / members.length;
}
/** Every live cell of the mesh. */
function* liveCells(mesh: PhysicalMesh) {
  for (let cell = 0; cell < mesh.count; cell++) if (mesh.membership(cell)) yield cell;
}
/** Include vertex neighbors: a region's interpolation can reach beyond its member cells. */
export function triangleSupport(mesh: PhysicalMesh, members: Iterable<number>) {
  // The support is sized by the region, not the world: a small set and a cell list.
  const selected = new SmallIntSet();
  const list = new CellList();
  const add = (cell: number) => {
    if (selected.add(cell)) list.push(cell);
  };
  for (const cell of members) add(cell);
  for (const cell of members)
    for (let corner = 0; corner < 3; corner++)
      for (const i of triangleVertex(mesh, cell, corner).members) add(i);
  const cells = list.finish();
  return {
    has: (cell: number) => selected.has(cell),
    [Symbol.iterator]: () => cells.values(),
  };
}
export function* triangleFans(
  mesh: PhysicalMesh,
  members: Iterable<number> | undefined,
  read: (i: number) => number
) {
  const support = members ? triangleSupport(mesh, members) : null;
  yield* triangleCellFans(mesh, support ?? liveCells(mesh), read);
}
export function* triangleCellFans(
  mesh: PhysicalMesh,
  cells: Iterable<number>,
  read: (i: number) => number
) {
  const vertex = (cell: number, corner: number): [number, number, number] => {
    const { members, position: p } = triangleVertex(mesh, cell, corner);
    return [p[0], p[1], vertexMean(members, read)];
  };
  for (const cell of cells) {
    const center: [number, number, number] = [
        mesh.x(cell) + mesh.origin[0],
        mesh.y(cell) + mesh.origin[1],
        read(cell),
      ],
      corners = [0, 1, 2].map((i) => vertex(cell, i));
    const boundary = corners.flatMap((a, i) => {
      const b = corners[(i + 1) % 3],
        neighbor = faceNeighbor(mesh, cell, (i + 2) % 3);
      const middle: [number, number, number] = [
        (a[0] + b[0]) / 2,
        (a[1] + b[1]) / 2,
        (read(cell) + read(neighbor)) / 2,
      ];
      return [a, middle];
    });
    if (mesh.inverted(cell)) boundary.reverse();
    for (let i = 0; i < boundary.length; i++)
      yield [center, boundary[i], boundary[(i + 1) % boundary.length]];
  }
}
/** Exposed mesh edges close contours which continue beyond the world's footprint. */
export function* triangleBoundary(
  mesh: PhysicalMesh,
  read: (i: number) => number,
  members?: Iterable<number>
) {
  const selected = members ? triangleSupport(mesh, members) : null;
  yield* boundarySegments(mesh, read, selected);
}
function* boundarySegments(
  mesh: PhysicalMesh,
  read: (i: number) => number,
  selected: ReturnType<typeof triangleSupport> | null
) {
  const cells = selected ?? liveCells(mesh);
  const vertex = (cell: number, corner: number): [number, number, number] => {
    const { members, position: p } = triangleVertex(mesh, cell, corner);
    return [p[0], p[1], vertexMean(members, read)];
  };
  for (const cell of cells) {
    for (let corner = 0; corner < 3; corner++) {
      const neighbor = faceNeighbor(mesh, cell, (corner + 2) % 3);
      if (interiorNeighbor(mesh, cell, neighbor, selected)) continue;
      const a = vertex(cell, corner),
        b = vertex(cell, (corner + 1) % 3),
        middle: [number, number, number] = [
          (a[0] + b[0]) / 2,
          (a[1] + b[1]) / 2,
          (read(cell) + read(neighbor)) / 2,
        ];
      yield mesh.inverted(cell) ? [b, middle] : [a, middle];
      yield mesh.inverted(cell) ? [middle, a] : [middle, b];
    }
  }
}
function interiorNeighbor(
  mesh: PhysicalMesh,
  cell: number,
  neighbor: number,
  selected: ReturnType<typeof triangleSupport> | null
) {
  return (
    neighbor !== cell &&
    (!selected || selected.has(neighbor)) &&
    !crossesChart(mesh, cell, neighbor)
  );
}
function crossesChart(mesh: PhysicalMesh, cell: number, neighbor: number) {
  return mesh.periodic && Math.abs(mesh.x(neighbor) - mesh.x(cell)) > 2 * mesh.spacing;
}
export function triangleSampler(
  mesh: PhysicalMesh,
  values: ArrayLike<number> | ((i: number) => number)
) {
  const read = typeof values === "function" ? values : (i: number) => values[i];
  return (x: number, y: number) => {
    const sample = interpolationAt(mesh, x, y);
    return sample ? interpolateFan(sample, read) : 0;
  };
}

function interpolationAt(
  mesh: PhysicalMesh,
  x: number,
  y: number,
  membership?: ReturnType<typeof triangleVertexMembership>,
  hint = -1,
  adjacent?: (cell: number, opposite: number) => number
) {
  const { cell, barycentric, minimum } = locate(mesh, x, y, hint);
  if (cell < 0) return null;
  const fan = fanWeights(barycentric, minimum);
  return {
    cell,
    fan,
    neighbor: adjacent ? adjacent(cell, fan.opposite) : faceNeighbor(mesh, cell, fan.opposite),
    members: membership
      ? membership(cell, fan.corner)
      : triangleVertex(mesh, cell, fan.corner).members,
  };
}
function interpolateFan(
  sample: NonNullable<ReturnType<typeof interpolationAt>>,
  read: (i: number) => number,
  mean = vertexMean(sample.members, read)
) {
  const { cell, fan, neighbor } = sample,
    base = read(cell);
  return (
    base +
    (fan.vertex * (mean - base) + (fan.face * (read(neighbor) - base)) / 2) /
      (fan.center + fan.vertex + fan.face)
  );
}

/** Values and derived vertex means belong to this one immutable sampling interval. */
function fixedVector(
  mesh: PhysicalMesh,
  readX: (i: number) => number,
  readY: (i: number) => number
) {
  const xs = Float64Array.from({ length: mesh.count }, (_, i) => readX(i)),
    ys = Float64Array.from({ length: mesh.count }, (_, i) => readY(i)),
    vertexX = new Float64Array(mesh.count * 3),
    vertexY = new Float64Array(mesh.count * 3),
    ready = new Uint8Array(mesh.count * 3),
    x = (i: number) => xs[i],
    y = (i: number) => ys[i];
  return (sample: NonNullable<ReturnType<typeof interpolationAt>>): [number, number] => {
    const row = sample.cell * 3 + sample.fan.corner;
    if (!ready[row]) {
      vertexX[row] = vertexMean(sample.members, x);
      vertexY[row] = vertexMean(sample.members, y);
      ready[row] = 1;
    }
    return [interpolateFan(sample, x, vertexX[row]), interpolateFan(sample, y, vertexY[row])];
  };
}

/** Both vector components share the same location, fan and vertex neighborhood. */
export function triangleVectorSampler(
  mesh: PhysicalMesh,
  readX: (i: number) => number,
  readY: (i: number) => number,
  options: { fixed?: boolean } = {}
) {
  const membership = triangleVertexMembership(mesh),
    facing = new Int32Array(mesh.count * 3).fill(-1),
    adjacent = (cell: number, opposite: number) => {
      const row = cell * 3 + opposite;
      if (facing[row] < 0) facing[row] = faceNeighbor(mesh, cell, opposite);
      return facing[row];
    },
    fixed = options.fixed ? fixedVector(mesh, readX, readY) : null;
  let hint = -1;
  return (x: number, y: number): [number, number] => {
    const sample = interpolationAt(mesh, x, y, membership, hint, adjacent);
    hint = sample?.cell ?? -1;
    if (!sample) return [0, 0];
    return fixed ? fixed(sample) : [interpolateFan(sample, readX), interpolateFan(sample, readY)];
  };
}
