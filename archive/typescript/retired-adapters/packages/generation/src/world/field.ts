// Canonry PhysicalGeographyField, commit 0f62584c. Plain arrays remain worker-local.
import type { PhysicalMesh } from "./mesh";
import type { TransportPlan } from "./transportPlan";
import type { TectonicState } from "./tectonicState";
import type { LandmarkLedger } from "./landmarkLedger";
import type { CrustBudget } from "../rock/crustTransport";
import { emptyReaches, type ReachStoreView } from "../water/reaches";
import { ownWater } from "../water/column";
import type { WaterColumnView } from "../water/stores";
import {
  Band,
  BlockCache,
  Coverage,
  MapScale,
  type ReadBand,
  canonicalPhysicalFields,
} from "@atlas/domain";
import { ownGround, groundOwnedFields, type GroundOwnedName } from "../rock/groundStorage";

export type PhysicalBufferName = import("@atlas/domain").PhysicalFieldName;
export type PhysicalIntegerName = import("@atlas/domain").PhysicalIntegerName;
export type MutablePhysicalBufferName = Exclude<PhysicalBufferName, GroundOwnedName>;
const groundNames = new Set<PhysicalBufferName>(groundOwnedFields);
/** Dynamic process channels exclude the ground owner's material and projections. */
export const isMutablePhysicalName = (
  name: PhysicalBufferName
): name is MutablePhysicalBufferName => !groundNames.has(name);
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
    /** The map's rivers, kept from pass to pass; the water owner alone changes them. */
    readonly rivers: ReachStoreView;
    /** The owned column's stores share the field's canonical numerical resources. */
    readonly water: WaterColumnView;
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
    /** Imported mechanical state relative to this working map's settled support equation. */
    SupportDatum: ReadBand | null;
    SedimentProducedTotal: number;
    SedimentDepositedTotal: number;
    SedimentExportedTotal: number;
    CompletedEpochCount: number;
    SeaIceEvolvedEpoch: number;
    EcologyInitialized: boolean;
    AccumulatedPlateDrift: number;
    LastPlateDriftStep: number;
    /** The span the groundwater last moved over: its returned depths are rates over this. */
    GroundwaterInterval: number;
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
      canonicalPhysicalFields().map((schema) => [schema.name, coverage.allocate(schema)])
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
    rivers: emptyReaches(),
    get water(): WaterColumnView {
      return water;
    },
    ThrustSlipOwed: new Map<string, number>(),
    EngineeredDams: null as Band | null,
    EffectiveSeaLevel: 0,
    BaseSeaLevel: 0,
    BaseOceanVolume: 0,
    SeaLevelInitialized: false,
    OpenBoundary: false,
    CrustSupportInitialized: false,
    SupportDatum: null,
    SedimentProducedTotal: 0,
    SedimentDepositedTotal: 0,
    SedimentExportedTotal: 0,
    CompletedEpochCount: 0,
    SeaIceEvolvedEpoch: -1,
    EcologyInitialized: false,
    AccumulatedPlateDrift: 0,
    LastPlateDriftStep: 0,
    GroundwaterInterval: 0,
    transportPlan: null as TransportPlan | null,
    DrainageTieDecisionTotal: 0,
    DrainageDecisionTotal: 0,
    FloodFlatFillTotal: 0,
    FloodFillTotal: 0,
  } as PhysicalField;
  ownGround(field, bands);
  const water = ownWater(field);
  return field;
}
/** The field's channel bands, by name. */
export function physicalBands(map: PhysicalField): [PhysicalBufferName, ReadBand][] {
  return canonicalPhysicalFields().map(({ name }) => [name, map[name]]);
}
export const allowsBoundaryDrainage = (map: PhysicalField) =>
  map.OpenBoundary || map.mesh.openBoundary;
export const isOpenOutlet = (map: PhysicalField, i: number) =>
  map.mesh.boundary(i) &&
  (map.OpenBoundary ||
    (map.mesh.openBoundary && map.DrainageParents.get(i) < 0 && map.DrainageRanks.get(i) >= 0));
