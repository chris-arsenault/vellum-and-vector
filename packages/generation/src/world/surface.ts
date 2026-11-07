// LandscapeSurface.cs and LandscapeInitializationLayer.cs, Canonry 0f62584c.
import { resetRock } from "../rock/rockField";
import { reconcileWater, type PhysicalField } from "./field";

export function rebuild(map: PhysicalField, i: number) {
  map.Elevation.set(i, map.BedrockElevation.get(i) + map.SedimentThickness.get(i));
  reconcileWater(map, i);
}
export function initializeLandscape(map: PhysicalField) {
  resetRock(map);
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
    "LandmarkMaintenance",
    "ExternalHeatForcing",
    "ExternalCoastalForcing",
    "ExternalCoastalForcingHistory",
  ] as const)
    map[name].fill(0);
  map.VolcanicLastActiveEpoch.fill(-1);
  map.CompletedEpochCount = 0;
  map.ThrustSlipOwed.clear();
  map.SedimentProducedTotal = 0;
  map.SedimentDepositedTotal = 0;
  map.SedimentExportedTotal = 0;
  map.BedrockElevation.copyFrom(map.Elevation);
  map.CrustSupportElevation.copyFrom(map.Elevation);
  map.TectonicActivityHistory.copyFrom(map.TectonicStrain);
  map.CrustSupportInitialized = true;
}
export function validateLandscape(map: PhysicalField) {
  for (let i = 0; i < map.mesh.count; i++) {
    const invalid = [
      map.SedimentThickness.get(i),
      map.CumulativeFluvialErosion.get(i),
      map.CumulativeGlacialErosion.get(i),
      map.CumulativeGlacialDeposition.get(i),
      map.CumulativeCoastalErosion.get(i),
      map.CumulativeDeposition.get(i),
    ].some((v) => v < 0);
    const elevation = map.Elevation.get(i),
      bedrock = map.BedrockElevation.get(i),
      sediment = map.SedimentThickness.get(i);
    if (invalid || elevation !== bedrock + sediment)
      throw new Error(
        `Landscape cell ${i} is inconsistent: elevation ${elevation}, bedrock ${bedrock}, sediment ${sediment}, negative material ${invalid}.`
      );
  }
  if (
    map.SedimentProducedTotal < 0 ||
    map.SedimentDepositedTotal < 0 ||
    map.SedimentExportedTotal < 0 ||
    map.SedimentDepositedTotal + map.SedimentExportedTotal >
      map.SedimentProducedTotal + Math.max(0.001, map.SedimentProducedTotal * 1e-9)
  )
    throw new Error(
      `Sediment accounting is inconsistent: produced ${map.SedimentProducedTotal} m³, ` +
        `deposited ${map.SedimentDepositedTotal} m³, exported ${map.SedimentExportedTotal} m³.`
    );
}
