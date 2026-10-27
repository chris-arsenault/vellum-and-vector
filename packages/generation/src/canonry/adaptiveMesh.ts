import {
  adaptiveCell,
  adaptiveMeasures,
  allocateNumerical,
  generateNumerical,
  createAdaptiveTopology,
  rectangle,
  type AdaptiveSampling,
  type AdaptiveTopology,
  type Bounds,
  type NumericalAllocator,
  type NumericalVector,
} from "@atlas/domain";
import type { Geometry } from "geojson";
import type { PhysicalMesh } from "./mesh";
import { joinAdaptiveSeam } from "./adaptiveSeam";
import { physicalAdaptiveFaces } from "./adaptiveMeshFaces";

function cellOrder(content: NumericalVector, numerical?: NumericalAllocator) {
  const vector = (name: string) =>
      allocateNumerical(
        { type: "int32", length: content.length, lifetime: "run", name: `adaptive:${name}` },
        numerical
      ),
    cellToLeaf = vector("cellToLeaf"),
    leafToCell = vector("leafToCell"),
    contentCount = content.reduce((count, area) => count + Number(area > 0), 0);
  let inside = 0,
    outside = contentCount;
  for (let leaf = 0; leaf < content.length; leaf++) {
    const cell = content[leaf] > 0 ? inside++ : outside++;
    cellToLeaf[cell] = leaf;
    leafToCell[leaf] = cell;
  }
  return { cellToLeaf, leafToCell, contentCount };
}
function meshGeometry(
  topology: AdaptiveTopology,
  order: NumericalVector,
  origin: [number, number],
  numerical?: NumericalAllocator
) {
  const vector = (
      name: string,
      sample: (box: Bounds) => number,
      type: "float64" | "uint8" = "float64"
    ) =>
      generateNumerical(
        { type, length: order.length, lifetime: "run", name: `adaptive:${name}` },
        (cell) => sample(adaptiveCell(topology, order[cell])),
        numerical
      ),
    bounds = topology.bounds;
  return {
    x: vector("x", (b) => (b[0] + b[2]) / 2 - origin[0]),
    y: vector("y", (b) => (b[1] + b[3]) / 2 - origin[1]),
    cellWidth: vector("width", (b) => b[2] - b[0]),
    cellHeight: vector("height", (b) => b[3] - b[1]),
    areas: vector("areas", (b) => (b[2] - b[0]) * (b[3] - b[1])),
    boundary: vector(
      "boundary",
      (b) =>
        Number(
          b[0] === bounds[0] || b[1] === bounds[1] || b[2] === bounds[2] || b[3] === bounds[3]
        ),
      "uint8"
    ),
  };
}
/** Physical arrays share the execution allocator; only a bounded sample buffer is decoded. */
export function adaptivePhysicalMesh(
  topology: AdaptiveTopology,
  footprint: Geometry,
  numerical?: NumericalAllocator
): PhysicalMesh {
  const content = adaptiveMeasures(topology, footprint, numerical),
    order = cellOrder(content, numerical),
    bounds = topology.bounds,
    origin: [number, number] = [(bounds[0] + bounds[2]) / 2, (bounds[1] + bounds[3]) / 2],
    geometry = meshGeometry(topology, order.cellToLeaf, origin, numerical),
    contentAreas = generateNumerical(
      { type: "float64", length: content.length, lifetime: "run", name: "adaptive:contentAreas" },
      (cell) => content[order.cellToLeaf[cell]],
      numerical
    );
  if (numerical) numerical.release(content);
  return {
    count: geometry.areas.length,
    ...order,
    ...geometry,
    contentAreas,
    contentRadius: Math.sqrt(contentAreas.reduce((sum, value) => sum + value, 0) / Math.PI),
    workRadius: Math.hypot(bounds[2] - bounds[0], bounds[3] - bounds[1]) / 2,
    openBoundary: true,
    origin,
    topology,
    spacing: Math.sqrt(
      geometry.areas.reduce((sum, value) => sum + value, 0) / geometry.areas.length
    ),
    bounds: [
      bounds[0] - origin[0],
      bounds[1] - origin[1],
      bounds[2] - origin[0],
      bounds[3] - origin[1],
    ],
    coords: [],
    indexes: new Map(),
    latticeOffset: [0, 0],
    ...physicalAdaptiveFaces(topology, order.cellToLeaf, order.leafToCell, numerical),
  };
}
export function createAdaptiveWorldMesh(
  bounds: Bounds,
  sampling: AdaptiveSampling,
  padding: number,
  footprint: Geometry = rectangle(bounds),
  wrapX = false,
  numerical?: NumericalAllocator
) {
  const work: Bounds = [
      bounds[0] - (wrapX ? 0 : padding),
      bounds[1] - padding,
      bounds[2] + (wrapX ? 0 : padding),
      bounds[3] + padding,
    ],
    mesh = adaptivePhysicalMesh(
      createAdaptiveTopology(work, sampling, numerical),
      footprint,
      numerical
    );
  if (wrapX) joinAdaptiveSeam(mesh, numerical);
  mesh.bounds = [
    bounds[0] - mesh.origin[0],
    bounds[1] - mesh.origin[1],
    bounds[2] - mesh.origin[0],
    bounds[3] - mesh.origin[1],
  ];
  return mesh;
}
