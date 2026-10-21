import type { Epoch } from "@atlas/domain";
import { physicalProfile, type PhysicalProfile } from "./profile";
import { clamp, round } from "./math";
import { atlasParametersSchema, type AtlasParameters } from "../atlasParameters";

export const atlasQuality = {
  draft: { baseCells: 16384 },
  standard: { baseCells: 65536 },
  fine: { baseCells: 262144 },
};
export function atlasPhysicalProfile(parameters: Partial<AtlasParameters> = {}): PhysicalProfile {
  const settings = atlasParametersSchema.parse(parameters);
  const profile = structuredClone(physicalProfile);
  profile.ContinentalAssemblyCount = settings.continents;
  profile.TectonicProvinceCount = settings.provinces;
  profile.ContinentalCrustFraction = settings.landFraction;
  profile.TemperatureBaseline = 300 + settings.temperature * 10;
  profile.LatitudeSouth = settings.southLatitude;
  profile.LatitudeNorth = settings.northLatitude;
  profile.PrecipitationBaseline *= settings.rainfall;
  profile.ColumnRainEfficiency *= settings.rainfall;
  profile.FluvialErosionStrength *= settings.erosion;
  profile.SeaLevel = settings.seaLevel / profile.ElevationScale;
  profile.ImpactCraterCount = settings.impacts;
  profile.ImpactMinimumRadius *= settings.impactSize;
  profile.ImpactMaximumRadius *= settings.impactSize;
  profile.VolcanicConeHeight *= settings.volcanism;
  profile.VolcanicApronHeight *= settings.volcanism;
  profile.VolcanicCalderaDepth *= settings.volcanism;
  profile.PlateDriftPerEpoch *= settings.plateDrift;
  profile.MaximumGlacialErosionPerPass *= settings.glaciers;
  profile.MaximumGlacialDepositionPerPass *= settings.glaciers;
  profile.CoastalErosionStrength *= settings.coastalErosion;
  profile.HeartWarmthStrength = 0;
  profile.WarmthPocketCount = 0;
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
