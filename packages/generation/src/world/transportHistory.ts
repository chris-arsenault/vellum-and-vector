// PlateAdvectionLayer.HistorySnapshot and TransportAccumulator, Canonry 0f62584c.
import type { PhysicalBufferName, PhysicalField } from "./field";
import { clamp } from "./math";
import { weightScale, type TransportPlan } from "./transportPlan";
import { captureCrustColumns, transportCrustColumns } from "./crustTransport";
import type { Band } from "@atlas/domain";
import { workingArray, releaseWorking } from "./physicalNumerics";
import { freshCrustValue, quantitiesOfKind } from "../coupling/quantities";

const shares = quantitiesOfKind("share"),
  amounts = quantitiesOfKind("amount"),
  peaks = quantitiesOfKind("peak");
/** Identities that take more than the crust that mostly arrived: see `addCategories`. */
const categories = [
  "CrustAssemblyIds",
  "CrustPlateIds",
  "CrustSuturePairIds",
  "VolcanicLastActiveEpoch",
  "FeatureFlags",
] as const;
/** Every other identity moves with the crust that mostly arrived, so a new one moves by being one. */
const dominantIdentities = quantitiesOfKind("identity").filter(
  (name) => !(categories as readonly string[]).includes(name)
);
type Accumulator = Record<(typeof categories)[number], Band> & {
  assemblyContribution: Band;
  plateContribution: Band;
  sutureContribution: Band;
};
function accumulator(map: PhysicalField): Accumulator {
  const fields = Object.fromEntries(
    categories.map((name) => [
      name,
      workingArray(map, "float64", `transport:${name}`).fill(
        name === "VolcanicLastActiveEpoch" ? -1 : 0
      ),
    ])
  );
  return {
    ...fields,
    assemblyContribution: workingArray(map, "float64", "transport:assemblyContribution"),
    plateContribution: workingArray(map, "float64", "transport:plateContribution"),
    sutureContribution: workingArray(map, "float64", "transport:sutureContribution"),
  } as Accumulator;
}
function addAssembly(
  a: Accumulator,
  map: PhysicalField,
  source: number,
  target: number,
  weight: number
) {
  const id = map.CrustAssemblyIds.get(source),
    fraction = map.CrustContinentalFraction.get(source);
  const contribution = weight * fraction,
    held = a.assemblyContribution.get(target);
  if (
    id > 0 &&
    fraction > 0 &&
    (contribution > held || (contribution === held && id < a.CrustAssemblyIds.get(target)))
  ) {
    a.CrustAssemblyIds.set(target, id);
    a.assemblyContribution.set(target, contribution);
  }
}
function addSuture(
  a: Accumulator,
  map: PhysicalField,
  source: number,
  target: number,
  weight: number
) {
  const pair = map.CrustSuturePairIds.get(source),
    strength = map.CrustSutureStrength.get(source);
  const contribution = weight * strength,
    held = a.sutureContribution.get(target);
  if (
    pair <= 0 ||
    strength <= 0 ||
    contribution < held ||
    (contribution === held && pair >= a.CrustSuturePairIds.get(target))
  )
    return;
  a.CrustSuturePairIds.set(target, pair);
  a.sutureContribution.set(target, contribution);
}
function addCategories(
  a: Accumulator,
  map: PhysicalField,
  source: number,
  target: number,
  weight: number
) {
  addAssembly(a, map, source, target, weight);
  addSuture(a, map, source, target, weight);
  if (weight > a.plateContribution.get(target)) {
    a.CrustPlateIds.set(target, map.CrustPlateIds.get(source));
    a.plateContribution.set(target, weight);
  }
  if (weight >= weightScale / 20) {
    a.VolcanicLastActiveEpoch.set(
      target,
      Math.max(a.VolcanicLastActiveEpoch.get(target), map.VolcanicLastActiveEpoch.get(source))
    );
    a.FeatureFlags.set(target, a.FeatureFlags.get(target) | map.FeatureFlags.get(source));
  }
}
function finalize(
  sum: number,
  arrival: number,
  fresh: number,
  boundary: number,
  isExtensive: boolean
): number {
  if (arrival <= 0) return fresh;
  if (isExtensive) return sum / weightScale;
  if (boundary === 2 && arrival < weightScale)
    return (sum + fresh * (weightScale - arrival)) / weightScale;
  return sum / arrival;
}
function completeCategories(a: Accumulator, map: PhysicalField, target: number) {
  map.CrustPlateIds.set(target, a.CrustPlateIds.get(target));
  map.CrustAssemblyIds.set(
    target,
    map.CrustContinentalFraction.get(target) > 0 ? a.CrustAssemblyIds.get(target) : 0
  );
  map.CrustSuturePairIds.set(
    target,
    map.CrustSutureStrength.get(target) > 0 ? a.CrustSuturePairIds.get(target) : 0
  );
  map.VolcanicLastActiveEpoch.set(target, a.VolcanicLastActiveEpoch.get(target));
  map.FeatureFlags.set(target, a.FeatureFlags.get(target));
  if (map.VolcanicConstructionHistory.get(target) <= 0) {
    map.FeatureFlags.set(target, map.FeatureFlags.get(target) & ~((1 << 8) | (1 << 9) | (1 << 10)));
    map.VolcanicLastActiveEpoch.set(target, -1);
  }
}

/** Each source channel stays intact until its complete scatter has been accumulated. */
function accumulateChannel(
  map: PhysicalField,
  plan: TransportPlan,
  name: PhysicalBufferName,
  scratch: Band,
  areaWeights?: Band
) {
  scratch.fill(0);
  const values = map[name];
  for (let source = 0; source < map.mesh.count; source++) {
    const value = values.get(source),
      end = plan.offsets.get(source + 1);
    for (let offset = plan.offsets.get(source); offset < end; offset++) {
      const target = plan.targets.get(offset);
      if (target < 0) continue;
      if (areaWeights) scratch.add(target, value * areaWeights.get(offset));
      else scratch.set(target, Math.max(scratch.get(target), value));
    }
  }
}
function completeIntensive(
  map: PhysicalField,
  plan: TransportPlan,
  name: PhysicalBufferName,
  scratch: Band
) {
  const fresh = freshCrustValue(name),
    values = map[name];
  for (let target = 0; target < map.mesh.count; target++) {
    const arrival = plan.arrivals.get(target),
      boundary = map.TectonicBoundaryCodes.get(target);
    values.set(target, finalize(scratch.get(target), arrival, fresh, boundary, false));
  }
}
function completeExtensive(
  map: PhysicalField,
  plan: TransportPlan,
  name: PhysicalBufferName,
  scratch: Band
) {
  const values = map[name];
  for (let target = 0; target < map.mesh.count; target++) {
    const value = finalize(scratch.get(target), plan.arrivals.get(target), 0, 0, true);
    values.set(
      target,
      name === "TectonicActivityHistory" ? clamp(value, -2147483648, 2147483647) : value
    );
  }
}
export function transportHistory(map: PhysicalField, plan: TransportPlan) {
  const crust = captureCrustColumns(map);
  const a = accumulator(map),
    scratch = workingArray(map, "float64", "transport:channel"),
    areaWeights = workingArray(map, "float64", "transport:areaWeights", plan.weights.length);
  const kinds = dominantIdentities.map((name) => map.coverage.copyBand(map[name]));
  // Resolve labels before their source fractions/strengths are transported in place.
  for (let source = 0; source < map.mesh.count; source++) {
    let retained = 0;
    const end = plan.offsets.get(source + 1);
    for (let offset = plan.offsets.get(source); offset < end; offset++) {
      const target = plan.targets.get(offset),
        weight = plan.weights.get(offset);
      if (target < 0) continue;
      areaWeights.set(offset, (weight * map.mesh.area(source)) / map.mesh.area(target));
      addCategories(a, map, source, target, weight);
      retained += weight / weightScale;
    }
    map.SedimentExportedTotal +=
      (Math.max(0, 1 - retained) * map.SedimentSupply.get(source) * map.mesh.area(source)) / 1024;
  }
  for (const name of shares) {
    accumulateChannel(map, plan, name, scratch, areaWeights);
    completeIntensive(map, plan, name, scratch);
  }
  for (const name of amounts) {
    accumulateChannel(map, plan, name, scratch, areaWeights);
    completeExtensive(map, plan, name, scratch);
  }
  for (const name of peaks) {
    accumulateChannel(map, plan, name, scratch);
    map[name].copyFrom(scratch);
  }
  transportCrustColumns(map, plan, crust);
  for (let target = 0; target < map.mesh.count; target++) {
    completeCategories(a, map, target);
    const source = plan.dominant.get(target);
    // A kind is not an amount: a cell takes it from whatever crust mostly arrived there.
    dominantIdentities.forEach((name, n) =>
      map[name].set(target, source >= 0 ? kinds[n].get(source) : 0)
    );
  }
  releaseWorking(map, ...Object.values(crust), ...Object.values(a), scratch, areaWeights, ...kinds);
}
