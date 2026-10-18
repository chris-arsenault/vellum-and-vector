// PlateAdvectionLayer.MaterialTransportPlan, Canonry 0f62584c.
import type { PhysicalField } from "./field";
import { nearestTriangle } from "./mesh";
import { clamp, round } from "./math";

export const weightScale = 1_000_000;
export interface TransportPlan {
  targets: Int32Array;
  weights: Int32Array;
  arrivals: Int32Array;
  dominant: Int32Array;
  dominantWeight: Int32Array;
}
function add(plan: TransportPlan, source: number, slot: number, target: number, weight: number) {
  if (weight <= 0) return;
  plan.targets[source * 4 + slot] = target;
  plan.weights[source * 4 + slot] = weight;
  plan.arrivals[target] += weight;
  if (
    weight > plan.dominantWeight[target] ||
    (weight === plan.dominantWeight[target] && source < plan.dominant[target])
  ) {
    plan.dominant[target] = source;
    plan.dominantWeight[target] = weight;
  }
}
function scatter(map: PhysicalField, plan: TransportPlan, source: number, x: number, y: number) {
  const mesh = map.mesh,
    nearest = nearestTriangle(mesh, x, y);
  if (nearest < 0) return;
  const distance2 = (i: number) => (mesh.x[i] - x) ** 2 + (mesh.y[i] - y) ** 2;
  if (distance2(nearest) < 0.00000001) {
    add(plan, source, 0, nearest, weightScale);
    return;
  }
  const candidates = [nearest];
  for (let edge = 0; edge < 3; edge++) {
    const j = mesh.neighbors[nearest * 3 + edge];
    if (j >= 0) candidates.push(j);
  }
  const scores = candidates.map((i) => 1 / Math.max(0.0025, distance2(i)) ** 2);
  const total = scores.reduce((a, b) => a + b, 0);
  let remaining = weightScale;
  for (let n = 0; n < candidates.length; n++) {
    const weight =
      n === candidates.length - 1
        ? remaining
        : clamp(round((weightScale * scores[n]) / total), 0, remaining);
    remaining -= weight;
    add(plan, source, n, candidates[n], weight);
  }
}
export function buildTransportPlan(map: PhysicalField, step: number): TransportPlan {
  const count = map.mesh.count;
  const plan: TransportPlan = {
    targets: new Int32Array(count * 4).fill(-1),
    weights: new Int32Array(count * 4),
    arrivals: new Int32Array(count),
    dominant: new Int32Array(count).fill(-1),
    dominantWeight: new Int32Array(count),
  };
  for (let i = 0; i < count; i++)
    scatter(
      map,
      plan,
      i,
      map.mesh.x[i] + (map.CrustMotionX[i] / 1000) * step,
      map.mesh.y[i] + (map.CrustMotionY[i] / 1000) * step
    );
  return plan;
}
