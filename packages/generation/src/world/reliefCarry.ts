import type { Band } from "@atlas/domain";
import {
  landCollisionPackage,
  formTransportOpening,
  holdRock,
  releaseHeldRock,
  type Deformation,
  type HeldRock,
} from "../rock/groundTransport";
export { heldLayers, holdRock, releaseHeldRock, type HeldRock } from "../rock/groundTransport";
import { arcCrustYield, collisionAreaShares } from "../rock/crustTransport";
import { remapHeldGround } from "../rock/groundRemap";
import type { PhysicalField } from "./field";
import { releaseWorking, workingArray, workingValues } from "./physicalNumerics";
import { weightScale, type TransportPlan } from "./transportPlan";

/** One interval captures ground before crust transport changes the shared field. */
export interface ReliefCarry extends HeldRock {
  continental: Band;
}
export function beginReliefCarry(map: PhysicalField): ReliefCarry {
  return {
    ...holdRock(map),
    continental: workingValues(map, "uint8", "carry:sourceContinental", (source) => {
      const thickness = map.CrustThickness.get(source),
        continental = map.CrustColumnsInitialized
          ? map.CrustContinentalColumn.get(source)
          : (thickness * map.CrustContinentalFraction.get(source)) / 1000;
      return continental >= Math.max(0, thickness - continental) ? 1 : 0;
    }),
  };
}
interface Arrivals {
  continentalRetained: Band;
  oceanicRetained: Band;
}
const areaWeight = (map: PhysicalField, plan: TransportPlan, source: number, offset: number) =>
  (plan.weights.get(offset) * map.mesh.area(source)) /
  (weightScale * map.mesh.area(plan.targets.get(offset)));
const represented = (map: PhysicalField, target: number) =>
  target >= 0 && map.mesh.area(target) > 0;
const deformation = (plan: TransportPlan, source: number): Deformation => [
  plan.deformationXX.get(source),
  plan.deformationXY.get(source),
  plan.deformationYX.get(source),
  plan.deformationYY.get(source),
];

/** Use the crust owner's distinction between shortening continent and subducting ocean. */
function arrivals(map: PhysicalField, plan: TransportPlan, carry: ReliefCarry): Arrivals {
  const continental = workingArray(map, "float64", "carry:continental").fill(0),
    oceanic = workingArray(map, "float64", "carry:oceanic").fill(1);
  for (let source = 0; source < map.mesh.count; source++) {
    if (!carry.continental.get(source)) continue;
    for (let k = plan.offsets.get(source); k < plan.offsets.get(source + 1); k++) {
      const target = plan.targets.get(k);
      if (target >= 0 && map.mesh.area(target) > 0)
        continental.add(target, areaWeight(map, plan, source, k));
    }
  }
  for (let target = 0; target < map.mesh.count; target++) {
    const total = plan.arrivals.get(target) / weightScale;
    if (map.TectonicBoundaryCodes.get(target) === 1 && total > 1) {
      const shares = collisionAreaShares(continental.get(target), total - continental.get(target));
      continental.set(target, shares.continentalRetained);
      oceanic.set(target, shares.oceanicRetained);
    } else continental.set(target, 1);
  }
  return {
    continentalRetained: continental,
    oceanicRetained: oceanic,
  };
}
/** Invert surviving overlaps once; Ground receives every contributing material section. */
function retainedGround(
  map: PhysicalField,
  plan: TransportPlan,
  carry: ReliefCarry,
  work: Arrivals
) {
  const offsets = workingArray(map, "int32", "carry:offsets", map.mesh.count + 1).fill(0),
    retained = (source: number, target: number) =>
      (carry.continental.get(source) ? work.continentalRetained : work.oceanicRetained).get(target);
  for (let source = 0; source < map.mesh.count; source++)
    for (let k = plan.offsets.get(source); k < plan.offsets.get(source + 1); k++) {
      const target = plan.targets.get(k);
      if (represented(map, target) && retained(source, target) * plan.weights.get(k) > 0)
        offsets.add(target + 1, 1);
    }
  for (let cell = 1; cell <= map.mesh.count; cell++) offsets.add(cell, offsets.get(cell - 1));
  const length = offsets.get(map.mesh.count),
    sources = workingArray(map, "int32", "carry:sources", length),
    weights = workingArray(map, "float64", "carry:weights", length),
    cursor = map.coverage.copyBand(offsets);
  for (let source = 0; source < map.mesh.count; source++) {
    for (let k = plan.offsets.get(source); k < plan.offsets.get(source + 1); k++) {
      const target = plan.targets.get(k);
      if (!represented(map, target)) continue;
      const weight = areaWeight(map, plan, source, k) * retained(source, target);
      if (weight <= 0) continue;
      const at = cursor.get(target);
      sources.set(at, source);
      weights.set(at, weight);
      cursor.add(target, 1);
    }
  }
  releaseWorking(map, cursor);
  return { offsets, sources, weights };
}
function placeArrivals(
  map: PhysicalField,
  plan: TransportPlan,
  carry: ReliefCarry,
  work: Arrivals
) {
  const ground = retainedGround(map, plan, carry, work);
  for (let cell = 0; cell < map.mesh.count; cell++) {
    if (ground.offsets.get(cell) === ground.offsets.get(cell + 1)) formTransportOpening(map, cell);
    else remapHeldGround(map, carry, cell, ground, plan);
  }
  releaseWorking(map, ground.offsets, ground.sources, ground.weights);
}
/** Only physical overlap stacks material, at the cell where its area actually arrived. */
function stackOverlap(map: PhysicalField, plan: TransportPlan, carry: ReliefCarry, work: Arrivals) {
  for (let source = 0; source < map.mesh.count; source++) {
    const continental = carry.continental.get(source) > 0,
      retained = continental ? work.continentalRetained : work.oceanicRetained,
      returned = continental ? 1 : arcCrustYield,
      f = deformation(plan, source);
    for (let k = plan.offsets.get(source); k < plan.offsets.get(source + 1); k++) {
      const target = plan.targets.get(k);
      if (target < 0 || map.mesh.area(target) <= 0) continue;
      const excess = 1 - retained.get(target);
      if (excess > 0)
        landCollisionPackage(
          map,
          carry,
          target,
          source,
          areaWeight(map, plan, source, k) * excess * returned,
          f
        );
    }
  }
}
/** Settle the interval's retained placement and local collisions before another process sees it. */
export function finishReliefCarry(map: PhysicalField, carry: ReliefCarry, plan: TransportPlan) {
  const work = arrivals(map, plan, carry);
  placeArrivals(map, plan, carry, work);
  stackOverlap(map, plan, carry, work);
  releaseHeldRock(map, carry);
  releaseWorking(map, carry.continental, work.continentalRetained, work.oceanicRetained);
}
