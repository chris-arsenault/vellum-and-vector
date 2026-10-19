// PlateAdvectionLayer.HistorySnapshot and TransportAccumulator, Canonry 0f62584c.
import type { PhysicalField } from "./field";
import { clamp, truncate, units } from "./math";
import { weightScale, type TransportPlan } from "./transportPlan";

const intensive = [
  "BedrockElevation",
  "CrustThickness",
  "CrustSupportElevation",
  "CrustContinentalFraction",
  "CrustAge",
  "RockResistance",
  "CrustSutureStrength",
  "ImpactHeat",
] as const;
const extensive = [
  "SurfaceRockLoad",
  "SedimentThickness",
  "SedimentSupply",
  "CumulativeFluvialErosion",
  "CumulativeGlacialErosion",
  "CumulativeGlacialDeposition",
  "CumulativeCoastalErosion",
  "CumulativeDeposition",
  "ImpactExcavation",
  "ImpactRimUplift",
  "ImpactEjectaThickness",
  "VolcanicConstructionHistory",
  "TectonicActivityHistory",
] as const;
const maxima = [
  "GeothermalHistory",
  "WaveExposureHistory",
  "MaximumIceThickness",
  "MaximumIceFlux",
  "MaximumGroundedIceFlux",
  "ExternalCoastalForcingHistory",
] as const;
const categories = [
  "CrustAssemblyIds",
  "CrustSuturePairIds",
  "VolcanicLastActiveEpoch",
  "FeatureFlags",
] as const;
const weighted = [...intensive, ...extensive] as const;
type Channel =
  | (typeof intensive)[number]
  | (typeof extensive)[number]
  | (typeof maxima)[number]
  | (typeof categories)[number];
type Accumulator = Record<Channel, Float64Array> & {
  assemblyContribution: Float64Array;
  sutureContribution: Float64Array;
};
function accumulator(count: number): Accumulator {
  const fields = Object.fromEntries(
    [...intensive, ...extensive, ...maxima, ...categories].map((name) => [
      name,
      new Float64Array(count),
    ])
  );
  return {
    ...fields,
    assemblyContribution: new Float64Array(count),
    sutureContribution: new Float64Array(count),
    VolcanicLastActiveEpoch: new Float64Array(count).fill(-1),
  } as Accumulator;
}
function addAssembly(
  a: Accumulator,
  map: PhysicalField,
  source: number,
  target: number,
  weight: number
) {
  const id = map.CrustAssemblyIds[source],
    fraction = map.CrustContinentalFraction[source];
  const contribution = weight * fraction;
  if (
    id > 0 &&
    fraction > 0 &&
    (contribution > a.assemblyContribution[target] ||
      (contribution === a.assemblyContribution[target] && id < a.CrustAssemblyIds[target]))
  ) {
    a.CrustAssemblyIds[target] = id;
    a.assemblyContribution[target] = contribution;
  }
}
function addSuture(
  a: Accumulator,
  map: PhysicalField,
  source: number,
  target: number,
  weight: number
) {
  const pair = map.CrustSuturePairIds[source],
    strength = map.CrustSutureStrength[source];
  const contribution = weight * strength;
  if (
    pair <= 0 ||
    strength <= 0 ||
    contribution < a.sutureContribution[target] ||
    (contribution === a.sutureContribution[target] && pair >= a.CrustSuturePairIds[target])
  )
    return;
  a.CrustSuturePairIds[target] = pair;
  a.sutureContribution[target] = contribution;
}
function addSource(
  a: Accumulator,
  map: PhysicalField,
  source: number,
  target: number,
  weight: number
) {
  const areaWeight = (weight * map.mesh.areas[source]) / map.mesh.areas[target];
  for (const name of weighted) a[name][target] += map[name][source] * areaWeight;
  for (const name of maxima) a[name][target] = Math.max(a[name][target], map[name][source]);
  addAssembly(a, map, source, target, weight);
  addSuture(a, map, source, target, weight);
  if (weight >= weightScale / 20) {
    a.VolcanicLastActiveEpoch[target] = Math.max(
      a.VolcanicLastActiveEpoch[target],
      map.VolcanicLastActiveEpoch[source]
    );
    a.FeatureFlags[target] |= map.FeatureFlags[source];
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
    return truncate((sum + fresh * (weightScale - arrival)) / weightScale);
  return truncate(sum / arrival);
}
function freshValue(name: (typeof intensive)[number]): number {
  if (name === "BedrockElevation" || name === "CrustSupportElevation") return units(-200);
  if (name === "CrustThickness") return units(1000);
  return name === "RockResistance" ? 1000 : 0;
}
function completeTarget(a: Accumulator, map: PhysicalField, target: number, arrival: number) {
  const boundary = map.TectonicBoundaryCodes[target];
  for (const name of intensive)
    map[name][target] = finalize(a[name][target], arrival, freshValue(name), boundary, false);
  for (const name of extensive) {
    const value = finalize(a[name][target], arrival, 0, boundary, true);
    map[name][target] =
      name === "TectonicActivityHistory" ? clamp(value, -2147483648, 2147483647) : value;
  }
  for (const name of maxima) map[name][target] = a[name][target];
  if (boundary === 1 && arrival > weightScale)
    map.ConvergentCrustSurplus[target] = truncate(
      (a.CrustThickness[target] - truncate(a.CrustThickness[target] / arrival) * weightScale) /
        weightScale
    );
  map.CrustAssemblyIds[target] =
    map.CrustContinentalFraction[target] > 0 ? a.CrustAssemblyIds[target] : 0;
  map.CrustSuturePairIds[target] =
    map.CrustSutureStrength[target] > 0 ? a.CrustSuturePairIds[target] : 0;
  map.VolcanicLastActiveEpoch[target] = a.VolcanicLastActiveEpoch[target];
  map.FeatureFlags[target] = a.FeatureFlags[target];
  if (map.VolcanicConstructionHistory[target] <= 0) {
    map.FeatureFlags[target] &= ~((1 << 8) | (1 << 9) | (1 << 10));
    map.VolcanicLastActiveEpoch[target] = -1;
  }
}
export function transportHistory(map: PhysicalField, plan: TransportPlan) {
  const a = accumulator(map.mesh.count);
  for (let source = 0; source < map.mesh.count; source++)
    for (let offset = plan.offsets[source]; offset < plan.offsets[source + 1]; offset++) {
      const target = plan.targets[offset];
      if (target >= 0) addSource(a, map, source, target, plan.weights[offset]);
    }
  for (let target = 0; target < map.mesh.count; target++)
    completeTarget(a, map, target, plan.arrivals[target]);
}
