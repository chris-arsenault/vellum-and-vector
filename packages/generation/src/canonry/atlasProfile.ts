import type { Epoch } from "@atlas/domain";
import { physicalProfile, type PhysicalProfile } from "./profile";
import { clamp, round } from "./math";

export const atlasQuality = {
  draft: { triangles: 16384, samples: 192 },
  standard: { triangles: 65536, samples: 384 },
  fine: { triangles: 262144, samples: 768 },
};
// Canonry's 128-radius seed requests 49,537 kernel cells, each with 24 physical
// triangles. Scale authored horizontal distances to the requested mesh density;
// elevations remain metres. The algorithms and their dimensionless parameters stay intact.
const referenceTriangles = 1188888;
const distances = [
  "ContinentalTransitionWidth",
  "ContinentalWarpScale",
  "ContinentalWarpStrength",
  "RidgeWidth",
  "CoastalDetailScale",
  "InteriorReliefScale",
  "ElevationVariationScale",
  "CollisionRangeWidth",
  "SubductionRangeWidth",
  "RiftShoulderDistance",
  "TransformRangeWidth",
  "OrogenicAlongStrikeScale",
  "ImpactMinimumRadius",
  "ImpactMaximumRadius",
  "ImpactMinimumSpacing",
  "ImpactThermalRadiusThreshold",
  "PlumeLobeScale",
  "WarmthPocketMinRadius",
  "WarmthPocketMaxRadius",
  "HeartWarmthRadius",
  "SeaIceVariationScale",
  "MantlePlumeRadius",
  "MantlePlumeMinimumSpacing",
  "VolcanicConeRadius",
] as const;
const steps = [
  "BoundaryPaddingSteps",
  "ContinentalSutureDetectionReach",
  "MarginInfluenceReach",
  "CrustAgeSaturationDistance",
  "PassiveShelfWidth",
  "RiftedShelfWidth",
  "TransformShelfWidth",
  "ContinentalSlopeWidth",
  "ContinentalRiseMinimumWidth",
  "OrogenicInfluenceReach",
  "OceanModerationDistance",
  "OceanMoistureDistance",
  "MantlePlumeDriftPerEpoch",
  "OceanCurrentFetchSteps",
  "DrainageGuidanceLookaheadSteps",
] as const;
export function atlasPhysicalProfile(triangles: number): PhysicalProfile {
  const profile = structuredClone(physicalProfile),
    scale = Math.sqrt(triangles / referenceTriangles);
  for (const key of distances) profile[key] = Math.max(1, physicalProfile[key] * scale);
  for (const key of steps) profile[key] = Math.max(1, round(physicalProfile[key] * scale));
  // Slope controls describe height per lattice step, so a coarser mesh permits
  // the same geographic gradient over its longer steps.
  profile.MassWastingStableStep /= scale;
  profile.FluvialEquilibriumStep /= scale;
  profile.CoastalDetailWarp *= scale;
  profile.TectonicProvinceCount = 42;
  profile.TemperatureBaseline = 450;
  profile.HeartWarmthStrength = 0;
  profile.WarmthPocketCount = 0;
  profile.QualityTargets.LandIceCoverage.target = 0.14;
  return profile;
}
// Atlas temperatures are Celsius; the native snow threshold (300) represents
// zero Celsius, with ten native climate units per degree. Epoch settings are
// absolute baseline temperature, sea-level metres and dimensionless strengths.
export function atlasEpoch(epoch: Epoch) {
  return {
    StableName: epoch.id,
    TectonicStrength: round(clamp(epoch.tectonics, 0, 1) * 1000),
    HydrologyStrength: round(clamp(epoch.hydrology, 0, 1) * 1000),
    GlaciationStrength: round(clamp(epoch.ice, 0, 1) * 1000),
    CoastalStrength: round(clamp(epoch.coasts, 0, 1) * 1000),
    TemperatureOffset: round((epoch.temperature - 15) * 10),
    SeaLevelOffset: round(epoch.seaLevel),
  };
}
