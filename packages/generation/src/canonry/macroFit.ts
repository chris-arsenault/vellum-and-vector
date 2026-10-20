import type { AdaptiveTopology } from "@atlas/domain";

/** Fit displacement, preserving inherited gradients outside composed targets. */
export function fitLandscapeHeights(
  topology: AdaptiveTopology,
  target: Float64Array,
  confidence: Float64Array,
  fixed: Uint8Array,
  length: number,
  precision = 0.1
) {
  const count = target.length,
    diagonal = new Float64Array(count),
    rhs = new Float64Array(count),
    conductance = new Float64Array(topology.neighbors.length);
  for (let i = 0; i < count; i++) {
    const at = topology.leaves[i] * 4,
      box = topology.boxes,
      area = (box[at + 2] - box[at]) * (box[at + 3] - box[at + 1]),
      screen = (area / (length * length)) * Math.max(0.02, confidence[i]);
    diagonal[i] = fixed[i] ? 1 : screen;
    rhs[i] = fixed[i] ? target[i] : screen * target[i];
    if (fixed[i]) continue;
    for (let edge = topology.offsets[i]; edge < topology.offsets[i + 1]; edge++) {
      const j = topology.neighbors[edge],
        weight = topology.faceLengths[edge] / topology.distances[edge],
        gradient = confidence[i] && confidence[j] ? target[i] - target[j] : 0;
      diagonal[i] += weight;
      rhs[i] += weight * gradient;
      if (fixed[j]) rhs[i] += weight * target[j];
      else conductance[edge] = weight;
    }
  }
  return conjugateGradient(topology, diagonal, conductance, rhs, target, precision);
}

function multiply(
  topology: AdaptiveTopology,
  diagonal: Float64Array,
  conductance: Float64Array,
  values: Float64Array,
  result: Float64Array
) {
  for (let i = 0; i < values.length; i++) {
    let value = values[i] * diagonal[i];
    for (let edge = topology.offsets[i]; edge < topology.offsets[i + 1]; edge++)
      value -= conductance[edge] * values[topology.neighbors[edge]];
    result[i] = value;
  }
}
function dot(a: Float64Array, b: Float64Array) {
  let result = 0;
  for (let i = 0; i < a.length; i++) result += a[i] * b[i];
  return result;
}
function precondition(residual: Float64Array, diagonal: Float64Array, result: Float64Array) {
  let error = 0;
  for (let i = 0; i < residual.length; i++) {
    result[i] = residual[i] / diagonal[i];
    error = Math.max(error, Math.abs(result[i]));
  }
  return error;
}
function conjugateGradient(
  topology: AdaptiveTopology,
  diagonal: Float64Array,
  conductance: Float64Array,
  rhs: Float64Array,
  initial: Float64Array,
  precision: number
) {
  const values = initial.slice(),
    product = new Float64Array(values.length),
    residual = new Float64Array(values.length),
    scaled = new Float64Array(values.length);
  multiply(topology, diagonal, conductance, values, product);
  for (let i = 0; i < values.length; i++) residual[i] = rhs[i] - product[i];
  let error = precondition(residual, diagonal, scaled),
    magnitude = dot(residual, scaled);
  const direction = scaled.slice();
  let iterations = 0;
  while (error > precision && iterations < values.length) {
    multiply(topology, diagonal, conductance, direction, product);
    const alpha = magnitude / dot(direction, product);
    for (let i = 0; i < values.length; i++) {
      values[i] += alpha * direction[i];
      residual[i] -= alpha * product[i];
    }
    error = precondition(residual, diagonal, scaled);
    const next = dot(residual, scaled),
      beta = next / magnitude;
    for (let i = 0; i < values.length; i++) direction[i] = scaled[i] + beta * direction[i];
    magnitude = next;
    iterations++;
  }
  if (!Number.isFinite(error) || error > precision)
    throw new Error(`Landscape height fit failed to converge: ${error} metres.`);
  return { values, iterations, error };
}
