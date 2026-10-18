// Explicit projection from Canonry's fixed-point numerical state into GIS channels.
import type { PhysicalField } from "./field";

type ArrayName = {
  [K in keyof PhysicalField]: PhysicalField[K] extends ArrayLike<number> ? K : never;
}[keyof PhysicalField];
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
export const atlasChannels: ChannelBinding[] = [
  height("elevation", "Elevation", true),
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
  scalar("rainfall", "Rainfall"),
  scalar("snowfall", "Snowfall"),
  scalar("runoff", "Runoff"),
  scalar("ice", "IceThickness"),
  scalar("maximumIce", "MaximumIceThickness"),
  { name: "maximumIceFlux", native: "MaximumIceFlux", unit: "relative-flux", scale: 1 },
  {
    name: "maximumGroundedIceFlux",
    native: "MaximumGroundedIceFlux",
    unit: "relative-flux",
    scale: 1,
  },
  { name: "oceanDistance", native: "OceanDistance", unit: "metre", scale: 1 },
  scalar("riverChannel", "RiverChannelStrength"),
  scalar("floodplain", "FloodplainIntensity"),
  scalar("delta", "DeltaIntensity"),
  scalar("waveExposure", "WaveExposure"),
  scalar("oceanCurrent", "OceanCurrentStrength"),
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
];
