// LandscapeSurface.cs and LandscapeInitializationLayer.cs, Canonry 0f62584c.
import { reconcileWater, type PhysicalField } from "./field";

export function rebuild(map: PhysicalField, i: number) {
  map.Elevation[i] = map.BedrockElevation[i] + map.SedimentThickness[i];
  reconcileWater(map, i);
}
export function erode(map: PhysicalField, i: number, requested: number): number {
  if (requested <= 0) return 0;
  const sediment = Math.min(requested, map.SedimentThickness[i]);
  map.SedimentThickness[i] -= sediment;
  const bedrock = requested - sediment;
  map.BedrockElevation[i] -= bedrock;
  if (bedrock > 0) map.SurfaceRockLoad[i] -= bedrock;
  rebuild(map, i);
  return requested;
}
export function deposit(map: PhysicalField, i: number, requested: number): number {
  const deposited = Math.max(0, requested);
  map.SedimentThickness[i] += deposited;
  map.CumulativeDeposition[i] += deposited;
  map.SedimentDepositedTotal += deposited;
  rebuild(map, i);
  return deposited;
}
export function initializeLandscape(map: PhysicalField) {
  map.RockResistance.fill(1000);
  for (const name of [
    "SedimentThickness",
    "SedimentSupply",
    "CumulativeFluvialErosion",
    "CumulativeGlacialErosion",
    "CumulativeGlacialDeposition",
    "CumulativeCoastalErosion",
    "CumulativeDeposition",
    "MaximumIceThickness",
    "MaximumIceFlux",
    "WaveExposureHistory",
    "GeothermalHistory",
    "VolcanicActivity",
    "VolcanicConstructionHistory",
    "ExternalHeatForcing",
    "ExternalCoastalForcing",
    "ExternalCoastalForcingHistory",
  ] as const)
    map[name].fill(0);
  map.VolcanicLastActiveEpoch.fill(-1);
  map.CompletedEpochCount = 0;
  map.SedimentProducedTotal = 0;
  map.SedimentDepositedTotal = 0;
  map.SedimentExportedTotal = 0;
  map.BedrockElevation.set(map.Elevation);
  map.CrustSupportElevation.set(map.Elevation);
  map.TectonicActivityHistory.set(map.TectonicStrain);
  map.CrustSupportInitialized = true;
}
export function validateLandscape(map: PhysicalField) {
  for (let i = 0; i < map.mesh.count; i++) {
    const invalid = [
      map.SedimentThickness[i],
      map.CumulativeFluvialErosion[i],
      map.CumulativeGlacialErosion[i],
      map.CumulativeGlacialDeposition[i],
      map.CumulativeCoastalErosion[i],
      map.CumulativeDeposition[i],
    ].some((v) => v < 0);
    if (invalid || map.Elevation[i] !== map.BedrockElevation[i] + map.SedimentThickness[i])
      throw new Error("Persistent landscape state is inconsistent.");
  }
  if (
    map.SedimentProducedTotal < 0 ||
    map.SedimentDepositedTotal < 0 ||
    map.SedimentExportedTotal < 0 ||
    map.SedimentDepositedTotal + map.SedimentExportedTotal > map.SedimentProducedTotal
  )
    throw new Error("Sediment accounting is inconsistent.");
}
