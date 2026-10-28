import type { PhysicalField } from "./field";
import { CellList, FloatList, type Band, type SampleType } from "@atlas/domain";
import { workingArray, releaseWorking } from "./physicalNumerics";

/** A screened-diffusion operator over the participating cells, in local numbering. */
export interface MetricOperator {
  map: PhysicalField;
  /** Mesh cell of each local index. */
  cells: Int32Array;
  areas: Band;
  diagonal: Band;
  offsets: Band;
  neighbors: Int32Array;
  weights: Float64Array;
}
export function metricArray(
  map: PhysicalField,
  name: string,
  length: number,
  type: SampleType = "float64"
) {
  return workingArray(map, type, `metric:${name}`, length);
}
export function releaseMetric(matrix: MetricOperator) {
  releaseWorking(matrix.map, matrix.areas, matrix.diagonal, matrix.offsets);
}
function metricCells(map: PhysicalField, active?: Band) {
  const mesh = map.mesh;
  let count = 0;
  for (let i = 0; i < mesh.count; i++) if (!active || active.get(i)) count++;
  const cells = new Int32Array(count),
    local = metricArray(map, "local", mesh.count, "int32").fill(-1);
  for (let cell = 0, i = 0; cell < mesh.count; cell++)
    if (!active || active.get(cell)) {
      cells[i] = cell;
      local.set(cell, i++);
    }
  return { cells, local };
}
export function metricOperator(map: PhysicalField, length: number, active?: Band): MetricOperator {
  const mesh = map.mesh,
    { cells, local } = metricCells(map, active),
    count = cells.length;
  const areas = metricArray(map, "areas", count),
    diagonal = metricArray(map, "diagonal", count);
  const offsets = metricArray(map, "offsets", count + 1, "int32"),
    neighbors = new CellList(count * 3),
    weights = new FloatList(count * 3);
  for (let i = 0; i < count; i++) {
    const cell = cells[i],
      area = mesh.area(cell);
    areas.set(i, area);
    let sum = area;
    offsets.set(i, neighbors.length);
    for (let edge = 0; edge < mesh.degree(cell); edge++) {
      const j = mesh.neighbor(cell, edge);
      if (j < 0 || local.get(j) < 0) continue;
      const weight = (length ** 2 * mesh.faceLength(cell, edge)) / mesh.faceDistance(cell, edge);
      neighbors.push(local.get(j));
      weights.push(weight);
      sum += weight;
    }
    diagonal.set(i, sum);
  }
  offsets.set(count, neighbors.length);
  releaseWorking(map, local);
  return {
    map,
    cells,
    areas,
    diagonal,
    offsets,
    neighbors: neighbors.finish(),
    weights: weights.finish(),
  };
}
/** result = A · values over the local numbering. */
export function metricProduct(matrix: MetricOperator, values: Band, result: Band) {
  const count = matrix.cells.length,
    neighbors = matrix.neighbors,
    weights = matrix.weights;
  for (let i = 0; i < count; i++) {
    const value = values.get(i),
      end = matrix.offsets.get(i + 1);
    let sum = value * matrix.areas.get(i);
    for (let at = matrix.offsets.get(i); at < end; at++)
      sum += (value - values.get(neighbors[at])) * weights[at];
    result.set(i, sum);
  }
}
