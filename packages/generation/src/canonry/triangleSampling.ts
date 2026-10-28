import type { PhysicalMesh } from "./mesh";
import { nearestTriangle, meshDeltaX, meshPoint } from "./mesh";
import { triangleVertex } from "./triangleVertices";
import { allocateNumerical, CellList, type NumericalAllocator } from "@atlas/domain";

export interface TriangleSample {
  cell: number;
  cells: number[];
  weights: number[];
}
const rootThree = Math.sqrt(3);
/** Piecewise linear fans share vertex averages across faces. Centre samples are exact. */
function locate(mesh: PhysicalMesh, x: number, y: number) {
  [x, y] = meshPoint(mesh, x, y);
  const cell = nearestTriangle(mesh, x, y);
  if (cell < 0) return { cell, barycentric: [0, 0, 0], minimum: 0 };
  const sign = mesh.coordInverted[cell] ? -1 : 1,
    dx = (meshDeltaX(mesh, x - mesh.x[cell]) / mesh.spacing) * sign,
    dy = (y - mesh.y[cell]) / (mesh.periodic?.poles?.spacingY ?? mesh.spacing);
  const barycentric = [
    (1 - 2 * dx) / 3,
    (1 + dx) / 3 - dy / rootThree,
    (1 + dx) / 3 + dy / rootThree,
  ];
  // Clamp only at the outer numerical boundary where a full triangle may be absent.
  const minimum = Math.max(0, Math.min(...barycentric));
  return { cell, barycentric, minimum };
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
  const edge = mesh.coordInverted[cell] && opposite > 0 ? 3 - opposite : opposite;
  const neighbor = mesh.neighbors[cell * 3 + edge];
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
function vertexMean(members: number[], read: (i: number) => number) {
  const base = read(members[0]);
  return base + members.reduce((sum, i) => sum + (read(i) - base), 0) / members.length;
}
/** Include vertex neighbors: a region's interpolation can reach beyond its member cells. */
export function triangleSupport(
  mesh: PhysicalMesh,
  members: Iterable<number>,
  numerical?: NumericalAllocator
) {
  const selected = allocateNumerical(
    { type: "uint8", length: mesh.count, lifetime: "process", name: "contour:membership" },
    numerical
  );
  const list = new CellList();
  const add = (cell: number) => {
    if (selected[cell]) return;
    selected[cell] = 1;
    list.push(cell);
  };
  for (const cell of members) add(cell);
  for (const cell of members)
    for (let corner = 0; corner < 3; corner++)
      for (const i of triangleVertex(mesh, cell, corner).members) add(i);
  const cells = list.finish();
  return {
    has: (cell: number) => !!selected[cell],
    [Symbol.iterator]: () => cells.values(),
    close: () => numerical?.releaseUnused([selected], []),
  };
}
export function* triangleFans(
  mesh: PhysicalMesh,
  members: Iterable<number> | undefined,
  read: (i: number) => number,
  numerical?: NumericalAllocator
) {
  const support = members ? triangleSupport(mesh, members, numerical) : null;
  try {
    yield* triangleCellFans(mesh, support ?? mesh.x.keys(), read);
  } finally {
    support?.close();
  }
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
        mesh.x[cell] + mesh.origin[0],
        mesh.y[cell] + mesh.origin[1],
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
    if (mesh.coordInverted[cell]) boundary.reverse();
    for (let i = 0; i < boundary.length; i++)
      yield [center, boundary[i], boundary[(i + 1) % boundary.length]];
  }
}
/** Exposed mesh edges close contours which continue beyond the world's footprint. */
export function* triangleBoundary(
  mesh: PhysicalMesh,
  read: (i: number) => number,
  members?: Iterable<number>,
  numerical?: NumericalAllocator
) {
  const selected = members ? triangleSupport(mesh, members, numerical) : null;
  try {
    yield* boundarySegments(mesh, read, selected);
  } finally {
    selected?.close();
  }
}
function* boundarySegments(
  mesh: PhysicalMesh,
  read: (i: number) => number,
  selected: ReturnType<typeof triangleSupport> | null
) {
  const cells = selected ?? mesh.x.keys();
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
      yield mesh.coordInverted[cell] ? [b, middle] : [a, middle];
      yield mesh.coordInverted[cell] ? [middle, a] : [middle, b];
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
  return mesh.periodic && Math.abs(mesh.x[neighbor] - mesh.x[cell]) > 2 * mesh.spacing;
}
export function triangleSampler(
  mesh: PhysicalMesh,
  values: ArrayLike<number> | ((i: number) => number)
) {
  const read = typeof values === "function" ? values : (i: number) => values[i];
  return (x: number, y: number) => {
    const { cell, barycentric, minimum } = locate(mesh, x, y);
    if (cell < 0) return 0;
    const fan = fanWeights(barycentric, minimum),
      neighbor = faceNeighbor(mesh, cell, fan.opposite);
    const base = read(cell);
    return (
      base +
      (fan.vertex * (vertexMean(triangleVertex(mesh, cell, fan.corner).members, read) - base) +
        (fan.face * (read(neighbor) - base)) / 2) /
        (fan.center + fan.vertex + fan.face)
    );
  };
}
