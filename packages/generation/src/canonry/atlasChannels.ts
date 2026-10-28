// Explicit projection from Canonry's fixed-point numerical state into GIS channels.
import type { PhysicalBufferName } from "./field";
import { ecologyBindings } from "./ecologyState";

type ArrayName = PhysicalBufferName;
export interface ChannelBinding {
  name: string;
  native: ArrayName;
  unit: string;
  scale: number;
  datum?: boolean;
  offset?: number;
}
const height = (name: string, native: ArrayName, datum = false): ChannelBinding => ({
  name,
  native,
  unit: "metre",
  scale: 1 / 1024,
  datum,
});
const scalar = (name: string, native: ArrayName): ChannelBinding => ({
  name,
  native,
  unit: "ratio",
  scale: 1 / 1000,
});
const category = (name: string, native: ArrayName): ChannelBinding => ({
  name,
  native,
  unit: "category",
  scale: 1,
});
const metric = (name: string, native: ArrayName, unit: string): ChannelBinding => ({
  name,
  native,
  unit,
  scale: 1,
});
export const atlasChannels: ChannelBinding[] = [
  height("elevation", "Elevation", true),
  ...ecologyBindings.map(([name, native, unit]) => ({ name, native, unit, scale: 1 })),
  height("bedrock", "BedrockElevation", true),
  height("sediment", "SedimentThickness"),
  height("crustThickness", "CrustThickness"),
  height("crustSupport", "CrustSupportElevation", true),
  height("rockLoad", "SurfaceRockLoad"),
  height("fluvialErosion", "CumulativeFluvialErosion"),
  height("glacialErosion", "CumulativeGlacialErosion"),
  height("coastalErosion", "CumulativeCoastalErosion"),
  height("deposition", "CumulativeDeposition"),
  height("glacialDeposition", "CumulativeGlacialDeposition"),
  height("volcanicConstruction", "VolcanicConstructionHistory"),
  height("landmarkMaintenance", "LandmarkMaintenance"),
  height("impactExcavation", "ImpactExcavation"),
  height("impactRim", "ImpactRimUplift"),
  height("impactEjecta", "ImpactEjectaThickness"),
  height("waterDepth", "WaterDepths"),
  scalar("fracture", "FractureConductance"),
  { name: "rock", native: "RockResistance", unit: "ratio", scale: 1 / 4000 },
  scalar("continentalFraction", "CrustContinentalFraction"),
  scalar("crustAge", "CrustAge"),
  scalar("sutureStrength", "CrustSutureStrength"),
  scalar("geothermal", "Geothermal"),
  scalar("tectonicStrain", "TectonicStrain"),
  scalar("crustMotionX", "CrustMotionX"),
  scalar("crustMotionY", "CrustMotionY"),
  scalar("moisture", "Moisture"),
  { name: "temperature", native: "Temperature", unit: "celsius", scale: 0.1, offset: -30 },
  scalar("windEast", "WindX"),
  scalar("windNorth", "WindY"),
  metric("windSpeed", "WindSpeed", "metre/second"),
  { name: "rainfall", native: "Rainfall", unit: "metre/year", scale: 1 / 1000 },
  { name: "snowfall", native: "Snowfall", unit: "metre/year", scale: 1 / 1000 },
  { name: "runoff", native: "Runoff", unit: "metre/year", scale: 1 / 1000 },
  scalar("ice", "IceThickness"),
  scalar("maximumIce", "MaximumIceThickness"),
  metric("iceThickness", "IceThickness", "metre"),
  metric("maximumIceThickness", "MaximumIceThickness", "metre"),
  metric("slope", "Slope", "gradient"),
  metric("catchmentArea", "CatchmentArea", "square-metre"),
  metric("riverWidth", "RiverWidth", "metre"),
  metric("riverDepth", "RiverDepth", "metre"),
  { name: "maximumIceFlux", native: "MaximumIceFlux", unit: "cubic-metre/year", scale: 1 },
  {
    name: "maximumGroundedIceFlux",
    native: "MaximumGroundedIceFlux",
    unit: "cubic-metre/year",
    scale: 1,
  },
  { name: "oceanDistance", native: "OceanDistance", unit: "metre", scale: 1 },
  scalar("riverChannel", "RiverChannelStrength"),
  scalar("floodplain", "FloodplainIntensity"),
  scalar("delta", "DeltaIntensity"),
  scalar("waveExposure", "WaveExposure"),
  scalar("oceanCurrent", "OceanCurrentStrength"),
  { name: "seaSurfaceAnomaly", native: "SeaSurfaceAnomaly", unit: "celsius", scale: 0.1 },
  scalar("upwelling", "Upwelling"),
  scalar("stormForcing", "StormForcing"),
  scalar("stormTrack", "StormTrack"),
  { name: "riverWarmth", native: "RiverWarmth", unit: "celsius", scale: 0.1 },
  category("province", "CrustProvinceIds"),
  category("assembly", "CrustAssemblyIds"),
  category("suturePair", "CrustSuturePairIds"),
  category("tectonicBoundary", "TectonicBoundaryCodes"),
  category("boundaryPair", "TectonicBoundaryPairIds"),
  category("margin", "MarginCodes"),
  category("landform", "LandformCodes"),
  category("water", "WaterKindCodes"),
  category("waterBody", "WaterBodyIds"),
  category("basin", "DrainageBasinIds"),
  category("riverOrder", "RiverOrders"),
  category("groundedIce", "GroundedIce"),
  category("physicalFeatures", "FeatureFlags"),
  category("volcanicLastActiveEpoch", "VolcanicLastActiveEpoch"),
  category("bathymetry", "BathymetricZoneCodes"),
  scalar("geothermalHistory", "GeothermalHistory"),
  scalar("tectonicHistory", "TectonicActivityHistory"),
  scalar("coastalForcingHistory", "ExternalCoastalForcingHistory"),
];
