import type { PhysicalMesh } from "./mesh";
import { metricOperator, metricProduct, type MetricOperator } from "./metricOperator";
import { prepareMultigrid } from "./metricMultigrid";
const dot = (a: Float64Array, b: Float64Array) =>
  a.reduce((sum, value, i) => sum + value * b[i], 0);
function conserveComponents(matrix: MetricOperator, input: Float64Array, result: Float64Array) {
  const visited = new Uint8Array(input.length);
  for (let start = 0; start < input.length; start++) {
    if (visited[start]) continue;
    const queue = [start];
    visited[start] = 1;
    let imbalance = 0,
      area = 0;
    for (let head = 0; head < queue.length; head++) {
      const i = queue[head];
      imbalance += (input[i] - result[i]) * matrix.areas[i];
      area += matrix.areas[i];
      for (let at = matrix.offsets[i]; at < matrix.offsets[i + 1]; at++) {
        const j = matrix.neighbors[at];
        if (visited[j]) continue;
        visited[j] = 1;
        queue.push(j);
      }
    }
    for (const i of queue) result[i] += imbalance / area;
  }
}
function solve(
  matrix: MetricOperator,
  input: Float64Array,
  condition: ReturnType<typeof prepareMultigrid>
) {
  const result = input.slice(),
    projected = new Float64Array(input.length);
  metricProduct(matrix, result, projected);
  const rhs = Float64Array.from(input, (value, i) => value * matrix.areas[i]);
  const residual = Float64Array.from(rhs, (value, i) => value - projected[i]);
  const direction = condition(residual).slice();
  let error = dot(residual, direction);
  const norm = (values: Float64Array) =>
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
  return result;
}
/** Solve only participating cells; excluded basins/land never enter the matrix. */
export function prepareMetricSmoother(mesh: PhysicalMesh, length: number, active?: Uint8Array) {
  const matrix = metricOperator(mesh, length, active),
    condition = prepareMultigrid(matrix);
  return (input: Float64Array) => {
    const local = Float64Array.from(matrix.cells, (cell) => input[cell]),
      result = input.slice();
    const solved = solve(matrix, local, condition);
    matrix.cells.forEach((cell, i) => {
      result[cell] = solved[i];
    });
    return result;
  };
}
/** Finite-volume screened diffusion with physical reach and no flux through excluded faces. */
export function smoothMetric(
  mesh: PhysicalMesh,
  input: Float64Array,
  length: number,
  active?: Uint8Array
) {
  return prepareMetricSmoother(mesh, length, active)(input);
}
