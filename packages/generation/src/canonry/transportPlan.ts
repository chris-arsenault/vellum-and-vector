// PlateAdvectionLayer.MaterialTransportPlan, Canonry 0f62584c.
import type { PhysicalField } from "./field";
import { nearestTriangle, meshDeltaX, meshPoint } from "./mesh";
import { clamp, round } from "./math";
import { adaptiveCell, visitAdaptiveOverlap, type Bounds } from "@atlas/domain";
import { triangleOverlap } from "./triangleOverlap";
import { tectonicTransport } from "./tectonicTransport";
import { BandList, type Band } from "@atlas/domain";
import { workingArray } from "./physicalNumerics";

export const weightScale = 1_000_000;
/** Where each cell's material goes, as a compressed row per source cell; all bands. */
export interface TransportPlan {
  offsets: Band;
  targets: Band;
  weights: Band;
  arrivals: Band;
  dominant: Band;
  dominantWeight: Band;
}
type Builder = Omit<TransportPlan, "targets" | "weights"> & {
  targets: BandList;
  weights: BandList;
};
function add(map: PhysicalField, plan: Builder, source: number, target: number, weight: number) {
  if (weight <= 0) return;
  plan.targets.push(target);
  plan.weights.push(weight);
  const contribution = (weight * map.mesh.area(source)) / map.mesh.area(target);
  plan.arrivals.add(target, contribution);
  const dominantWeight = plan.dominantWeight.get(target);
  if (
    contribution > dominantWeight ||
    (contribution === dominantWeight && source < plan.dominant.get(target))
  ) {
    plan.dominant.set(target, source);
    plan.dominantWeight.set(target, contribution);
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
  const distance2 = (i: number) => meshDeltaX(mesh, mesh.x(i) - x) ** 2 + (mesh.y(i) - y) ** 2;
  if (distance2(nearest) < 0.00000001) {
    add(map, plan, source, nearest, weightScale);
    return;
  }
  const candidates = [nearest];
  for (let edge = 0; edge < mesh.degree(nearest); edge++) {
    const j = mesh.neighbor(nearest, edge);
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
    x + mesh.origin[0] - mesh.cellWidth(source) / 2,
    y + mesh.origin[1] - mesh.cellHeight(source) / 2,
    x + mesh.origin[0] + mesh.cellWidth(source) / 2,
    y + mesh.origin[1] + mesh.cellHeight(source) / 2,
  ];
  visitAdaptiveOverlap(topology, box, (leaf) => {
    const old = adaptiveCell(topology, leaf);
    const area =
      (Math.min(box[2], old[2]) - Math.max(box[0], old[0])) *
      (Math.min(box[3], old[3]) - Math.max(box[1], old[1]));
    add(map, plan, source, mesh.leafToCell(leaf), (area / mesh.area(source)) * weightScale);
  });
}
export function buildTransportPlan(map: PhysicalField, step: number): TransportPlan {
  const count = map.mesh.count;
  const transform = tectonicTransport(map, step);
  const plan: Builder = {
    offsets: workingArray(map, "int32", "transport:offsets", count + 1),
    targets: new BandList(map.coverage, "int32", "transport:targets"),
    weights: new BandList(map.coverage, "float64", "transport:weights"),
    arrivals: workingArray(map, "float64", "transport:arrivals"),
    dominant: workingArray(map, "int32", "transport:dominant").fill(-1),
    dominantWeight: workingArray(map, "float64", "transport:dominantWeight"),
  };
  for (let i = 0; i < count; i++) {
    plan.offsets.set(i, plan.targets.length);
    const move = transform ? (x: number, y: number) => transform(i, x, y) : undefined;
    const [x, y] = move
      ? move(map.mesh.x(i), map.mesh.y(i))
      : [
          map.mesh.x(i) + (map.CrustMotionX.get(i) * step) / 1000,
          map.mesh.y(i) + (map.CrustMotionY.get(i) * step) / 1000,
        ];
    (map.mesh.topology ? scatterVolume : scatter)(map, plan, i, x, y, move);
  }
  plan.offsets.set(count, plan.targets.length);
  const ready: TransportPlan = {
    ...plan,
    targets: plan.targets.finish(),
    weights: plan.weights.finish(),
  };
  for (const band of planBands(ready)) band.retain();
  return ready;
}
function planBands(plan: TransportPlan) {
  return [
    plan.offsets,
    plan.targets,
    plan.weights,
    plan.arrivals,
    plan.dominant,
    plan.dominantWeight,
  ];
}
/** Give a plan's bands back to the coverage. */
export function releaseTransportPlan(map: PhysicalField, plan: TransportPlan) {
  for (const band of planBands(plan)) map.coverage.release(band);
}
