import type { PhysicalMesh } from "./mesh";
export interface MetricOperator {
  cells: Int32Array;
  areas: Float64Array;
  diagonal: Float64Array;
  offsets: Int32Array;
  neighbors: Int32Array;
  weights: Float64Array;
}
export function metricOperator(
  mesh: PhysicalMesh,
  length: number,
  active?: Uint8Array
): MetricOperator {
  const cells = Int32Array.from(
    Array.from({ length: mesh.count }, (_, i) => i).filter((i) => !active || active[i])
  );
  const local = new Int32Array(mesh.count).fill(-1);
  cells.forEach((cell, i) => {
    local[cell] = i;
  });
  const areas = Float64Array.from(cells, (cell) => mesh.areas[cell]),
    diagonal = areas.slice();
  const offsets = new Int32Array(cells.length + 1),
    neighbors: number[] = [],
    weights: number[] = [];
  cells.forEach((cell, i) => {
    offsets[i] = neighbors.length;
    for (let edge = 0; edge < mesh.degree[cell]; edge++) {
      const at = cell * mesh.stride + edge,
        j = mesh.neighbors[at];
      if (j < 0 || local[j] < 0) continue;
      const weight = (length ** 2 * mesh.faceLength[at]) / mesh.faceDistance[at];
      neighbors.push(local[j]);
      weights.push(weight);
      diagonal[i] += weight;
    }
  });
  offsets[cells.length] = neighbors.length;
  return {
    cells,
    areas,
    diagonal,
    offsets,
    neighbors: Int32Array.from(neighbors),
    weights: Float64Array.from(weights),
  };
}
export function metricProduct(matrix: MetricOperator, values: Float64Array, result: Float64Array) {
  for (let i = 0; i < values.length; i++) {
    const value = values[i];
    let sum = value * matrix.areas[i];
    for (let at = matrix.offsets[i]; at < matrix.offsets[i + 1]; at++)
      sum += (value - values[matrix.neighbors[at]]) * matrix.weights[at];
    result[i] = sum;
  }
}
