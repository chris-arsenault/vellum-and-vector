// PlateAdvectionLayer.MaterialTransportPlan, Canonry 0f62584c.
import type { PhysicalField } from "./field";
import { nearestTriangle, meshDeltaX, meshPoint } from "./mesh";
import { clamp, round } from "./math";
import { adaptiveCell, visitAdaptiveOverlap, type Bounds } from "@atlas/domain";
import { triangleOverlap } from "./triangleOverlap";
import { tectonicTransport } from "./tectonicTransport";
import type { NumericalVector } from "@atlas/domain";
import { NumericalList } from "./numericalList";
import { workingArray } from "./physicalNumerics";

export const weightScale = 1_000_000;
export interface TransportPlan {
  offsets: NumericalVector;
  targets: NumericalVector;
  weights: NumericalVector;
  arrivals: NumericalVector;
  dominant: NumericalVector;
  dominantWeight: NumericalVector;
}
type Builder = Omit<TransportPlan, "targets" | "weights"> & {
  targets: NumericalList;
  weights: NumericalList;
};
function add(map: PhysicalField, plan: Builder, source: number, target: number, weight: number) {
  if (weight <= 0) return;
  plan.targets.push(target);
  plan.weights.push(weight);
  const contribution = (weight * map.mesh.areas[source]) / map.mesh.areas[target];
  plan.arrivals[target] += contribution;
  if (
    contribution > plan.dominantWeight[target] ||
    (contribution === plan.dominantWeight[target] && source < plan.dominant[target])
  ) {
    plan.dominant[target] = source;
    plan.dominantWeight[target] = contribution;
  }
}
function scatter(
  map: PhysicalField,
  plan: Builder,
  source: number,
  x: number,
  y: number,
  move?: (x: number, y: number) => [number, number]
) {
  const volumes = triangleOverlap(map.mesh, source, x, y, move);
  if (volumes) {
    for (const [target, share] of volumes) add(map, plan, source, target, share * weightScale);
    return;
  }
  [x, y] = meshPoint(map.mesh, x, y);
  const mesh = map.mesh,
    nearest = nearestTriangle(mesh, x, y);
  if (nearest < 0) return;
  const distance2 = (i: number) => meshDeltaX(mesh, mesh.x[i] - x) ** 2 + (mesh.y[i] - y) ** 2;
  if (distance2(nearest) < 0.00000001) {
    add(map, plan, source, nearest, weightScale);
    return;
  }
  const candidates = [nearest];
  for (let edge = 0; edge < mesh.degree[nearest]; edge++) {
    const j = mesh.neighbors[nearest * mesh.stride + edge];
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
    add(map, plan, source, candidates[n], weight);
  }
}
function scatterVolume(map: PhysicalField, plan: Builder, source: number, x: number, y: number) {
  const mesh = map.mesh,
    topology = mesh.topology!;
  const box: Bounds = [
    x + mesh.origin[0] - mesh.cellWidth[source] / 2,
    y + mesh.origin[1] - mesh.cellHeight[source] / 2,
    x + mesh.origin[0] + mesh.cellWidth[source] / 2,
    y + mesh.origin[1] + mesh.cellHeight[source] / 2,
  ];
  visitAdaptiveOverlap(topology, box, (leaf) => {
    const old = adaptiveCell(topology, leaf);
    const area =
      (Math.min(box[2], old[2]) - Math.max(box[0], old[0])) *
      (Math.min(box[3], old[3]) - Math.max(box[1], old[1]));
    add(map, plan, source, mesh.leafToCell[leaf], (area / mesh.areas[source]) * weightScale);
  });
}
export function buildTransportPlan(map: PhysicalField, step: number): TransportPlan {
  const count = map.mesh.count;
  const transform = tectonicTransport(map, step);
  const plan: Builder = {
    offsets: workingArray(map, "int32", "transport:offsets", count + 1),
    targets: new NumericalList("int32", "transport:targets", map.numerical),
    weights: new NumericalList("float64", "transport:weights", map.numerical),
    arrivals: workingArray(map, "float64", "transport:arrivals"),
    dominant: workingArray(map, "int32", "transport:dominant").fill(-1),
    dominantWeight: workingArray(map, "float64", "transport:dominantWeight"),
  };
  try {
    for (let i = 0; i < count; i++) {
      plan.offsets[i] = plan.targets.length;
      const move = transform ? (x: number, y: number) => transform(i, x, y) : undefined;
      const [x, y] = move
        ? move(map.mesh.x[i], map.mesh.y[i])
        : [
            map.mesh.x[i] + (map.CrustMotionX[i] * step) / 1000,
            map.mesh.y[i] + (map.CrustMotionY[i] * step) / 1000,
          ];
      (map.mesh.topology ? scatterVolume : scatter)(map, plan, i, x, y, move);
    }
    plan.offsets[count] = plan.targets.length;
    const ready = {
      ...plan,
      targets: plan.targets.finish(),
      weights: plan.weights.finish(),
    };
    for (const vector of Object.values(ready)) vector.retain?.();
    return ready;
  } finally {
    plan.targets.close();
    plan.weights.close();
  }
}
