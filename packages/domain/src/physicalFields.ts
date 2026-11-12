import type { SampleType } from "./workspaceResources";
import { ecologyScalars } from "./ecologyFields";
import { allColumnIntegerFields, allColumnScalarFields } from "./materialFields";
import {
  loadIntegerFields,
  loadScalarFields,
  seaLoadIntegerFields,
  seaLoadScalarFields,
} from "./materialLoadFields";
import { humanIntegerFields, humanScalarFields } from "./humanFields";
import { waterYearFields } from "./waterYearFields";

const integerFields = [
  "GroundwaterTargets",
  "BiomeCodes",
  "CrustBasePotential",
  "CrustAssemblyIds",
  "CrustPlateIds",
  "CrustAssemblySeparation",
  "CrustCollisionIntensity",
  "CrustSuturePairIds",
  "CrustSutureStrength",
  // Where crust lies on a seam between provinces; carried with the crust as a suture is.
  "CrustProvinceSeam",
  "RockResistance",
  "CrustMotionX",
  "CrustMotionY",
  "CrustProvinceIds",
  "CrustTypeCodes",
  "CrustContinentalFraction",
  "AdvectionSourceIndex",
  "MarginCodes",
  "CoastalMarginCodes",
  "CrustAge",
  "ContinentalPotential",
  "Temperature",
  "WindX",
  "WindY",
  "UpwindTargets",
  "MoistureBarriers",
  "PrecipitationBarriers",
  "UpwindOceanSources",
  "TectonicBoundaryCodes",
  "TectonicStrain",
  "InitialTectonicBoundaryCodes",
  "InitialTectonicStrain",
  "TectonicBoundaryPairIds",
  "TectonicTangentX",
  "TectonicTangentY",
  "OrogenicComponentIds",
  // Persistent structural grain of constructed relief: doubled-angle axial direction of the
  // belt's strike times its coherence (per-mille). Kept where construction happened and
  // carried with the crust, so a region can read how its relief is organized long after
  // the boundary that built it has moved or closed.
  "StructuralGrainX",
  "StructuralGrainY",
  // A cell's place in the belt that first reached it, carried with the crust: its boundary pair and
  // sheet (each one more than the real number, so 0 means none), its fault segment, and how far
  // across its sheet it joined, per mille from the sheet's rear. Its dip is the metres its beds
  // have risen through the surface as the sheet tilted.
  "ThrustPairIds",
  "ThrustSheetIndex",
  "ThrustSegmentIds",
  "ThrustAcross",
  "ThrustDip",
  "OceanCurrentX",
  "OceanCurrentY",
  "OceanCurrentStrength",
  "OceanCurrentHeat",
  // Signed sea-surface departure from latitude equilibrium, native climate units.
  "SeaSurfaceAnomaly",
  // Per-mille coastal upwelling of cold, nutrient-rich water.
  "Upwelling",
  "WaveExposure",
  "SeaIceSuitability",
  "TectonicActivityHistory",
  "WaveExposureHistory",
  "GeothermalHistory",
  "ImpactHeat",
  "ExternalHeatForcing",
  "ExternalCoastalForcing",
  "ExternalCoastalForcingHistory",
  "Moisture",
  "Geothermal",
  "MantlePlumeRootStrength",
  "VolcanicActivity",
  "VolcanicLastActiveEpoch",
  "LandformCodes",
  "RockKindCodes",
  ...allColumnIntegerFields,
  ...loadIntegerFields,
  ...seaLoadIntegerFields,
  "WaterKindCodes",
  "WaterBodyIds",
  "DrainageBasinIds",
  "FlowEdges",
  "RiverOrders",
  "RiverChannelStrength",
  "RiverChannelOrders",
  "FloodplainIntensity",
  "DeltaIntensity",
  "RiverSpineEdgeMasks",
  "FeatureFlags",
  "LandmassIds",
  "LandmassClassCodes",
  "ContinentalGroupIds",
  "BathymetricZoneCodes",
  "IceFlowTargets",
  "IceBalance",
  "GroundedIce",
  "FractureConductance",
  "HeatSourceDensity",
  "DrainageParents",
  "DrainageRanks",
  "DrainageGuidanceTargets",
  "FlowTargets",
  "LakeOutletTargets",
  "Warmth",
  // The traditions people's identity layers name, and the tongue of whoever built a ruin.
  ...humanIntegerFields,
] as const;
const elevationFields = [
  ...allColumnScalarFields,
  ...loadScalarFields,
  ...seaLoadScalarFields,
  "GroundCutDepth",
  "GroundCutCover",
  "Elevation",
  "BedrockElevation",
  "CrustThickness",
  "CrustSupportElevation",
  "CrustSupportTarget",
  "SurfaceRockLoad",
  "SedimentThickness",
  "SedimentSupply",
  "CumulativeFluvialErosion",
  "CumulativeGlacialErosion",
  "CumulativeGlacialDeposition",
  "CumulativeCoastalErosion",
  "CumulativeDeposition",
  "OrogenicConstruction",
  "ConvergentCrustSurplus",
  "CrustContinentalColumn",
  "CrustRootReserve",
  "OceanicSubduction",
  "OceanicSubductionHistory",
  "ImpactExcavation",
  "ImpactRimUplift",
  "ImpactEjectaThickness",
  "VolcanicConstructionHistory",
  "VolcanicMeltSupply",
  // Cumulative correction that held authored landmarks to their signatures.
  "LandmarkMaintenance",
  "Slope",
  "WaterDepths",
  "WaterSurfaceElevations",
  "DrainageElevations",
  "LakeOverflow",
] as const;
const floatFields = ["RidgeInfluence", "Uplift"] as const;
const metricFields = [
  "GroundCutShare",
  ...ecologyScalars,
  "OceanMarginDistance",
  "CrustRiftStrain",
  "CrustRiftAgeMyr",
  "OceanDistance",
  // Seasonal temperature half-range in °C; zero until temperature first runs.
  "Seasonality",
  // What the air can evaporate over the year, in mm, by each month's warmth and day length.
  "AirDemand",
  // Surface wind speed in m/s; WindX/WindY carry its direction.
  "WindSpeed",
  // Water depth rates in mm/year retain fractional amounts when map scale changes.
  "Rainfall",
  "Snowfall",
  "GlacialMeltwater",
  // Actual ice removed by external heat this epoch; included by every later runoff refresh.
  "ExternalMeltwater",
  "GroundwaterStorage",
  "GroundwaterExchangeVolume",
  "GroundwaterRecharge",
  "GroundwaterOutflow",
  "GroundwaterReturn",
  "OrganicBurialInput",
  "OrganicBurialThickness",
  "Runoff",
  // One water budget, in mm/year: what a cell's surface gives in its wetter and its drier
  // season, and what sinks into its ground.
  "FloodRunoff",
  "DryRunoff",
  "WaterRecharge",
  // Snow that outlasts the year, in mm/year: what the ice is fed.
  "SnowKept",
  // Snow lying on the cell through the year, as a depth of water: part of the water column.
  "SnowPack",
  // Precipitation in mm/year from the downwind air columns before the epoch multiplier.
  "ColumnPrecipitation",
  "FlowAccumulation",
  // What a river carries in flood and in its driest season, in m³/s, beside its mean.
  "FloodFlow",
  "PerennialFlow",
  // The months of the year a cell carries at least a river's flow.
  "FlowingMonths",
  // What a cell's surface gives the rivers in each month of its year, in millimetres.
  ...waterYearFields,
  "CatchmentArea",
  "RiverWidth",
  "RiverDepth",
  "IceFlux",
  "MaximumIceFlux",
  "MaximumGroundedIceFlux",
  "IceThickness",
  /** Current retreat runoff rate, metres per unit of producing work exposure. */
  "IceRetreat",
  "MaximumIceThickness",
  // Magic written into shared fields that the ordinary processes consume (0 to 1 unless
  // noted): Fire's quickening of living processes; Aurora's stillness and the share of
  // ice ablation its stored charge prevents; Pressure's upwelling (per-mille) and
  // sea-surface temperature forcing (native units) and the fog share on facing coasts.
  "Quickening",
  "Stillness",
  "IcePersistence",
  // Aurora's charge concentration in the ice, 0 to 1: charged sliding ice cuts deeper.
  "IceCharge",
  "ExternalUpwelling",
  "ExternalSeaSurfaceForcing",
  "FogForcing",
  // Pressure's storms: energy raised on a sea front (0–1,000) and the pulse the air columns
  // carry inland from it (0–1,000), the track the weather follows.
  "StormForcing",
  "StormTrack",
  // How high this ground stood when the first epoch ended, carried with the crust: what lets a later
  // reader tell old ground from new, and see what became of it.
  "FirstEpochHeight",
  // Greenwood's verdure: the life in sap and groundwater that ecology grows from (0 to 1).
  "Verdure",
  // What people left on the ground, as amounts the crust carries: person-years at inhabited
  // seats, traveller-years along the ways between them, and the dead of events and die-offs.
  // Hallowed is made of the first two; Salt's death origin reads the third.
  "Tenure",
  "WalkedRoute",
  "MassDeath",
  // Salt's salting: the preserving residue on the ground (0 to 1), and the depth of water a
  // cell held while it was a lake, which outlives the lake for Salt's dead-lake origin.
  "Salting",
  "LakeMemory",
  // Hallowed's warding (0 to 1): every other system is scaled down inside and lands on the
  // rim; and the kept-years of the lines people keep walking, forgetting over a memory.
  "Warding",
  "KeptLine",
  // Veil's tearing (0 to 1): the ground where other systems strain against each other.
  "Tearing",
  // Magical heat carried down the drainage (native units): the thawed river below a wellspring.
  "RiverWarmth",
  // People on the land: who lives on a cell, what they farm, graze and have built, what their
  // places have left behind, and the layers of identity they hold.
  ...humanScalarFields,
] as const;
export type PhysicalIntegerName = (typeof integerFields)[number];
export type PhysicalFieldName =
  | PhysicalIntegerName
  | (typeof elevationFields)[number]
  | (typeof metricFields)[number]
  | (typeof floatFields)[number];
/** Channels that read -1 until a process writes them. */
const unsetIndexFields = [
  "OceanMarginDistance",
  "OceanDistance",
  "OrogenicComponentIds",
  "VolcanicLastActiveEpoch",
  "FlowEdges",
  "IceFlowTargets",
  "DrainageParents",
  "DrainageGuidanceTargets",
  "FlowTargets",
  "LakeOutletTargets",
  "UpwindTargets",
  "UpwindOceanSources",
] as const;
/** The physical schema: every channel's sample type and initial value. */
export function canonicalPhysicalFields() {
  const unset = new Set<string>(unsetIndexFields),
    initial = (name: string) =>
      name === "WaterSurfaceElevations" ? -(2 ** 63) : unset.has(name) ? -1 : 0,
    entry = (name: PhysicalFieldName, type: SampleType) => ({
      name,
      type,
      lifetime: "run" as const,
      initial: initial(name),
    });
  return [
    ...integerFields.map((name) => entry(name, "int32")),
    ...elevationFields.map((name) => entry(name, "float64")),
    ...metricFields.map((name) => entry(name, "float64")),
    ...floatFields.map((name) => entry(name, "float32")),
  ];
}
