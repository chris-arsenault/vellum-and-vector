import type { PhysicalMesh } from "./mesh";
import { nearestTriangle } from "./mesh";

export interface TriangleSample {
  cell: number;
  cells: number[];
  weights: number[];
}
const rootThree = Math.sqrt(3);
const prepared = new WeakMap<PhysicalMesh, ReturnType<typeof prepareVertices>>();

function prepareVertices(mesh: PhysicalMesh) {
  const vertices: number[][] = [],
    positions: [number, number][] = [],
    indexes = new Map<string, number>();
  const corners = new Int32Array(mesh.count * 3);
  mesh.coords.forEach((p, i) => {
    const x = 3 * (p.u + p.v) + (p.inverted ? 4 : 2),
      y = -p.u + p.v,
      sign = p.inverted ? -1 : 1;
    [
      [x - 2 * sign, y],
      [x + sign, y - 1],
      [x + sign, y + 1],
    ].forEach((v, corner) => {
      const key = v.join(":"),
        index = indexes.get(key) ?? vertices.length;
      if (!indexes.has(key)) {
        indexes.set(key, index);
        vertices.push([]);
        positions.push([
          (v[0] * mesh.spacing) / 2 + mesh.latticeOffset[0] + mesh.origin[0],
          (v[1] * rootThree * mesh.spacing) / 2 + mesh.latticeOffset[1] + mesh.origin[1],
        ]);
      }
      vertices[index].push(i);
      corners[i * 3 + corner] = index;
    });
  });
  return { vertices, corners, positions };
}
function vertexSupport(mesh: PhysicalMesh) {
  let support = prepared.get(mesh);
  if (!support) {
    support = prepareVertices(mesh);
    prepared.set(mesh, support);
  }
  return support;
}
/** Piecewise linear fans share vertex averages across faces. Centre samples are exact. */
function locate(mesh: PhysicalMesh, x: number, y: number) {
  const cell = nearestTriangle(mesh, x, y);
  if (cell < 0) return { cell, barycentric: [0, 0, 0], minimum: 0 };
  const sign = mesh.coords[cell].inverted ? -1 : 1,
    dx = ((x - mesh.x[cell]) / mesh.spacing) * sign,
    dy = (y - mesh.y[cell]) / mesh.spacing;
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
  const edge = mesh.coords[cell].inverted && opposite > 0 ? 3 - opposite : opposite;
  const neighbor = mesh.neighbors[cell * 3 + edge];
  return neighbor < 0 ? cell : neighbor;
}
export function triangleSample(mesh: PhysicalMesh, x: number, y: number): TriangleSample {
  const { cell, barycentric, minimum } = locate(mesh, x, y);
  if (cell < 0) return { cell, cells: [], weights: [] };
  const fan = fanWeights(barycentric, minimum),
    cells = [cell, faceNeighbor(mesh, cell, fan.opposite)],
    weights = [fan.center + fan.face / 2, fan.face / 2],
    support = vertexSupport(mesh),
    members = support.vertices[support.corners[cell * 3 + fan.corner]];
  for (const member of members) {
    cells.push(member);
    weights.push(fan.vertex / members.length);
  }
  const total = weights.reduce((sum, value) => sum + value, 0);
  return { cell, cells, weights: weights.map((value) => value / total) };
}
export function triangleValue(sample: TriangleSample, values: ArrayLike<number>) {
  let value = 0;
  for (let i = 0; i < sample.cells.length; i++)
    value += sample.weights[i] * values[sample.cells[i]];
  return value;
}
export function* triangleFans(mesh: PhysicalMesh, members: number[], read: (i: number) => number) {
  const support = vertexSupport(mesh),
    cells = new Set(members);
  for (const cell of members)
    for (let corner = 0; corner < 3; corner++)
      for (const i of support.vertices[support.corners[cell * 3 + corner]]) cells.add(i);
  const values = new Map<number, [number, number, number]>();
  const vertex = (index: number): [number, number, number] => {
    if (!values.has(index)) {
      const members = support.vertices[index],
        p = support.positions[index];
      values.set(index, [
        p[0],
        p[1],
        members.reduce((sum, i) => sum + read(i), 0) / members.length,
      ]);
    }
    return values.get(index)!;
  };
  for (const cell of cells) {
    const center: [number, number, number] = [
        mesh.x[cell] + mesh.origin[0],
        mesh.y[cell] + mesh.origin[1],
        read(cell),
      ],
      corners = [0, 1, 2].map((i) => vertex(support.corners[cell * 3 + i]));
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
    if (mesh.coords[cell].inverted) boundary.reverse();
    for (let i = 0; i < boundary.length; i++)
      yield [center, boundary[i], boundary[(i + 1) % boundary.length]];
  }
}
export function triangleSampler(
  mesh: PhysicalMesh,
  values: ArrayLike<number> | ((i: number) => number)
) {
  const read = typeof values === "function" ? values : (i: number) => values[i];
  const support = vertexSupport(mesh),
    vertices = new Float64Array(support.vertices.length).fill(NaN);
  const vertexValue = (index: number) => {
    if (Number.isNaN(vertices[index])) {
      const members = support.vertices[index];
      vertices[index] = members.reduce((sum, i) => sum + read(i), 0) / members.length;
    }
    return vertices[index];
  };
  return (x: number, y: number) => {
    const { cell, barycentric, minimum } = locate(mesh, x, y);
    if (cell < 0) return 0;
    const fan = fanWeights(barycentric, minimum),
      neighbor = faceNeighbor(mesh, cell, fan.opposite);
    return (
      (fan.center * read(cell) +
        fan.vertex * vertexValue(support.corners[cell * 3 + fan.corner]) +
        (fan.face * (read(cell) + read(neighbor))) / 2) /
      (fan.center + fan.vertex + fan.face)
    );
  };
}
