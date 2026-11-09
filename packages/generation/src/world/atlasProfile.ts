import { MapScale, type Epoch } from "@atlas/domain";
import { physicalProfile, type PhysicalProfile } from "./profile";
import { clamp, round } from "./math";
import { atlasParametersSchema, type AtlasParameters } from "../atlasParameters";
import { latitudeAtY } from "./latitude";
import type { PhysicalProfileOverrides } from "../physicalProfileConfiguration";
import { tectonicDefaultMyr } from "./tectonicControls";

export { atlasQuality } from "../resolution";
export function atlasPhysicalProfile(
  parameters: Partial<AtlasParameters>,
  overrides: PhysicalProfileOverrides,
  scale: MapScale
): PhysicalProfile {
  const settings = atlasParametersSchema.parse(parameters);
  const profile = scale.resolve(physicalProfile, overrides);
  profile.ContinentalAssemblyCount = settings.continents;
  profile.OceanicPlateCount = settings.oceanicPlates;
  profile.TectonicProvinceCount = settings.provinces;
  profile.ContinentalCrustFraction = settings.continentalCrustFraction;
  // Crust composition and exposed land are independent: continental shelves can be submerged.
  // The first flood establishes the water budget; later history moves the ground beneath it.
  profile.QualityTargets.OceanCoverage.target = 1 - settings.landFraction;
  profile.TemperatureBaseline = 300 + settings.temperature * 10;
  profile.LatitudeSouth = settings.southLatitude;
  profile.LatitudeNorth = settings.northLatitude;
  profile.LatitudeProjection = settings.latitudeProjection;
  profile.MapBoundary = settings.mapBoundary;
  profile.WrapLongitude = Number(profile.MapBoundary === 1);
  // Rainfall sets moisture supply: how much water the air holds before belts and
  // relief decide where it falls.
  profile.PrecipitationBaseline *= settings.rainfall;
  profile.ColumnSaturation *= settings.rainfall;
  profile.FluvialErosionRate *= settings.erosion;
  profile.SeaLevel = scale.length(settings.seaLevel) / profile.ElevationScale;
  profile.ImpactCraterCount = settings.impacts;
  profile.ImpactMinimumRadius *= settings.impactSize;
  profile.ImpactMaximumRadius *= settings.impactSize;
  profile.VolcanicConeHeight *= settings.volcanism;
  profile.PlateDriftPerMyr *= settings.plateDrift;
  profile.GlacialCutPerSpeed *= settings.glaciers;
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
  return profile;
}
/** Latitude of a world northing under the given settings and world frame [south, north]. */
export function atlasLatitude(
  parameters: Partial<AtlasParameters>,
  extentY: [number, number],
  worldY: number
) {
  const settings = atlasParametersSchema.parse(parameters);
  return latitudeAtY(
    {
      LatitudeSouth: settings.southLatitude,
      LatitudeNorth: settings.northLatitude,
      LatitudeProjection: settings.latitudeProjection,
      WorldExtentY: extentY,
    },
    worldY
  );
}
// Atlas temperatures are Celsius; the native snow threshold (300) represents
// zero Celsius, with ten native climate units per degree. Epoch settings are
// absolute baseline temperature, relative sea-level shifts and dimensionless strengths.
export function atlasEpoch(epoch: Epoch, scale: MapScale) {
  return {
    StableName: epoch.id,
    TectonicStrength: round(clamp(epoch.tectonics, 0, 1) * 1000),
    HydrologyStrength: round(clamp(epoch.hydrology, 0, 1) * 1000),
    GlaciationStrength: round(clamp(epoch.ice, 0, 1) * 1000),
    CoastalStrength: round(clamp(epoch.coasts, 0, 1) * 1000),
    TemperatureOffset: round((epoch.temperature - 15) * 10),
    SeaLevelOffset: scale.length(epoch.seaLevel),
    TectonicDurationMyr: epoch.tectonicDurationMyr ?? tectonicDefaultMyr,
  };
}
