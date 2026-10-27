import type { PhysicalMesh } from "./mesh";
import type { NumericalVector, NumericalAllocator } from "@atlas/domain";
import {
  metricArray,
  metricOperator,
  metricProduct,
  releaseMetric,
  type MetricOperator,
} from "./metricOperator";
import { prepareMultigrid } from "./metricMultigrid";
const dot = (a: NumericalVector, b: NumericalVector) =>
  a.reduce((sum, value, i) => sum + value * b[i], 0);
function conserveComponents(
  matrix: MetricOperator,
  input: NumericalVector,
  result: NumericalVector
) {
  const visited = metricArray("visited", input.length, "uint8", matrix.numerical),
    queue = metricArray("component", input.length, "int32", matrix.numerical);
  for (let start = 0; start < input.length; start++) {
    if (visited[start]) continue;
    queue[0] = start;
    let tail = 1;
    visited[start] = 1;
    let imbalance = 0,
      area = 0;
    for (let head = 0; head < tail; head++) {
      const i = queue[head];
      imbalance += (input[i] - result[i]) * matrix.areas[i];
      area += matrix.areas[i];
      for (let at = matrix.offsets[i]; at < matrix.offsets[i + 1]; at++) {
        const j = matrix.neighbors[at];
        if (visited[j]) continue;
        visited[j] = 1;
        queue[tail++] = j;
      }
    }
    for (let at = 0; at < tail; at++) result[queue[at]] += imbalance / area;
  }
  matrix.numerical?.releaseUnused([visited, queue], []);
}
function solve(
  matrix: MetricOperator,
  input: NumericalVector,
  condition: ReturnType<typeof prepareMultigrid>
) {
  const array = (name: string) => metricArray(name, input.length, "float64", matrix.numerical);
  const result = array("result"),
    projected = array("product");
  result.set(input);
  metricProduct(matrix, result, projected);
  const rhs = array("solve-rhs"),
    residual = array("residual"),
    direction = array("direction");
  for (let i = 0; i < input.length; i++) {
    rhs[i] = input[i] * matrix.areas[i];
    residual[i] = rhs[i] - projected[i];
  }
  direction.set(condition(residual));
  let error = dot(residual, direction);
  const norm = (values: NumericalVector) =>
    values.reduce((sum, value, i) => sum + (value * value) / matrix.diagonal[i], 0);
  const tolerance = Math.max(1e-12, norm(rhs) * 1e-12);
  // CG converges to the original finite-volume equation, not the coarse approximation.
  for (let iteration = 0; iteration < input.length && norm(residual) > tolerance; iteration++) {
    metricProduct(matrix, direction, projected);
    const alpha = error / dot(direction, projected);
    for (let i = 0; i < input.length; i++) {
      result[i] += alpha * direction[i];
      residual[i] -= alpha * projected[i];
    }
    const preconditioned = condition(residual);
    const next = dot(residual, preconditioned),
      beta = next / error;
    for (let i = 0; i < input.length; i++) direction[i] = preconditioned[i] + beta * direction[i];
    error = next;
  }
  conserveComponents(matrix, input, result);
  matrix.numerical?.releaseUnused([projected, rhs, residual, direction], []);
  return result;
}
/** Solve only participating cells; excluded basins/land never enter the matrix. */
export function prepareMetricSmoother(
  mesh: PhysicalMesh,
  length: number,
  active?: NumericalVector,
  numerical?: NumericalAllocator
) {
  const matrix = metricOperator(mesh, length, active, numerical),
    condition = prepareMultigrid(matrix);
  const apply = (input: NumericalVector) => {
    const local = metricArray("local-input", matrix.cells.length, "float64", numerical),
      result = metricArray("full-result", input.length, "float64", numerical);
    result.set(input);
    for (let i = 0; i < local.length; i++) local[i] = input[matrix.cells[i]];
    const solved = solve(matrix, local, condition);
    matrix.cells.forEach((cell, i) => {
      result[cell] = solved[i];
    });
    numerical?.releaseUnused([local, solved], []);
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
export function smoothMetric(
  mesh: PhysicalMesh,
  input: NumericalVector,
  length: number,
  active?: NumericalVector,
  numerical?: NumericalAllocator
) {
  const smooth = prepareMetricSmoother(mesh, length, active, numerical);
  try {
    return smooth(input);
  } finally {
    smooth.close();
  }
}
