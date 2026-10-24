import type { PhysicalMesh, TriangleCoord } from "./mesh";
import { neighborCoord } from "./mesh";
import { worldLattice, joinWorldEdges } from "./periodicMesh";

const rootThree = Math.sqrt(3);
const triangleArea = (3 * rootThree) / 4;
const key = (p: TriangleCoord) => `${p.u}:${p.v}:${Number(p.inverted)}`;

function coordinates(
  p: TriangleCoord,
  spacing: number,
  offset: [number, number],
  spacingY = spacing
): [number, number] {
  return [
    (1.5 * (p.u + p.v) + (p.inverted ? 2 : 1)) * spacing + offset[0],
    ((rootThree * (-p.u + p.v)) / 2) * spacingY + offset[1],
  ];
}

function cells(
  width: number,
  height: number,
  spacing: number,
  offset: [number, number],
  spacingY = spacing
): TriangleCoord[] {
  const extent = Math.ceil(width / (3 * spacing) + height / (rootThree * spacingY)) + 2;
  const centerU = Math.round(-offset[0] / (3 * spacing) + offset[1] / (rootThree * spacingY)),
    centerV = Math.round(-offset[0] / (3 * spacing) - offset[1] / (rootThree * spacingY));
  const result: TriangleCoord[] = [];
  for (let u = centerU - extent; u <= centerU + extent; u++)
    for (let v = centerV - extent; v <= centerV + extent; v++)
      for (const inverted of [false, true]) {
        const p = { u, v, inverted },
          [x, y] = coordinates(p, spacing, offset, spacingY);
        if (Math.abs(x) <= width / 2 && Math.abs(y) <= height / 2) result.push(p);
      }
  return result;
}

function sampledCells(
  bounds: [number, number, number, number],
  spacing: number,
  padding: number,
  covers: (x: number, y: number) => boolean,
  offset: [number, number],
  wrapX = false,
  spacingY = spacing
) {
  const width = bounds[2] - bounds[0],
    height = bounds[3] - bounds[1],
    origin = [(bounds[0] + bounds[2]) / 2, (bounds[1] + bounds[3]) / 2];
  const inside: TriangleCoord[] = [],
    outside: TriangleCoord[] = [];
  for (const p of cells(
    width + (wrapX ? 0 : 2 * padding),
    height + 2 * padding,
    spacing,
    offset,
    spacingY
  )) {
    const [x, y] = coordinates(p, spacing, offset, spacingY);
    const content =
      Math.abs(x) <= width / 2 && Math.abs(y) <= height / 2 && covers(x + origin[0], y + origin[1]);
    (content ? inside : outside).push(p);
  }
  return { inside, outside };
}

/** The mesh's positions and neighbor distances are metres; areas are square metres. */
export function createWorldMesh(
  bounds: [number, number, number, number],
  samples: number,
  padding: number,
  covers: (x: number, y: number) => boolean = () => true,
  area = (bounds[2] - bounds[0]) * (bounds[3] - bounds[1]),
  anchor?: [number, number],
  wrapX = false,
  closePoles = false
): PhysicalMesh {
  const width = bounds[2] - bounds[0],
    height = bounds[3] - bounds[1],
    lattice = worldLattice(width, height, samples, padding, wrapX, closePoles),
    { spacing, spacingY } = lattice,
    workPadding = closePoles ? 0 : padding;
  const origin: [number, number] = [(bounds[0] + bounds[2]) / 2, (bounds[1] + bounds[3]) / 2];
  let latticeOffset: [number, number] = [0, 0],
    sampled = sampledCells(bounds, spacing, workPadding, covers, latticeOffset, wrapX, spacingY);
  if (!sampled.inside.length) {
    const target = anchor ?? origin;
    // Translate the same lattice so one centroid represents the covered anchor.
    // Spacing, work extent and physical feature dimensions remain unchanged.
    latticeOffset = [target[0] - origin[0] - spacing, target[1] - origin[1]];
    sampled = sampledCells(bounds, spacing, workPadding, covers, latticeOffset, wrapX, spacingY);
  }
  const { inside, outside } = sampled;
  if (!inside.length)
    throw new Error("World sampling needs at least one cell inside its footprint.");
  const coords = [...inside, ...outside],
    count = coords.length;
  const mesh: PhysicalMesh = {
    count,
    contentCount: inside.length,
    coords,
    contentRadius: Math.sqrt(area / Math.PI),
    workRadius: Math.hypot(width / 2 + padding, height / 2 + padding),
    indexes: new Map(coords.map((p, i) => [key(p), i])),
    x: new Float64Array(count),
    y: new Float64Array(count),
    neighbors: new Int32Array(count * 3).fill(-1),
    edgeX: new Float32Array(count * 3),
    edgeY: new Float32Array(count * 3),
    boundary: new Uint8Array(count),
    openBoundary: !closePoles,
    spacing,
    origin,
    latticeOffset,
    bounds: [-width / 2, -height / 2, width / 2, height / 2],
    areas: Float64Array.from(coords, (_, i) =>
      i < inside.length ? area / inside.length : triangleArea * spacing ** 2
    ),
    edgeLength: new Float64Array(count * 3).fill(spacing),
    degree: new Int32Array(count).fill(3),
    stride: 3,
    cellWidth: new Float64Array(count).fill(Math.sqrt(triangleArea) * spacing),
    cellHeight: new Float64Array(count).fill(Math.sqrt(triangleArea) * spacing),
    faceLength: new Float64Array(count * 3).fill(Math.sqrt(3) * spacing),
    faceDistance: new Float64Array(count * 3).fill(spacing),
    contentAreas: Float64Array.from(coords, (_, i) =>
      i < inside.length ? area / inside.length : 0
    ),
    topology: null,
    cellToLeaf: Int32Array.from({ length: count }, (_, i) => i),
    leafToCell: Int32Array.from({ length: count }, (_, i) => i),
  };
  coords.forEach((p, i) => {
    [mesh.x[i], mesh.y[i]] = coordinates(p, spacing, latticeOffset, spacingY);
  });
  if (wrapX) joinWorldEdges(mesh, lattice, closePoles);
  connect(mesh);
  return mesh;
}

function connect(mesh: PhysicalMesh) {
  const spacingY = mesh.periodic?.poles?.spacingY ?? mesh.spacing;
  for (let i = 0; i < mesh.count; i++)
    for (let edge = 0; edge < 3; edge++) {
      const j = mesh.indexes.get(key(neighborCoord(mesh.coords[i], edge))) ?? -1,
        at = i * 3 + edge;
      mesh.neighbors[at] = j;
      if (j < 0) {
        closeBoundary(mesh, i, at);
        continue;
      }
      const expected = coordinates(
        neighborCoord(mesh.coords[i], edge),
        mesh.spacing,
        mesh.latticeOffset,
        spacingY
      );
      const dx = expected[0] - mesh.x[i],
        dy = expected[1] - mesh.y[i],
        length = Math.hypot(dx, dy);
      mesh.edgeLength[at] = length;
      mesh.faceDistance[at] = length;
      mesh.faceLength[at] =
        edge === 0
          ? rootThree * spacingY
          : Math.hypot(1.5 * mesh.spacing, (rootThree * spacingY) / 2);
      mesh.edgeX[at] = dx / length;
      mesh.edgeY[at] = dy / length;
    }
}

function closeBoundary(mesh: PhysicalMesh, i: number, at: number) {
  if (mesh.periodic?.poles) mesh.faceLength[at] = 0;
  else mesh.boundary[i] = 1;
}
