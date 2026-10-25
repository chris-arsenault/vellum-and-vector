// Canonry PhysicalGeographyField, commit 0f62584c. Plain arrays remain worker-local.
import type { PhysicalMesh } from "./mesh";
import type { TransportPlan } from "./transportPlan";
import { ecologyScalars } from "./ecologyState";
import { noWaterSurface } from "./math";

const integerFields = [
  "BiomeCodes",
  "CrustBasePotential",
  "CrustAssemblyIds",
  "CrustAssemblySeparation",
  "CrustCollisionIntensity",
  "CrustSuturePairIds",
  "CrustSutureStrength",
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
  "OrogenicSystemProminence",
  "OceanCurrentX",
  "OceanCurrentY",
  "OceanCurrentStrength",
  "OceanCurrentHeat",
  // Signed sea-surface departure from latitude equilibrium, native climate units.
  "SeaSurfaceAnomaly",
  // Per-mille coastal upwelling of cold, nutrient-rich water.
  "Upwelling",
  "WaveExposure",
  "Rainfall",
  "Snowfall",
  "SeaIceSuitability",
  "TectonicActivityHistory",
  "WaveExposureHistory",
  "GeothermalHistory",
  "ImpactHeat",
  "GlacialMeltwater",
  "ExternalHeatForcing",
  "ExternalCoastalForcing",
  "ExternalCoastalForcingHistory",
  "Moisture",
  "Geothermal",
  "MantlePlumeRootStrength",
  "VolcanicActivity",
  "VolcanicLastActiveEpoch",
  "LandformCodes",
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
  "Runoff",
  "Warmth",
] as const;
const elevationFields = [
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
  "ImpactExcavation",
  "ImpactRimUplift",
  "ImpactEjectaThickness",
  "VolcanicConstructionHistory",
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
  ...ecologyScalars,
  "OceanMarginDistance",
  "OceanDistance",
  // Seasonal temperature half-range in °C; zero until temperature first runs.
  "Seasonality",
  // Surface wind speed in m/s; WindX/WindY carry its direction.
  "WindSpeed",
  // Per-mille precipitation from the downwind air columns, before the epoch
  // multiplier and the rain/snow split.
  "ColumnPrecipitation",
  "FlowAccumulation",
  "CatchmentArea",
  "RiverWidth",
  "RiverDepth",
  "IceFlux",
  "MaximumIceFlux",
  "MaximumGroundedIceFlux",
  "IceThickness",
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
  // Greenwood's verdure: the life in sap and groundwater that ecology grows from (0 to 1).
  "Verdure",
  // What people left on the ground, as amounts the crust carries: person-years at inhabited
  // seats, traveller-years along the ways between them, and the dead of events and die-offs.
  // Hallowed is made of the first two; Salt's death origin reads the third.
  "Tenure",
  "WalkedRoute",
  "MassDeath",
  // Magical heat carried down the drainage (native units): the thawed river below a wellspring.
  "RiverWarmth",
] as const;
export type PhysicalField = Record<(typeof integerFields)[number], Int32Array> &
  Record<(typeof elevationFields)[number], Float64Array> &
  Record<(typeof metricFields)[number], Float64Array> &
  Record<(typeof floatFields)[number], Float32Array> & {
    mesh: PhysicalMesh;
    /** Present engineered barriers; natural-lake size filters do not erase their reservoirs. */
    EngineeredDams: Set<number>;
    events: {
      id: string;
      kind: "impact" | "plume" | "volcano" | "landmark";
      x: number;
      y: number;
      radius: number;
      epoch: number;
      strength: number;
      caldera?: boolean;
    }[];
    faults: { id: string; coordinates: [number, number][]; width: number }[];
    AvailableFacts: Set<string>;
    EffectiveSeaLevel: number;
    BaseSeaLevel: number;
    // Connected ocean volume (m³) at the base level once the first flood has set it; later
    // floods move the base level to hold this volume, as a fixed water budget does.
    BaseOceanVolume: number;
    SeaLevelInitialized: boolean;
    OpenBoundary: boolean;
    CrustSupportInitialized: boolean;
    SedimentProducedTotal: number;
    SedimentDepositedTotal: number;
    SedimentExportedTotal: number;
    CompletedEpochCount: number;
    EcologyInitialized: boolean;
    AccumulatedPlateDrift: number;
    LastPlateDriftStep: number;
    /** The last plate drift's scatter, kept so amounts riding the crust can follow it. */
    transportPlan: TransportPlan | null;
    DrainageTieDecisionTotal: number;
    DrainageDecisionTotal: number;
    FloodFlatFillTotal: number;
    FloodFillTotal: number;
  };
export function createField(mesh: PhysicalMesh): PhysicalField {
  const arrays = {
    ...Object.fromEntries(integerFields.map((name) => [name, new Int32Array(mesh.count)])),
    ...Object.fromEntries(elevationFields.map((name) => [name, new Float64Array(mesh.count)])),
    ...Object.fromEntries(metricFields.map((name) => [name, new Float64Array(mesh.count)])),
    ...Object.fromEntries(floatFields.map((name) => [name, new Float32Array(mesh.count)])),
  };
  const field = {
    ...arrays,
    mesh,
    events: [] as PhysicalField["events"],
    faults: [] as PhysicalField["faults"],
    AvailableFacts: new Set<string>(),
    EngineeredDams: new Set<number>(),
    EffectiveSeaLevel: 0,
    BaseSeaLevel: 0,
    BaseOceanVolume: 0,
    SeaLevelInitialized: false,
    OpenBoundary: false,
    CrustSupportInitialized: false,
    SedimentProducedTotal: 0,
    SedimentDepositedTotal: 0,
    SedimentExportedTotal: 0,
    CompletedEpochCount: 0,
    EcologyInitialized: false,
    AccumulatedPlateDrift: 0,
    LastPlateDriftStep: 0,
    transportPlan: null as TransportPlan | null,
    DrainageTieDecisionTotal: 0,
    DrainageDecisionTotal: 0,
    FloodFlatFillTotal: 0,
    FloodFillTotal: 0,
  } as PhysicalField;
  for (const name of [
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
  ] as const)
    field[name].fill(-1);
  field.WaterSurfaceElevations.fill(noWaterSurface);
  return field;
}
export function clearWaterSurface(map: PhysicalField, i: number) {
  map.WaterDepths[i] = 0;
  map.WaterSurfaceElevations[i] = noWaterSurface;
}
export const allowsBoundaryDrainage = (map: PhysicalField) =>
  map.OpenBoundary || map.mesh.openBoundary;
export const isOpenOutlet = (map: PhysicalField, i: number) =>
  Boolean(map.mesh.boundary[i]) &&
  (map.OpenBoundary ||
    (map.mesh.openBoundary && map.DrainageParents[i] < 0 && map.DrainageRanks[i] >= 0));
export function setWaterSurface(map: PhysicalField, i: number, surface: number) {
  const depth = surface - map.Elevation[i];
  if (depth <= 0) throw new Error("Water surface must be above its physical floor.");
  map.WaterSurfaceElevations[i] = surface;
  map.WaterDepths[i] = depth;
}
export function reconcileWater(map: PhysicalField, i: number) {
  const surface = map.WaterSurfaceElevations[i];
  if (surface === noWaterSurface) return;
  if (surface > map.Elevation[i]) {
    map.WaterDepths[i] = surface - map.Elevation[i];
    return;
  }
  map.WaterKindCodes[i] = 0;
  map.WaterBodyIds[i] = 0;
  map.LakeOutletTargets[i] = -1;
  map.LakeOverflow[i] = 0;
  clearWaterSurface(map, i);
}
