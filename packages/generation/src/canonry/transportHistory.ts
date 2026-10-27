// PlateAdvectionLayer.HistorySnapshot and TransportAccumulator, Canonry 0f62584c.
import type { PhysicalField } from "./field";
import { clamp, units } from "./math";
import { weightScale, type TransportPlan } from "./transportPlan";
import { ecologyCarbon, ecologyMemory, ecologyRatios } from "./ecologyState";
import { captureCrustColumns, transportCrustColumns } from "./crustTransport";
import type { NumericalVector } from "@atlas/domain";
import { workingArray, releaseWorking } from "./physicalNumerics";

const intensive = [
  ...ecologyRatios,
  "CanopyAge",
  "Evapotranspiration",
  "Productivity",
  "AquaticProductivity",
  "OrganicBurialDepth",
  "OrganicMaturity",
  "BedrockElevation",
  "CrustSupportElevation",
  "CrustAge",
  "CrustRiftStrain",
  "CrustRiftAgeMyr",
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
  "Verdure",
  "Salting",
  "LakeMemory",
  "Warding",
  "KeptLine",
  "Tearing",
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
  "Tenure",
  "WalkedRoute",
  "MassDeath",
  "SoilDepth",
  "SoilWater",
  "MineralNutrients",
  "MigrationFlux",
  "SurfaceRockLoad",
  "OceanicSubduction",
  "OceanicSubductionHistory",
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
  "CrustPlateIds",
  "CrustSuturePairIds",
  "VolcanicLastActiveEpoch",
  "FeatureFlags",
] as const;
type Accumulator = Record<(typeof categories)[number], NumericalVector> & {
  assemblyContribution: NumericalVector;
  plateContribution: NumericalVector;
  sutureContribution: NumericalVector;
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
  if (weight > a.plateContribution[target]) {
    a.CrustPlateIds[target] = map.CrustPlateIds[source];
    a.plateContribution[target] = weight;
  }
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
  return name === "RockResistance" ? 1000 : 0;
}
function completeCategories(a: Accumulator, map: PhysicalField, target: number) {
  map.CrustPlateIds[target] = a.CrustPlateIds[target];
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
  scratch: NumericalVector,
  areaWeights?: NumericalVector
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
  scratch: NumericalVector
) {
  for (let target = 0; target < map.mesh.count; target++) {
    const arrival = plan.arrivals[target],
      boundary = map.TectonicBoundaryCodes[target];
    map[name][target] = finalize(scratch[target], arrival, freshValue(name), boundary, false);
  }
}
function completeExtensive(
  map: PhysicalField,
  plan: TransportPlan,
  name: (typeof extensive)[number],
  scratch: NumericalVector
) {
  for (let target = 0; target < map.mesh.count; target++) {
    const value = finalize(scratch[target], plan.arrivals[target], 0, 0, true);
    map[name][target] =
      name === "TectonicActivityHistory" ? clamp(value, -2147483648, 2147483647) : value;
  }
}
export function transportHistory(map: PhysicalField, plan: TransportPlan) {
  const crust = captureCrustColumns(map);
  const a = accumulator(map),
    scratch = workingArray(map, "float64", "transport:channel"),
    areaWeights = workingArray(map, "float64", "transport:areaWeights", plan.weights.length);
  const biomes = map.BiomeCodes.slice();
  // Resolve labels before their source fractions/strengths are transported in place.
  for (let source = 0; source < map.mesh.count; source++) {
    let retained = 0;
    for (let offset = plan.offsets[source]; offset < plan.offsets[source + 1]; offset++) {
      const target = plan.targets[offset];
      if (target < 0) continue;
      areaWeights[offset] =
        (plan.weights[offset] * map.mesh.areas[source]) / map.mesh.areas[target];
      addCategories(a, map, source, target, plan.weights[offset]);
      retained += plan.weights[offset] / weightScale;
    }
    map.SedimentExportedTotal +=
      (Math.max(0, 1 - retained) * map.SedimentSupply[source] * map.mesh.areas[source]) / 1024;
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
  transportCrustColumns(map, plan, crust);
  for (let target = 0; target < map.mesh.count; target++) {
    completeCategories(a, map, target);
    const source = plan.dominant[target];
    map.BiomeCodes[target] = source >= 0 ? biomes[source] : 0;
  }
  releaseWorking(map, ...Object.values(crust), ...Object.values(a), scratch, areaWeights, biomes);
}
