import type { PhysicalField } from "./field";
import type { Band } from "@atlas/domain";
import {
  metricArray,
  metricOperator,
  metricProduct,
  releaseMetric,
  type MetricOperator,
} from "./metricOperator";
import { prepareMultigrid } from "./metricMultigrid";
import { releaseWorking } from "./physicalNumerics";

function dot(a: Band, b: Band) {
  let sum = 0;
  for (let i = 0; i < a.length; i++) sum += a.get(i) * b.get(i);
  return sum;
}
function conserveComponents(matrix: MetricOperator, input: Band, result: Band) {
  const n = input.length,
    visited = new Uint8Array(n),
    queue = new Int32Array(n);
  for (let start = 0; start < n; start++) {
    if (visited[start]) continue;
    queue[0] = start;
    let tail = 1;
    visited[start] = 1;
    let imbalance = 0,
      area = 0;
    for (let head = 0; head < tail; head++) {
      const i = queue[head],
        cellArea = matrix.areas.get(i);
      imbalance += (input.get(i) - result.get(i)) * cellArea;
      area += cellArea;
      const end = matrix.offsets.get(i + 1);
      for (let at = matrix.offsets.get(i); at < end; at++) {
        const j = matrix.neighbors[at];
        if (visited[j]) continue;
        visited[j] = 1;
        queue[tail++] = j;
      }
    }
    for (let at = 0; at < tail; at++) result.add(queue[at], imbalance / area);
  }
}
function solve(
  matrix: MetricOperator,
  input: Band,
  condition: ReturnType<typeof prepareMultigrid>
) {
  const map = matrix.map,
    n = input.length,
    array = (name: string) => metricArray(map, name, n);
  const result = array("result"),
    projected = array("product");
  result.copyFrom(input);
  metricProduct(matrix, result, projected);
  const rhs = array("solve-rhs"),
    residual = array("residual"),
    direction = array("direction");
  for (let i = 0; i < n; i++) {
    const value = input.get(i) * matrix.areas.get(i);
    rhs.set(i, value);
    residual.set(i, value - projected.get(i));
  }
  direction.copyFrom(condition(residual));
  let error = dot(residual, direction);
  const norm = (values: Band) => {
    let sum = 0;
    for (let i = 0; i < n; i++) sum += values.get(i) ** 2 / matrix.diagonal.get(i);
    return sum;
  };
  const tolerance = Math.max(1e-12, norm(rhs) * 1e-12);
  // CG converges to the original finite-volume equation, not the coarse approximation.
  for (let iteration = 0; iteration < n && norm(residual) > tolerance; iteration++) {
    metricProduct(matrix, direction, projected);
    const alpha = error / dot(direction, projected);
    for (let i = 0; i < n; i++) {
      result.add(i, alpha * direction.get(i));
      residual.add(i, -alpha * projected.get(i));
    }
    const preconditioned = condition(residual);
    const next = dot(residual, preconditioned),
      beta = next / error;
    for (let i = 0; i < n; i++) direction.set(i, preconditioned.get(i) + beta * direction.get(i));
    error = next;
  }
  conserveComponents(matrix, input, result);
  releaseWorking(map, projected, rhs, residual, direction);
  return result;
}
/** Solve only participating cells; excluded basins/land never enter the matrix. */
export function prepareMetricSmoother(map: PhysicalField, length: number, active?: Band) {
  const matrix = metricOperator(map, length, active),
    condition = prepareMultigrid(matrix);
  const apply = (input: Band) => {
    const local = metricArray(map, "local-input", matrix.cells.length),
      result = metricArray(map, "full-result", input.length);
    result.copyFrom(input);
    for (let i = 0; i < local.length; i++) local.set(i, input.get(matrix.cells[i]));
    const solved = solve(matrix, local, condition);
    matrix.cells.forEach((cell, i) => {
      result.set(cell, solved.get(i));
    });
    releaseWorking(map, local, solved);
    return result;
  };
  return Object.assign(apply, {
    close() {
      condition.close();
      releaseMetric(matrix);
    },
  });
}
/** Finite-volume screened diffusion with physical reach and no flux through excluded faces. */
export function smoothMetric(map: PhysicalField, input: Band, length: number, active?: Band) {
  const smooth = prepareMetricSmoother(map, length, active);
  try {
    return smooth(input);
  } finally {
    smooth.close();
  }
}
