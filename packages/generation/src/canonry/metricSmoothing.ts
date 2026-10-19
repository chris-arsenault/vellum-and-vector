import type { PhysicalMesh } from "./mesh";

function product(mesh: PhysicalMesh, values: Float64Array, length: number, active?: Uint8Array) {
  const result = new Float64Array(mesh.count);
  for (let i = 0; i < mesh.count; i++) {
    result[i] = values[i];
    if (active && !active[i]) continue;
    for (let edge = 0; edge < 3; edge++) {
      const at = i * 3 + edge,
        j = mesh.neighbors[at];
      if (j >= 0 && (!active || active[j]))
        result[i] += ((values[i] - values[j]) * 4 * length ** 2) / (3 * mesh.edgeLength[at] ** 2);
    }
  }
  return result;
}
const dot = (a: Float64Array, b: Float64Array) =>
  a.reduce((sum, value, i) => sum + value * b[i], 0);

/** Solve (I - L²∇²)x = input. L is physical reach, never an iteration count. */
export function smoothMetric(
  mesh: PhysicalMesh,
  input: Float64Array,
  length: number,
  active?: Uint8Array
) {
  const result = input.slice(),
    applied = product(mesh, result, length, active);
  const residual = Float64Array.from(input, (value, i) => value - applied[i]);
  let direction = residual.slice(),
    error = dot(residual, residual);
  const tolerance = Math.max(1e-12, dot(input, input) * 1e-12);
  // CG converges in at most matrix dimension iterations in exact arithmetic.
  for (let iteration = 0; iteration < mesh.count && error > tolerance; iteration++) {
    const projected = product(mesh, direction, length, active);
    const alpha = error / dot(direction, projected);
    for (let i = 0; i < mesh.count; i++) {
      result[i] += alpha * direction[i];
      residual[i] -= alpha * projected[i];
    }
    const next = dot(residual, residual),
      beta = next / error;
    direction = Float64Array.from(residual, (value, i) => value + beta * direction[i]);
    error = next;
  }
  return result;
}
