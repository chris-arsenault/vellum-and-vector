// PlateAdvectionLayer.HistorySnapshot and TransportAccumulator, Canonry 0f62584c.
import type { PhysicalField } from "./field";
import { clamp, truncate, units } from "./math";
import { weightScale, type TransportPlan } from "./transportPlan";
import { ecologyCarbon, ecologyMemory, ecologyRatios } from "./ecologyState";

const intensive = [
  ...ecologyRatios,
  "CanopyAge",
  "Evapotranspiration",
  "Productivity",
  "AquaticProductivity",
  "OrganicBurialDepth",
  "OrganicMaturity",
  "BedrockElevation",
  "CrustThickness",
  "CrustSupportElevation",
  "CrustContinentalFraction",
  "CrustAge",
  "RockResistance",
  "CrustSutureStrength",
  "ImpactHeat",
  "Quickening",
  "Stillness",
  "IcePersistence",
  "IceCharge",
  "ExternalUpwelling",
  "ExternalSeaSurfaceForcing",
  "FogForcing",
  "StormForcing",
  "StormTrack",
  "RiverWarmth",
  "EcologyStillness",
] as const;
const extensive = [
  ...ecologyCarbon,
  ...ecologyMemory,
  "Grazers",
  "Browsers",
  "Herbivores",
  "Predators",
  "AquaticFauna",
  "SoilDepth",
  "SoilWater",
  "MineralNutrients",
  "MigrationFlux",
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
  "FractureConductance",
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
type Accumulator = Record<(typeof categories)[number], Float64Array> & {
  assemblyContribution: Float64Array;
  sutureContribution: Float64Array;
};
function accumulator(count: number): Accumulator {
  const fields = Object.fromEntries(
    categories.map((name) => [
      name,
      new Float64Array(count).fill(name === "VolcanicLastActiveEpoch" ? -1 : 0),
    ])
  );
  return {
    ...fields,
    assemblyContribution: new Float64Array(count),
    sutureContribution: new Float64Array(count),
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
function addCategories(
  a: Accumulator,
  map: PhysicalField,
  source: number,
  target: number,
  weight: number
) {
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
    return (sum + fresh * (weightScale - arrival)) / weightScale;
  return sum / arrival;
}
function freshValue(name: (typeof intensive)[number]): number {
  if (name === "BedrockElevation" || name === "CrustSupportElevation") return units(-200);
  if (name === "CrustThickness") return units(1000);
  return name === "RockResistance" ? 1000 : 0;
}
function completeCategories(a: Accumulator, map: PhysicalField, target: number) {
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

/** Each source channel stays intact until its complete scatter has been accumulated. */
function accumulateChannel(
  map: PhysicalField,
  plan: TransportPlan,
  name: (typeof intensive)[number] | (typeof extensive)[number] | (typeof maxima)[number],
  scratch: Float64Array,
  areaWeights?: Float64Array
) {
  scratch.fill(0);
  const values = map[name];
  for (let source = 0; source < map.mesh.count; source++)
    for (let offset = plan.offsets[source]; offset < plan.offsets[source + 1]; offset++) {
      const target = plan.targets[offset];
      if (target < 0) continue;
      if (areaWeights) scratch[target] += values[source] * areaWeights[offset];
      else scratch[target] = Math.max(scratch[target], values[source]);
    }
}
function completeIntensive(
  map: PhysicalField,
  plan: TransportPlan,
  name: (typeof intensive)[number],
  scratch: Float64Array
) {
  for (let target = 0; target < map.mesh.count; target++) {
    const arrival = plan.arrivals[target],
      boundary = map.TectonicBoundaryCodes[target];
    if (name === "CrustThickness" && boundary === 1 && arrival > weightScale)
      map.ConvergentCrustSurplus[target] = truncate(
        (scratch[target] - truncate(scratch[target] / arrival) * weightScale) / weightScale
      );
    map[name][target] = finalize(scratch[target], arrival, freshValue(name), boundary, false);
  }
}
function completeExtensive(
  map: PhysicalField,
  plan: TransportPlan,
  name: (typeof extensive)[number],
  scratch: Float64Array
) {
  for (let target = 0; target < map.mesh.count; target++) {
    const value = finalize(scratch[target], plan.arrivals[target], 0, 0, true);
    map[name][target] =
      name === "TectonicActivityHistory" ? clamp(value, -2147483648, 2147483647) : value;
  }
}
export function transportHistory(map: PhysicalField, plan: TransportPlan) {
  const a = accumulator(map.mesh.count),
    scratch = new Float64Array(map.mesh.count),
    areaWeights = new Float64Array(plan.weights.length);
  const biomes = map.BiomeCodes.slice();
  // Resolve labels before their source fractions/strengths are transported in place.
  for (let source = 0; source < map.mesh.count; source++)
    for (let offset = plan.offsets[source]; offset < plan.offsets[source + 1]; offset++) {
      const target = plan.targets[offset];
      if (target < 0) continue;
      areaWeights[offset] =
        (plan.weights[offset] * map.mesh.areas[source]) / map.mesh.areas[target];
      addCategories(a, map, source, target, plan.weights[offset]);
    }
  for (const name of intensive) {
    accumulateChannel(map, plan, name, scratch, areaWeights);
    completeIntensive(map, plan, name, scratch);
  }
  for (const name of extensive) {
    accumulateChannel(map, plan, name, scratch, areaWeights);
    completeExtensive(map, plan, name, scratch);
  }
  for (const name of maxima) {
    accumulateChannel(map, plan, name, scratch);
    map[name].set(scratch);
  }
  for (let target = 0; target < map.mesh.count; target++) {
    completeCategories(a, map, target);
    const source = plan.dominant[target];
    map.BiomeCodes[target] = source >= 0 ? biomes[source] : 0;
  }
}
