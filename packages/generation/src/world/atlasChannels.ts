import { groundResourceChannels } from "../rock/groundResources";
import type { PhysicalBufferName } from "./field";
import { ecologyFields, ecologyRatios } from "@atlas/domain";
import { magicEffectChannels } from "./magicFieldDefinitions";
import { humanChannels, humanFeatures } from "../human/humanChannels";
import { landWaterNames, standingWaterNames, waterColumnChannels } from "../water/column";

/** The working band's identity and meaning also govern its published samples. */
export interface PhysicalChannel {
  name: PhysicalBufferName;
  unit: string;
  quantity?: "intensive" | "extensive" | "category";
  minimum?: number;
  maximum?: number;
  /** Material facts share one donor so sampling cannot detach a bed from its history. */
  discrete?: boolean;
}
export const structureChannels: PhysicalBufferName[] = [
  ...groundResourceChannels.map(({ name }) => name),
  "ThrustPairIds",
  "ThrustSheetIndex",
  "ThrustSegmentIds",
  "ThrustAcross",
  "ThrustDip",
];
const channel = (name: PhysicalBufferName, unit: string): PhysicalChannel => ({ name, unit });
const length = (name: PhysicalBufferName): PhysicalChannel => channel(name, "native-length");
const amount = (name: PhysicalBufferName): PhysicalChannel => ({ ...length(name), minimum: 0 });
const fraction = (name: PhysicalBufferName): PhysicalChannel => channel(name, "per-mille");
const category = (name: PhysicalBufferName): PhysicalChannel => ({
  name,
  unit: "category",
  quantity: "category",
});
/**
 * What the living landscape publishes. The soil's water is shown with it but belongs to the
 * water column, which publishes it with the rest of what a cell holds.
 */
const columnParts = new Set<string>(waterColumnChannels.map(({ name }) => name)),
  livingFields = ecologyFields.filter(({ name }) => !columnParts.has(name));

/** Publication selects facts; it never renames, re-encodes or rebases their values. */
export const physicalChannels: PhysicalChannel[] = [
  length("Elevation"),
  ...magicEffectChannels.map((name) => channel(name, "ratio")),
  ...livingFields.map((field) => ({
    ...field,
    minimum: 0,
    maximum: ecologyRatios.some((name) => name === field.name) ? 1 : undefined,
  })),
  amount("SedimentThickness"),
  amount("CumulativeFluvialErosion"),
  amount("CumulativeGlacialErosion"),
  amount("CumulativeCoastalErosion"),
  amount("CumulativeDeposition"),
  amount("CumulativeGlacialDeposition"),
  amount("VolcanicConstructionHistory"),
  amount("VolcanicMeltSupply"),
  amount("LandmarkMaintenance"),
  amount("ImpactExcavation"),
  amount("ImpactRimUplift"),
  amount("ImpactEjectaThickness"),
  // A cell's water column is published and inherited as the water owner's package.
  ...waterColumnChannels,
  length("DrainageElevations"),
  fraction("FractureConductance"),
  channel("RockResistance", "rock-strength"),
  fraction("CrustAge"),
  { ...fraction("CrustSutureStrength"), discrete: true },
  fraction("Geothermal"),
  fraction("TectonicStrain"),
  { ...fraction("StructuralGrainX"), discrete: true },
  { ...fraction("StructuralGrainY"), discrete: true },
  { ...fraction("ThrustAcross"), discrete: true },
  { ...channel("ThrustDip", "metre"), discrete: true },
  fraction("CrustMotionX"),
  fraction("CrustMotionY"),
  fraction("Moisture"),
  channel("Temperature", "native-temperature"),
  channel("ExternalHeatForcing", "deci-celsius"),
  fraction("WindX"),
  fraction("WindY"),
  channel("WindSpeed", "metre/second"),
  channel("Rainfall", "millimetre/year"),
  channel("Snowfall", "millimetre/year"),
  channel("Runoff", "millimetre/year"),
  channel("IceThickness", "metre"),
  channel("MaximumIceThickness", "metre"),
  channel("Slope", "gradient"),
  channel("CatchmentArea", "square-metre"),
  channel("RiverWidth", "metre"),
  channel("RiverDepth", "metre"),
  // These are colocated historical observations. Independent polynomial reconstruction can
  // invent a grounded maximum greater than the total maximum; carry the recorded pair.
  { ...channel("MaximumIceFlux", "cubic-metre/year"), discrete: true, minimum: 0 },
  { ...channel("MaximumGroundedIceFlux", "cubic-metre/year"), discrete: true, minimum: 0 },
  channel("FlowAccumulation", "cubic-metre/second"),
  { ...channel("SmallChannelLength", "metre"), quantity: "extensive" },
  // What a river still carries in its driest month: a finer map's entering rivers keep it.
  { ...channel("PerennialFlow", "cubic-metre/second"), minimum: 0 },
  channel("OceanDistance", "metre"),
  fraction("RiverChannelStrength"),
  fraction("FloodplainIntensity"),
  fraction("DeltaIntensity"),
  fraction("WaveExposure"),
  fraction("OceanCurrentStrength"),
  fraction("OceanCurrentHeat"),
  channel("Warmth", "deci-celsius"),
  channel("SeaSurfaceAnomaly", "deci-celsius"),
  fraction("Upwelling"),
  fraction("StormForcing"),
  fraction("StormTrack"),
  channel("RiverWarmth", "deci-celsius"),
  category("CrustProvinceIds"),
  category("CrustAssemblyIds"),
  category("CrustSuturePairIds"),
  category("TectonicBoundaryCodes"),
  category("TectonicBoundaryPairIds"),
  category("MarginCodes"),
  category("LandformCodes"),
  category("RockKindCodes"),
  category("ThrustPairIds"),
  category("ThrustSheetIndex"),
  category("ThrustSegmentIds"),
  ...groundResourceChannels,
  category("DrainageBasinIds"),
  category("RiverOrders"),
  category("GroundedIce"),
  category("FeatureFlags"),
  category("VolcanicLastActiveEpoch"),
  category("BathymetricZoneCodes"),
  fraction("GeothermalHistory"),
  fraction("TectonicActivityHistory"),
  fraction("ExternalCoastalForcingHistory"),
  ...humanChannels,
];

type Ownership = readonly [
  owner: string | readonly string[],
  layer: string,
  channels: readonly PhysicalBufferName[],
];
export const physicalChannelOwnership: Ownership[] = [
  ["magic.configured", "magic", magicEffectChannels],
  ["physical.foundation", "elevation", ["Elevation"]],
  [
    "physical.foundation",
    "geology",
    [
      "SedimentThickness",
      "RockResistance",
      "RockKindCodes",
      ...structureChannels,
      "CrustProvinceIds",
      "CrustAssemblyIds",
      "CrustSuturePairIds",
      "CrustSutureStrength",
      "MarginCodes",
      "CrustAge",
    ],
  ],
  [
    "physical.tectonic-history",
    "geology",
    [
      "TectonicStrain",
      "CrustMotionX",
      "CrustMotionY",
      "TectonicBoundaryCodes",
      "TectonicBoundaryPairIds",
      "TectonicActivityHistory",
      "StructuralGrainX",
      "StructuralGrainY",
    ],
  ],
  [
    ["physical.fractures", "physical.impacts", "physical.volcanism"],
    "geology",
    ["FractureConductance"],
  ],
  ["physical.geothermal", "geology", ["Geothermal", "GeothermalHistory"]],
  ["physical.impacts", "geology", ["ImpactExcavation", "ImpactRimUplift", "ImpactEjectaThickness"]],
  [
    "physical.volcanism",
    "geology",
    ["VolcanicConstructionHistory", "VolcanicLastActiveEpoch", "VolcanicMeltSupply"],
  ],
  ["physical.landmarks", "geology", ["LandmarkMaintenance"]],
  ["physical.river-incision", "geology", ["CumulativeFluvialErosion"]],
  [
    [
      "material.fluvial-transport",
      "physical.glacial-sculpting",
      "physical.coastal-evolution",
      "physical.hillslopes",
    ],
    "geology",
    ["CumulativeDeposition"],
  ],
  [
    "physical.glacial-sculpting",
    "geology",
    ["CumulativeGlacialErosion", "CumulativeGlacialDeposition"],
  ],
  [
    "physical.coastal-evolution",
    "geology",
    ["CumulativeCoastalErosion", "ExternalCoastalForcingHistory"],
  ],
  ["physical.landforms", "geology", ["LandformCodes", "Slope", "FeatureFlags"]],
  [
    "physical.climate",
    "climate",
    [
      "Temperature",
      "ExternalHeatForcing",
      "Moisture",
      "WindX",
      "WindY",
      "WindSpeed",
      "Rainfall",
      "Snowfall",
      "StormTrack",
    ],
  ],
  [
    "water.routing",
    "rivers",
    [
      "Runoff",
      ...landWaterNames.filter((name) => name !== "SoilWater"),
      "DrainageBasinIds",
      "CatchmentArea",
      "RiverWarmth",
      "FlowAccumulation",
      "SmallChannelLength",
      "DrainageElevations",
    ],
  ],
  ["ocean.geography", "rivers", [...standingWaterNames, "OceanDistance"]],
  ["ocean.geography", "geology", ["BathymetricZoneCodes"]],
  [
    "physical.ocean-circulation",
    "rivers",
    ["OceanCurrentStrength", "WaveExposure", "SeaSurfaceAnomaly", "Upwelling", "StormForcing"],
  ],
  ["physical.ocean-circulation", "climate", ["OceanCurrentHeat", "Warmth"]],
  [
    "physical.land-ice",
    "climate",
    [
      "IceThickness",
      "MaximumIceThickness",
      "MaximumIceFlux",
      "MaximumGroundedIceFlux",
      "GroundedIce",
    ],
  ],
  [
    "physical.river-networks",
    "rivers",
    ["RiverOrders", "RiverChannelStrength", "RiverWidth", "RiverDepth", "PerennialFlow"],
  ],
  ["physical.floodplains", "rivers", ["FloodplainIntensity"]],
  ["physical.deltas", "rivers", ["DeltaIntensity"]],
  ["ecology.living", "ecology", livingFields.map(({ name }) => name)],
  [["water.routing", "ecology.living"], "ecology", ["SoilWater"]],
  [humanFeatures, "cultures", humanChannels.map(({ name }) => name)],
];
