import {
  allocateNumerical,
  generateNumerical,
  type AdaptiveTopology,
  type NumericalVector,
  type NumericalAllocator,
} from "@atlas/domain";

export function physicalAdaptiveFaces(
  topology: AdaptiveTopology,
  cellToLeaf: NumericalVector,
  leafToCell: NumericalVector,
  numerical?: NumericalAllocator
) {
  const degree = generateNumerical(
      { type: "int32", length: cellToLeaf.length, lifetime: "run", name: "adaptive:degree" },
      (i) => {
        const leaf = cellToLeaf[i];
        return topology.offsets[leaf + 1] - topology.offsets[leaf];
      },
      numerical
    ),
    stride = degree.reduce((maximum, value) => Math.max(maximum, value), 0),
    vector = (type: "int32" | "float32" | "float64", name: string) =>
      allocateNumerical(
        { type, length: degree.length * stride, lifetime: "run", name: `adaptive:${name}` },
        numerical
      ),
    neighbors = vector("int32", "neighbors").fill(-1),
    edgeX = vector("float32", "edgeX"),
    edgeY = vector("float32", "edgeY"),
    edgeLength = vector("float64", "edgeLength"),
    faceLength = vector("float64", "faceLength"),
    faceDistance = vector("float64", "faceDistance");
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
