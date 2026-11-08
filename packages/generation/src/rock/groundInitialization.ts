import { resetRock } from "./rockField";
import type { PhysicalField } from "../world/field";
import { projectGround, resetShares } from "./groundShares";
import { loadOf, seaLoadOf } from "./groundLoad";
import { groundStorage } from "./groundStorage";

/**
 * A forming world's first surface, which the crust's thickness sets before there is rock or cover to
 * build it from. Laying out the landscape then takes its rock from here.
 */
export function standSurface(map: PhysicalField, i: number, elevation: number) {
  groundStorage(map).BedrockElevation.set(i, elevation);
  projectGround(map, i);
}
export function initializeLandscape(map: PhysicalField) {
  resetRock(map);
  for (let i = 0; i < map.mesh.count; i++) {
    resetShares(map, i);
    loadOf(map).clear(i);
  }
  seaLoadOf(map).clear(0);
  groundStorage(map).SedimentThickness.fill(0);
  groundStorage(map).SedimentSupply.fill(0);
  for (const name of [
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
  groundStorage(map).BedrockElevation.copyFrom(map.Elevation);
  groundStorage(map).CrustSupportElevation.copyFrom(map.Elevation);
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
    if (
      invalid ||
      !Number.isFinite(elevation) ||
      !Number.isFinite(bedrock) ||
      !Number.isFinite(sediment)
    )
      throw new Error(
        `Landscape cell ${i} is inconsistent: elevation ${elevation}, bedrock ${bedrock}, sediment ${sediment}, negative material ${invalid}.`
      );
  }
}
