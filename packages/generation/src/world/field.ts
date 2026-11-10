// Canonry PhysicalGeographyField, commit 0f62584c. Plain arrays remain worker-local.
import type { PhysicalMesh } from "./mesh";
import type { TransportPlan } from "./transportPlan";
import { ecologyScalars } from "./ecologyState";
import { noWaterSurface } from "./math";
import type { TectonicState } from "./tectonicState";
import type { LandmarkLedger } from "./landmarkLedger";
import type { CrustBudget } from "../rock/crustTransport";
import {
  Band,
  BlockCache,
  Coverage,
  MapScale,
  type ReadBand,
  type SampleType,
} from "@atlas/domain";
import { ownGround, groundOwnedFields, type GroundOwnedName } from "../rock/groundStorage";
import { allColumnIntegerFields, allColumnScalarFields } from "../rock/rockLayerFields";
import {
  loadIntegerFields,
  loadScalarFields,
  seaLoadIntegerFields,
  seaLoadScalarFields,
} from "../rock/groundLoad";

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
  // Precipitation in mm/year from the downwind air columns before the epoch multiplier.
  "ColumnPrecipitation",
  "FlowAccumulation",
  "CatchmentArea",
  "RiverWidth",
  "RiverDepth",
  "IceFlux",
  "MaximumIceFlux",
  "MaximumGroundedIceFlux",
  "IceThickness",
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
] as const;
export type PhysicalIntegerName = (typeof integerFields)[number];
export type PhysicalBufferName =
  | PhysicalIntegerName
  | (typeof elevationFields)[number]
  | (typeof metricFields)[number]
  | (typeof floatFields)[number];
export type MutablePhysicalBufferName = Exclude<PhysicalBufferName, GroundOwnedName>;
const groundNames = new Set<PhysicalBufferName>(groundOwnedFields);
/** Dynamic process channels exclude the ground owner's material and projections. */
export const isMutablePhysicalName = (
  name: PhysicalBufferName
): name is MutablePhysicalBufferName => !groundNames.has(name);
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
export function physicalSchema() {
  const unset = new Set<string>(unsetIndexFields),
    initial = (name: string) =>
      name === "WaterSurfaceElevations" ? noWaterSurface : unset.has(name) ? -1 : 0,
    entry = (name: string, type: SampleType) => ({
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
export type PhysicalField = Record<MutablePhysicalBufferName, Band> &
  Readonly<Record<GroundOwnedName, ReadBand>> & {
    /** The bands' coverage: lattice, block cache, scratch and process lifetimes. */
    coverage: Coverage;
    mesh: PhysicalMesh;
    readonly scale: MapScale;
    tectonics: TectonicState | null;
    landmarkLedger: LandmarkLedger | null;
    CrustColumnsInitialized: boolean;
    /** Whether plates have begun to carry the crust the world first laid out. */
    CrustFormed: boolean;
    ProvinceSeamsMarked: boolean;
    crustBudget: CrustBudget;
    /**
     * Present engineered barriers as a mark band, or null when there are none; natural-lake
     * size filters do not erase their reservoirs.
     */
    EngineeredDams: Band | null;
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
    /** Slip each thrust sheet has taken that has not yet added up to a whole cell of movement. */
    ThrustSlipOwed: Map<string, number>;
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
    SeaIceEvolvedEpoch: number;
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
/**
 * Whether the crust is still forming: no plate has carried it anywhere yet. What a world first lays
 * out, it lays out here; once plates move, everything builds on what they carry.
 */
export const crustForming = (map: PhysicalField) => !map.CrustFormed;
/** A physical field over the mesh; the cache bounds resident blocks and spills the rest. */
export function createField(
  mesh: PhysicalMesh,
  cache: BlockCache = new BlockCache(Infinity),
  scale: MapScale = MapScale.fromBounds(mesh.bounds, mesh.spacing)
): PhysicalField {
  const coverage = new Coverage(mesh, cache),
    bands = Object.fromEntries(
      physicalSchema().map((schema) => [schema.name, coverage.allocate(schema)])
    ) as Record<PhysicalBufferName, Band>;
  const field = {
    ...bands,
    mesh,
    scale,
    coverage,
    tectonics: null,
    landmarkLedger: null,
    CrustColumnsInitialized: false,
    CrustFormed: false,
    ProvinceSeamsMarked: false,
    crustBudget: {
      oceanCreated: 0,
      oceanConsumed: 0,
      continentalExported: 0,
      oceanExported: 0,
      continentalAdjustment: 0,
      oceanAdjustment: 0,
    },
    events: [] as PhysicalField["events"],
    faults: [] as PhysicalField["faults"],
    ThrustSlipOwed: new Map<string, number>(),
    EngineeredDams: null as Band | null,
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
    SeaIceEvolvedEpoch: -1,
    EcologyInitialized: false,
    AccumulatedPlateDrift: 0,
    LastPlateDriftStep: 0,
    transportPlan: null as TransportPlan | null,
    DrainageTieDecisionTotal: 0,
    DrainageDecisionTotal: 0,
    FloodFlatFillTotal: 0,
    FloodFillTotal: 0,
  } as PhysicalField;
  ownGround(field, bands);
  return field;
}
/** The field's channel bands, by name. */
export function physicalBands(map: PhysicalField): [PhysicalBufferName, ReadBand][] {
  return physicalSchema().map(({ name }) => [
    name as PhysicalBufferName,
    map[name as PhysicalBufferName],
  ]);
}
export function clearWaterSurface(map: PhysicalField, i: number) {
  map.WaterDepths.set(i, 0);
  map.WaterSurfaceElevations.set(i, noWaterSurface);
}
export const allowsBoundaryDrainage = (map: PhysicalField) =>
  map.OpenBoundary || map.mesh.openBoundary;
export const isOpenOutlet = (map: PhysicalField, i: number) =>
  map.mesh.boundary(i) &&
  (map.OpenBoundary ||
    (map.mesh.openBoundary && map.DrainageParents.get(i) < 0 && map.DrainageRanks.get(i) >= 0));
export function setWaterSurface(map: PhysicalField, i: number, surface: number) {
  const depth = surface - map.Elevation.get(i);
  if (depth <= 0) throw new Error("Water surface must be above its physical floor.");
  map.WaterSurfaceElevations.set(i, surface);
  map.WaterDepths.set(i, depth);
}
export function reconcileWater(map: PhysicalField, i: number) {
  const surface = map.WaterSurfaceElevations.get(i);
  if (surface === noWaterSurface) return;
  if (surface > map.Elevation.get(i)) {
    map.WaterDepths.set(i, surface - map.Elevation.get(i));
    return;
  }
  map.WaterKindCodes.set(i, 0);
  map.WaterBodyIds.set(i, 0);
  map.LakeOutletTargets.set(i, -1);
  map.LakeOverflow.set(i, 0);
  clearWaterSurface(map, i);
}
