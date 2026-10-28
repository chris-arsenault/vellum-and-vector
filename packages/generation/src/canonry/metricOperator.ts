import type { PhysicalField } from "./field";
import type { Band, SampleType } from "@atlas/domain";
import { workingArray, releaseWorking } from "./physicalNumerics";

/**
 * A screened-diffusion operator over the participating cells, in local numbering. Every
 * array is a working band sized by the participating cells or their faces, so the operator
 * pages with the coverage on a large world.
 */
export interface MetricOperator {
  map: PhysicalField;
  /** Participating cells (rows). */
  count: number;
  /** Mesh cell of each local index; absent on coarse levels. */
  cells?: Band;
  areas: Band;
  diagonal: Band;
  offsets: Band;
  neighbors: Band;
  weights: Band;
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
  releaseWorking(
    matrix.map,
    matrix.areas,
    matrix.diagonal,
    matrix.offsets,
    matrix.neighbors,
    matrix.weights,
    ...(matrix.cells ? [matrix.cells] : [])
  );
}
function metricCells(map: PhysicalField, active?: Band) {
  const mesh = map.mesh;
  let count = 0;
  for (let i = 0; i < mesh.count; i++) if (!active || active.get(i)) count++;
  const cells = metricArray(map, "cells", count, "int32"),
    local = metricArray(map, "local", mesh.count, "int32").fill(-1);
  for (let cell = 0, i = 0; cell < mesh.count; cell++)
    if (!active || active.get(cell)) {
      cells.set(i, cell);
      local.set(cell, i++);
    }
  return { cells, local };
}
/** Visit the participating faces of local row `i`: neighbour index and face weight. */
function visitFaces(
  map: PhysicalField,
  length: number,
  cell: number,
  local: Band,
  visit: (j: number, weight: number) => void
) {
  const mesh = map.mesh;
  for (let edge = 0; edge < mesh.degree(cell); edge++) {
    const j = mesh.neighbor(cell, edge);
    if (j < 0 || local.get(j) < 0) continue;
    visit(
      local.get(j),
      (length ** 2 * mesh.faceLength(cell, edge)) / mesh.faceDistance(cell, edge)
    );
  }
}
export function metricOperator(map: PhysicalField, length: number, active?: Band): MetricOperator {
  const { cells, local } = metricCells(map, active),
    count = cells.length,
    offsets = metricArray(map, "offsets", count + 1, "int32");
  // Count faces first so the face arrays are allocated once at their exact length.
  let faces = 0;
  for (let i = 0; i < count; i++) {
    offsets.set(i, faces);
    visitFaces(map, length, cells.get(i), local, () => faces++);
  }
  offsets.set(count, faces);
  const areas = metricArray(map, "areas", count),
    diagonal = metricArray(map, "diagonal", count),
    neighbors = metricArray(map, "neighbors", faces, "int32"),
    weights = metricArray(map, "weights", faces);
  for (let i = 0; i < count; i++) {
    const cell = cells.get(i),
      area = map.mesh.area(cell);
    let at = offsets.get(i),
      sum = area;
    areas.set(i, area);
    visitFaces(map, length, cell, local, (j, weight) => {
      neighbors.set(at, j);
      weights.set(at++, weight);
      sum += weight;
    });
    diagonal.set(i, sum);
  }
  releaseWorking(map, local);
  return { map, count, cells, areas, diagonal, offsets, neighbors, weights };
}
/** result = A · values over the local numbering. */
export function metricProduct(matrix: MetricOperator, values: Band, result: Band) {
  const { count, neighbors, weights, offsets, areas } = matrix;
  for (let i = 0; i < count; i++) {
    const value = values.get(i),
      end = offsets.get(i + 1);
    let sum = value * areas.get(i);
    for (let at = offsets.get(i); at < end; at++)
      sum += (value - values.get(neighbors.get(at))) * weights.get(at);
    result.set(i, sum);
  }
}
