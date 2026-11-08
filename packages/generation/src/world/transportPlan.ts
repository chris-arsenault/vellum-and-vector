// PlateAdvectionLayer.MaterialTransportPlan, Canonry 0f62584c.
import type { PhysicalField } from "./field";
import { nearestTriangle, meshDeltaX, meshPoint } from "./mesh";
import { clamp, round } from "./math";
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
  /** Local donor deformation captured before material and province ownership move. */
  deformationXX: Band;
  deformationXY: Band;
  deformationYX: Band;
  deformationYY: Band;
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
    deformationXX: workingArray(map, "float64", "transport:deformationXX"),
    deformationXY: workingArray(map, "float64", "transport:deformationXY"),
    deformationYX: workingArray(map, "float64", "transport:deformationYX"),
    deformationYY: workingArray(map, "float64", "transport:deformationYY"),
  };
  for (let i = 0; i < count; i++) {
    plan.offsets.set(i, plan.targets.length);
    const { move, deformation: f } = transform(i),
      [x, y] = move(map.mesh.x(i), map.mesh.y(i));
    plan.deformationXX.set(i, f[0]);
    plan.deformationXY.set(i, f[1]);
    plan.deformationYX.set(i, f[2]);
    plan.deformationYY.set(i, f[3]);
    scatter(map, plan, i, x, y, move);
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
    plan.deformationXX,
    plan.deformationXY,
    plan.deformationYX,
    plan.deformationYY,
  ];
}
/** Give a plan's bands back to the coverage. */
export function releaseTransportPlan(map: PhysicalField, plan: TransportPlan) {
  for (const band of planBands(plan)) map.coverage.release(band);
}
