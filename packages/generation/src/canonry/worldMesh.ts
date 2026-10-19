import type { PhysicalMesh, TriangleCoord } from "./mesh";
import { neighborCoord } from "./mesh";

const rootThree = Math.sqrt(3);
const triangleArea = (3 * rootThree) / 4;
const key = (p: TriangleCoord) => `${p.u}:${p.v}:${Number(p.inverted)}`;

function coordinates(
  p: TriangleCoord,
  spacing: number,
  offset: [number, number]
): [number, number] {
  return [
    (1.5 * (p.u + p.v) + (p.inverted ? 2 : 1)) * spacing + offset[0],
    ((rootThree * (-p.u + p.v)) / 2) * spacing + offset[1],
  ];
}

function cells(
  width: number,
  height: number,
  spacing: number,
  offset: [number, number]
): TriangleCoord[] {
  const extent = Math.ceil(width / (3 * spacing) + height / (rootThree * spacing)) + 2;
  const centerU = Math.round(-offset[0] / (3 * spacing) + offset[1] / (rootThree * spacing)),
    centerV = Math.round(-offset[0] / (3 * spacing) - offset[1] / (rootThree * spacing));
  const result: TriangleCoord[] = [];
  for (let u = centerU - extent; u <= centerU + extent; u++)
    for (let v = centerV - extent; v <= centerV + extent; v++)
      for (const inverted of [false, true]) {
        const p = { u, v, inverted },
          [x, y] = coordinates(p, spacing, offset);
        if (Math.abs(x) <= width / 2 && Math.abs(y) <= height / 2) result.push(p);
      }
  return result;
}

function sampledCells(
  bounds: [number, number, number, number],
  spacing: number,
  padding: number,
  covers: (x: number, y: number) => boolean,
  offset: [number, number]
) {
  const width = bounds[2] - bounds[0],
    height = bounds[3] - bounds[1],
    origin = [(bounds[0] + bounds[2]) / 2, (bounds[1] + bounds[3]) / 2];
  const inside: TriangleCoord[] = [],
    outside: TriangleCoord[] = [];
  for (const p of cells(width + 2 * padding, height + 2 * padding, spacing, offset)) {
    const [x, y] = coordinates(p, spacing, offset);
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
  anchor?: [number, number]
): PhysicalMesh {
  const width = bounds[2] - bounds[0],
    height = bounds[3] - bounds[1],
    spacing = Math.sqrt(
      ((width + 2 * padding) * (height + 2 * padding)) / (samples * triangleArea)
    );
  const origin: [number, number] = [(bounds[0] + bounds[2]) / 2, (bounds[1] + bounds[3]) / 2];
  let latticeOffset: [number, number] = [0, 0],
    sampled = sampledCells(bounds, spacing, padding, covers, latticeOffset);
  if (!sampled.inside.length) {
    const target = anchor ?? origin;
    // Translate the same lattice so one centroid represents the covered anchor.
    // Spacing, work extent and physical feature dimensions remain unchanged.
    latticeOffset = [target[0] - origin[0] - spacing, target[1] - origin[1]];
    sampled = sampledCells(bounds, spacing, padding, covers, latticeOffset);
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
    openBoundary: true,
    spacing,
    origin,
    latticeOffset,
    bounds: [-width / 2, -height / 2, width / 2, height / 2],
    areas: Float64Array.from(coords, (_, i) =>
      i < inside.length ? area / inside.length : triangleArea * spacing ** 2
    ),
    edgeLength: new Float64Array(count * 3).fill(spacing),
  };
  coords.forEach((p, i) => {
    [mesh.x[i], mesh.y[i]] = coordinates(p, spacing, latticeOffset);
  });
  connect(mesh);
  return mesh;
}

function connect(mesh: PhysicalMesh) {
  for (let i = 0; i < mesh.count; i++)
    for (let edge = 0; edge < 3; edge++) {
      const j = mesh.indexes.get(key(neighborCoord(mesh.coords[i], edge))) ?? -1,
        at = i * 3 + edge;
      mesh.neighbors[at] = j;
      if (j < 0) {
        mesh.boundary[i] = 1;
        continue;
      }
      const dx = mesh.x[j] - mesh.x[i],
        dy = mesh.y[j] - mesh.y[i],
        length = Math.hypot(dx, dy);
      mesh.edgeLength[at] = length;
      mesh.edgeX[at] = dx / length;
      mesh.edgeY[at] = dy / length;
    }
}
