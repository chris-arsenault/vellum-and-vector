import {
  allocateNumerical,
  generateNumerical,
  type NumericalAllocator,
  type SampleType,
} from "@atlas/domain";
import { neighborCoord, triangleIndex, type PhysicalMesh } from "./mesh";
import { worldLattice, joinWorldEdges } from "./periodicMesh";
import { latticePosition, type LatticeFrame } from "./latticeRows";
import { sampledLattice } from "./sampledLattice";

const triangleArea = (3 * Math.sqrt(3)) / 4;

/** Lattice identities and metric adjacency are retained in worker-owned numerical storage. */
export function createWorldMesh(
  bounds: [number, number, number, number],
  samples: number,
  padding: number,
  covers: (x: number, y: number) => boolean = () => true,
  area = (bounds[2] - bounds[0]) * (bounds[3] - bounds[1]),
  anchor?: [number, number],
  wrapX = false,
  closePoles = false,
  numerical?: NumericalAllocator
): PhysicalMesh {
  const width = bounds[2] - bounds[0],
    height = bounds[3] - bounds[1],
    lattice = worldLattice(width, height, samples, padding, wrapX, closePoles),
    { spacing, spacingY } = lattice,
    workPadding = closePoles ? 0 : padding;
  const origin: [number, number] = [(bounds[0] + bounds[2]) / 2, (bounds[1] + bounds[3]) / 2];
  const frame: LatticeFrame = {
    width: width + (wrapX ? 0 : 2 * workPadding),
    height: height + 2 * workPadding,
    spacing,
    spacingY,
    offset: [0, 0],
  };
  const sampled = ensureLattice(
    bounds,
    frame,
    covers,
    wrapX ? lattice.columns : null,
    anchor ?? origin,
    numerical
  );
  return buildMesh(
    bounds,
    area,
    padding,
    origin,
    frame,
    lattice,
    sampled,
    wrapX,
    closePoles,
    numerical
  );
}
function ensureLattice(
  bounds: [number, number, number, number],
  frame: LatticeFrame,
  covers: (x: number, y: number) => boolean,
  columns: number | null,
  anchor: [number, number],
  numerical?: NumericalAllocator
) {
  let sampled = sampledLattice(bounds, frame, covers, columns, numerical);
  if (!sampled) {
    frame.offset = [
      anchor[0] - (bounds[0] + bounds[2]) / 2 - frame.spacing,
      anchor[1] - (bounds[1] + bounds[3]) / 2,
    ];
    sampled = sampledLattice(bounds, frame, covers, columns, numerical);
  }
  if (!sampled) throw new Error("World sampling needs at least one cell inside its footprint.");
  return sampled;
}
function buildMesh(
  bounds: [number, number, number, number],
  area: number,
  padding: number,
  origin: [number, number],
  frame: LatticeFrame,
  lattice: ReturnType<typeof worldLattice>,
  sampled: NonNullable<ReturnType<typeof sampledLattice>>,
  wrapX: boolean,
  closePoles: boolean,
  numerical?: NumericalAllocator
): PhysicalMesh {
  const { count, contentCount, coords, indexes } = sampled,
    { spacing } = frame;
  const vector = (type: SampleType, size: number, name: string, value = 0) =>
    allocateNumerical(
      { type, length: size, lifetime: "run", name: `mesh:${name}` },
      numerical
    ).fill(value);
  const identity = () =>
    generateNumerical(
      { type: "int32", length: count, lifetime: "run", name: "mesh:leaf" },
      (i) => i,
      numerical
    );
  const mesh: PhysicalMesh = {
    count,
    contentCount,
    coords,
    indexes,
    origin,
    latticeOffset: frame.offset,
    ...meshRadii(bounds, area, padding),
    x: vector("float64", count, "x"),
    y: vector("float64", count, "y"),
    neighbors: vector("int32", count * 3, "neighbors", -1),
    edgeX: vector("float32", count * 3, "edgeX"),
    edgeY: vector("float32", count * 3, "edgeY"),
    boundary: vector("uint8", count, "boundary"),
    openBoundary: !closePoles,
    spacing,
    bounds: [
      -(bounds[2] - bounds[0]) / 2,
      -(bounds[3] - bounds[1]) / 2,
      (bounds[2] - bounds[0]) / 2,
      (bounds[3] - bounds[1]) / 2,
    ],
    areas: vector("float64", count, "areas", triangleArea * spacing ** 2).fill(
      area / contentCount,
      0,
      contentCount
    ),
    contentAreas: vector("float64", count, "contentAreas").fill(
      area / contentCount,
      0,
      contentCount
    ),
    edgeLength: vector("float64", count * 3, "edgeLength", spacing),
    degree: vector("int32", count, "degree", 3),
    stride: 3,
    cellWidth: vector("float64", count, "width", Math.sqrt(triangleArea) * spacing),
    cellHeight: vector("float64", count, "height", Math.sqrt(triangleArea) * spacing),
    faceLength: vector("float64", count * 3, "faceLength", Math.sqrt(3) * spacing),
    faceDistance: vector("float64", count * 3, "faceDistance", spacing),
    topology: null,
    cellToLeaf: identity(),
    leafToCell: identity(),
  };
  coords.forEach((p, i) => {
    [mesh.x[i], mesh.y[i]] = latticePosition(p, frame);
  });
  if (wrapX) joinWorldEdges(mesh, lattice, closePoles);
  connect(mesh, frame);
  return mesh;
}
function connect(mesh: PhysicalMesh, frame: LatticeFrame) {
  for (let i = 0; i < mesh.count; i++)
    for (let edge = 0; edge < 3; edge++) {
      const p = neighborCoord(mesh.coords[i], edge),
        j = triangleIndex(mesh, p.u, p.v, p.inverted) ?? -1,
        at = i * 3 + edge;
      mesh.neighbors[at] = j;
      if (j < 0) {
        closeBoundary(mesh, i, at);
        continue;
      }
      const expected = latticePosition(p, frame),
        dx = expected[0] - mesh.x[i],
        dy = expected[1] - mesh.y[i],
        length = Math.hypot(dx, dy);
      mesh.edgeLength[at] = length;
      mesh.faceDistance[at] = length;
      mesh.faceLength[at] =
        edge === 0
          ? Math.sqrt(3) * frame.spacingY
          : Math.hypot(1.5 * mesh.spacing, (Math.sqrt(3) * frame.spacingY) / 2);
      mesh.edgeX[at] = dx / length;
      mesh.edgeY[at] = dy / length;
    }
}
function meshRadii(bounds: [number, number, number, number], area: number, padding: number) {
  return {
    contentRadius: Math.sqrt(area / Math.PI),
    workRadius: Math.hypot(
      (bounds[2] - bounds[0]) / 2 + padding,
      (bounds[3] - bounds[1]) / 2 + padding
    ),
  };
}
function closeBoundary(mesh: PhysicalMesh, i: number, at: number) {
  if (mesh.periodic?.poles) mesh.faceLength[at] = 0;
  else mesh.boundary[i] = 1;
}
