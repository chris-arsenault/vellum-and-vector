import type { PhysicalMesh } from "./mesh";
import {
  allocateNumerical,
  readNumericalBlock,
  writeNumericalBlock,
  type NumericalVector,
  type NumericalAllocator,
  type SampleType,
} from "@atlas/domain";
import { NumericalList } from "./numericalList";
export interface MetricOperator {
  numerical?: NumericalAllocator;
  cells: NumericalVector;
  areas: NumericalVector;
  diagonal: NumericalVector;
  offsets: NumericalVector;
  neighbors: NumericalVector;
  weights: NumericalVector;
}
export function metricArray(
  name: string,
  length: number,
  type: SampleType = "float64",
  numerical?: NumericalAllocator
) {
  return allocateNumerical(
    { name: `metric:${name}`, length, type, lifetime: "process" },
    numerical
  );
}
export function releaseMetric(matrix: MetricOperator) {
  matrix.numerical?.releaseUnused(
    [matrix.cells, matrix.areas, matrix.diagonal, matrix.offsets, matrix.neighbors, matrix.weights],
    []
  );
}
function metricCells(mesh: PhysicalMesh, active?: NumericalVector, numerical?: NumericalAllocator) {
  let count = 0;
  for (let i = 0; i < mesh.count; i++) if (!active || active[i]) count++;
  const cells = metricArray("cells", count, "int32", numerical),
    local = metricArray("local", mesh.count, "int32", numerical).fill(-1);
  for (let cell = 0, i = 0; cell < mesh.count; cell++)
    if (!active || active[cell]) {
      cells[i] = cell;
      local[cell] = i++;
    }
  return { cells, local };
}
export function metricOperator(
  mesh: PhysicalMesh,
  length: number,
  active?: NumericalVector,
  numerical?: NumericalAllocator
): MetricOperator {
  const { cells, local } = metricCells(mesh, active, numerical),
    count = cells.length;
  const areas = metricArray("areas", count, "float64", numerical),
    diagonal = metricArray("diagonal", count, "float64", numerical);
  const offsets = metricArray("offsets", count + 1, "int32", numerical),
    neighbors = new NumericalList("int32", "metric:neighbors", numerical),
    weights = new NumericalList("float64", "metric:weights", numerical);
  for (let i = 0; i < count; i++) {
    const cell = cells[i];
    areas[i] = diagonal[i] = mesh.areas[cell];
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
  }
  offsets[cells.length] = neighbors.length;
  numerical?.releaseUnused([local], []);
  return {
    numerical,
    cells,
    areas,
    diagonal,
    offsets,
    neighbors: neighbors.finish(),
    weights: weights.finish(),
  };
}
export function metricProduct(
  matrix: MetricOperator,
  values: NumericalVector,
  result: NumericalVector
) {
  for (let start = 0; start < values.length; start += metricProductBlockSamples) {
    const count = Math.min(metricProductBlockSamples, values.length - start);
    const input = readNumericalBlock(values, start, count),
      areas = readNumericalBlock(matrix.areas, start, count),
      offsets = readNumericalBlock(matrix.offsets, start, count + 1);
    const first = offsets[0],
      edges = offsets[count] - first;
    const neighbors = readNumericalBlock(matrix.neighbors, first, edges),
      weights = readNumericalBlock(matrix.weights, first, edges),
      output = new Float64Array(count);
    for (let i = 0; i < count; i++) {
      const value = input[i];
      let sum = value * areas[i];
      for (let at = offsets[i] - first; at < offsets[i + 1] - first; at++) {
        const neighbor = neighbors[at],
          other =
            neighbor >= start && neighbor < start + count
              ? input[neighbor - start]
              : values[neighbor];
        sum += (value - other) * weights[at];
      }
      output[i] = sum;
    }
    writeNumericalBlock(result, start, output);
  }
}
export const metricProductBlockSamples = 32_768;
