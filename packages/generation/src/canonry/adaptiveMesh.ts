import {
  adaptiveGeometry,
  adaptiveMeasures,
  createAdaptiveTopology,
  rectangle,
  type AdaptiveSampling,
  type AdaptiveTopology,
  type Bounds,
} from "@atlas/domain";
import type { Geometry } from "geojson";
import type { PhysicalMesh } from "./mesh";
import { joinAdaptiveSeam } from "./adaptiveSeam";

function physicalFaces(topology: AdaptiveTopology, cellToLeaf: Int32Array, leafToCell: Int32Array) {
  const degree = Int32Array.from(
    cellToLeaf,
    (leaf) => topology.offsets[leaf + 1] - topology.offsets[leaf]
  );
  const stride = degree.reduce((maximum, value) => Math.max(maximum, value), 0);
  const neighbors = new Int32Array(degree.length * stride).fill(-1);
  const edgeX = new Float32Array(neighbors.length),
    edgeY = new Float32Array(neighbors.length);
  const edgeLength = new Float64Array(neighbors.length),
    faceLength = new Float64Array(neighbors.length);
  const faceDistance = new Float64Array(neighbors.length);
  for (let i = 0; i < degree.length; i++) {
    const leaf = cellToLeaf[i];
    for (let edge = 0; edge < degree[i]; edge++) {
      const source = topology.offsets[leaf] + edge,
        at = i * stride + edge;
      neighbors[at] = leafToCell[topology.neighbors[source]];
      edgeX[at] = topology.directionX[source];
      edgeY[at] = topology.directionY[source];
      edgeLength[at] = topology.distances[source];
      faceLength[at] = topology.faceLengths[source];
      faceDistance[at] =
        edgeLength[at] *
        Math.abs(
          topology.directionX[source] * topology.normalX[source] +
            topology.directionY[source] * topology.normalY[source]
        );
    }
  }
  return { degree, stride, neighbors, edgeX, edgeY, edgeLength, faceLength, faceDistance };
}
/** The same physical process bodies operate on adaptive control volumes in world metres. */
export function adaptivePhysicalMesh(
  topology: AdaptiveTopology,
  footprint: Geometry
): PhysicalMesh {
  const geometry = adaptiveGeometry(topology),
    content = adaptiveMeasures(topology, footprint);
  const inside: number[] = [],
    outside: number[] = [];
  content.forEach((area, i) => (area > 0 ? inside : outside).push(i));
  const cellToLeaf = Int32Array.from([...inside, ...outside]);
  const leafToCell = new Int32Array(cellToLeaf.length);
  cellToLeaf.forEach((leaf, i) => {
    leafToCell[leaf] = i;
  });
  const bounds = topology.bounds;
  const origin: [number, number] = [(bounds[0] + bounds[2]) / 2, (bounds[1] + bounds[3]) / 2];
  const areas = Float64Array.from(cellToLeaf, (leaf) => geometry.areas[leaf]);
  const contentAreas = Float64Array.from(cellToLeaf, (leaf) => content[leaf]);
  const area = contentAreas.reduce((sum, value) => sum + value, 0);
  return {
    count: areas.length,
    contentCount: inside.length,
    contentRadius: Math.sqrt(area / Math.PI),
    workRadius: Math.hypot(bounds[2] - bounds[0], bounds[3] - bounds[1]) / 2,
    x: Float64Array.from(cellToLeaf, (leaf) => geometry.x[leaf] - origin[0]),
    y: Float64Array.from(cellToLeaf, (leaf) => geometry.y[leaf] - origin[1]),
    cellWidth: Float64Array.from(cellToLeaf, (leaf) => geometry.width[leaf]),
    cellHeight: Float64Array.from(cellToLeaf, (leaf) => geometry.height[leaf]),
    areas,
    contentAreas,
    boundary: Uint8Array.from(cellToLeaf, (leaf) => geometry.boundary[leaf]),
    openBoundary: true,
    origin,
    topology,
    cellToLeaf,
    leafToCell,
    spacing: Math.sqrt(areas.reduce((sum, value) => sum + value, 0) / areas.length),
    bounds: [
      bounds[0] - origin[0],
      bounds[1] - origin[1],
      bounds[2] - origin[0],
      bounds[3] - origin[1],
    ],
    coords: [],
    indexes: new Map(),
    latticeOffset: [0, 0],
    ...physicalFaces(topology, cellToLeaf, leafToCell),
  };
}
export function createAdaptiveWorldMesh(
  bounds: Bounds,
  sampling: AdaptiveSampling,
  padding: number,
  footprint: Geometry = rectangle(bounds),
  wrapX = false
) {
  const work: Bounds = [
    bounds[0] - (wrapX ? 0 : padding),
    bounds[1] - padding,
    bounds[2] + (wrapX ? 0 : padding),
    bounds[3] + padding,
  ];
  const mesh = adaptivePhysicalMesh(createAdaptiveTopology(work, sampling), footprint);
  if (wrapX) joinAdaptiveSeam(mesh);
  mesh.bounds = [
    bounds[0] - mesh.origin[0],
    bounds[1] - mesh.origin[1],
    bounds[2] - mesh.origin[0],
    bounds[3] - mesh.origin[1],
  ];
  return mesh;
}
