import type { Geometry } from "geojson";
import type { AtlasFeature, World, History } from "./model";
import type { DomainWrite, ObjectKind } from "./operations";
import type { Bounds } from "./spatial";
import type {
  NumericalResource,
  ResourcePartition,
  ResourceWindow,
  FieldGeography,
} from "./workspaceResources";
import type { DomainSnapshot, ReadRequirements } from "./operations";
import type { Position } from "./model";
import type { RegionCandidate } from "./regionGeometry";

export interface RegionQuery {
  scope: WorkspaceScope;
  sourceAreaId: string;
  parentId: string | null;
  editingId: string | null;
  cuts: Geometry[];
  position: Position | null;
  viewport: Bounds;
}
export interface RegionChoices {
  revision: number;
  childId: string | null;
  candidates: RegionCandidate[];
}
export interface RegionDrawing {
  query: RegionQuery;
  geometry: Geometry;
  tolerance: number;
}
export interface RegionDrawingResult {
  revision: number;
  cuts: Geometry[];
  candidate: RegionCandidate | null;
  candidates: RegionCandidate[];
}

/** The UI can read configuration without bringing every feature, network and field with it. */
export type WorldMetadata = Omit<
  World,
  | "features"
  | "areas"
  | "entities"
  | "templates"
  | "connections"
  | "networkNodes"
  | "networkReaches"
  | "drainage"
  | "societies"
>;

export interface WorkspaceScope {
  worldId: string;
  spaceId: string;
  areaId: string;
}
export interface RecordReference {
  kind: ObjectKind;
  id: string;
  revision: number;
}
/** A geometry in its stored form: canonical WKB at a precision, and its bounds. */
export interface EncodedShape {
  bytes: Uint8Array;
  bounds: Bounds;
}
/**
 * A record's geometry encoded by its producer at the world's precision. The catalog stores
 * it as given, so a generated record is encoded once on its way to storage.
 */
export interface RecordGeometry {
  precision: number;
  geometry: EncodedShape | null;
  footprint: EncodedShape | null;
  geometryType: string | null;
  /** Bounds of the record's finer representations, which the catalog indexes with it. */
  detailBounds: Bounds[];
}
export interface CatalogRecord {
  scope: WorkspaceScope;
  reference: RecordReference;
  data: DomainWrite;
  encoded?: RecordGeometry;
}
export interface FeatureQuery {
  scope: WorkspaceScope;
  extent: Bounds;
  layers: string[];
  after: string | null;
  limit: number;
  predicate: "intersects" | "covers";
  geometry: Geometry | null;
  /** Only features whose stored geometry is areal. */
  dimension?: "polygon";
}
export interface FeaturePage {
  records: { feature: AtlasFeature; revision: number }[];
  next: string | null;
}
/** Canonical features and their context, pinned to the requested world revision. */
export interface AuthoringPage {
  snapshot: DomainSnapshot;
  next: string | null;
}
export interface AuthoringFeatureQuery {
  scope: ReadRequirements["scope"];
  featureIds: string[];
  layers: string[];
  dependencies: boolean;
}
export interface CatalogChanges {
  operationId: string;
  worldId: string;
  expected: RecordReference[];
  writes: CatalogRecord[];
  removes: RecordReference[];
  resources: NumericalResource[];
  geography?: FieldGeography[];
  metadata?: Partial<Omit<WorldMetadata, "id" | "reference" | "version">>;
  expectedWorldRevision?: number;
  history?: { kind: string; actor: string };
  causes?: import("./generationHistory").CompletedGenerationHistory;
}
export interface WorkspaceChange {
  operationId: string;
  worldId: string;
  revision: number;
  records: RecordReference[];
  /** Bulk operations report kinds without retaining every changed identity in memory. */
  recordKinds?: ObjectKind[];
  extents: { spaceId: string; bounds: Bounds }[];
  geometryExtents?: { spaceId: string; bounds: Bounds }[];
  layers?: string[];
  resources: string[];
}
export interface CatalogPublication {
  worldId: string;
  operationId: string;
  expectedWorldRevision: number;
  history?: CatalogChanges["history"];
}

/** Coarse operations execute beside their data, in a browser worker or a later service. */
export interface SpatialStore {
  createWorld(world: WorldMetadata): Promise<void>;
  readWorld(worldId: string): Promise<WorldMetadata>;
  readRecords(scope: WorkspaceScope, kind: ObjectKind, ids: string[]): Promise<CatalogRecord[]>;
  readFeatures(query: FeatureQuery): Promise<FeaturePage>;
  /** Scale-derived presentation only. Read the canonical feature before editing it. */
  readDisplay(query: FeatureQuery, tolerance: number): Promise<FeaturePage>;
  readAuthoring(input: ReadRequirements): Promise<DomainSnapshot>;
  readAuthoringPage(
    input: AuthoringFeatureQuery,
    after: string | null,
    limit: number
  ): Promise<AuthoringPage>;
  readFieldGeography(scope: WorkspaceScope, id: string): Promise<FieldGeography>;
  regionChoices(query: RegionQuery): Promise<RegionChoices>;
  drawRegion(input: RegionDrawing): Promise<RegionDrawingResult>;
  readHistory(worldId: string, before: number | null, limit: number): Promise<History[]>;
  undo(worldId: string, operationId: string): Promise<WorkspaceChange>;
  commit(changes: CatalogChanges): Promise<WorkspaceChange>;
  beginPublication(input: CatalogPublication): Promise<string>;
  appendPublication(token: string, changes: CatalogChanges): Promise<void>;
  finishPublication(token: string): Promise<WorkspaceChange>;
  discardPublication(token: string): Promise<void>;
  close(): Promise<void>;
}

/** Numerical I/O bypasses the catalog; a window is a stream of bounded partitions. */
export interface ResourceStore {
  describe(id: string): Promise<NumericalResource>;
  create(resource: NumericalResource): Promise<void>;
  readWindow(window: ResourceWindow): AsyncIterable<ResourcePartition>;
  readPartition(
    resourceId: string,
    partitionId: string,
    arrays: string[]
  ): Promise<ResourcePartition>;
  writePartition(resourceId: string, partition: ResourcePartition): Promise<void>;
  finish(resourceId: string): Promise<NumericalResource>;
  remove(resourceId: string): Promise<void>;
}
