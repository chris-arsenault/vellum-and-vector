import type { Epoch } from "@atlas/domain";
import { physicalProfile, type PhysicalProfile } from "./profile";
import { clamp, round } from "./math";
import { atlasParametersSchema, type AtlasParameters } from "../atlasParameters";
import { latitudeAtY } from "./latitude";
import type { PhysicalProfileOverrides } from "../physicalProfileConfiguration";

export { atlasQuality } from "../resolution";
export function atlasPhysicalProfile(
  parameters: Partial<AtlasParameters> = {},
  overrides: PhysicalProfileOverrides = {}
): PhysicalProfile {
  const settings = atlasParametersSchema.parse(parameters);
  const profile = structuredClone(physicalProfile);
  profile.ContinentalAssemblyCount = settings.continents;
  profile.TectonicProvinceCount = settings.provinces;
  profile.ContinentalCrustFraction = settings.landFraction;
  // The water budget covers what is not continental crust, so the land fraction a cartographer
  // asks for is the land share the first flood leaves, not only the share of continental sites.
  profile.QualityTargets.OceanCoverage.target = 1 - settings.landFraction;
  profile.TemperatureBaseline = 300 + settings.temperature * 10;
  profile.LatitudeSouth = settings.southLatitude;
  profile.LatitudeNorth = settings.northLatitude;
  profile.LatitudeProjection = settings.latitudeProjection;
  profile.WrapLongitude = settings.wrapLongitude;
  // Rainfall sets moisture supply: how much water the air holds before belts and
  // relief decide where it falls.
  profile.PrecipitationBaseline *= settings.rainfall;
  profile.ColumnSaturation *= settings.rainfall;
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
  // Latitude and the sea-surface anomaly set surface temperature. Crustal heat
  // warms only vents and active volcanoes, by up to about 3 °C; hydrothermal
  // heat carried by currents stays a sea-ice and reef input.
  profile.GeothermalSurfaceThreshold = profile.GeothermalVentThreshold;
  profile.GeothermalTemperatureStrength = 100;
  profile.OceanCurrentTemperatureStrength = 0;
  profile.OceanCurrentWarmthStrength = 0;
  // Exposure and local variation shift the sea-ice edge by a few degrees; they
  // cannot keep a polar ocean that averages well below freezing open.
  profile.SeaIceCurrentResistance = 20;
  profile.SeaIceWaveResistance = 20;
  profile.SeaIceSuitabilityVariation = 30;
  return Object.assign(profile, overrides);
}
/** Latitude of a world northing under the given settings and world frame [south, north]. */
export function atlasLatitude(
  parameters: Partial<AtlasParameters>,
  extentY: [number, number],
  worldY: number
) {
  const profile = atlasPhysicalProfile(parameters);
  profile.WorldExtentY = extentY;
  return latitudeAtY(profile, worldY);
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
