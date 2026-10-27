import type { Database } from "@sqlite.org/sqlite-wasm";
import {
  requireThat,
  type SpatialStore,
  type WorldMetadata,
  type WorkspaceScope,
  type ObjectKind,
  type CatalogChanges,
  type WorkspaceChange,
  type FeatureQuery,
  type FeaturePage,
  type Bounds,
  type CatalogPublication,
  type RegionQuery,
  type RegionDrawing,
  type ReadRequirements,
  type RegistryRequest,
  type AuthoringFeatureQuery,
} from "@atlas/domain";
import { catalogSchema } from "./catalogSchema";
import { decodeRecord } from "./catalogRecords";
import type { GeometryKernel } from "./geometryKernel";
import { BoundaryIndex } from "./boundaryIndex";
import { BoundaryTiles, regionTopologyTileMetres } from "./boundaryTiles";
import { RegionCatalog } from "./regionCatalog";
import { CatalogProjection } from "./catalogProjection";
import { FeatureCatalog } from "./featureCatalog";
import { BoundaryProjection } from "./boundaryProjection";
import { CatalogHistory } from "./catalogHistory";
import { FieldGeographyCatalog } from "./fieldGeography";
import { RegistryCatalog } from "./registryCatalog";
import { SettlementCatalog } from "./settlementCatalog";
import { PresentationCatalog } from "./presentationCatalog";
import { exportFeaturePage } from "./exportCatalog";
import { CatalogMutation } from "./catalogMutation";
import { PublicationStaging } from "./catalogPublication";

export class SpatialCatalog implements SpatialStore {
  readonly boundaries: BoundaryIndex;
  readonly boundaryTiles: BoundaryTiles;
  private regions: RegionCatalog;
  private projection: CatalogProjection;
  private features: FeatureCatalog;
  private topology: BoundaryProjection;
  private journal: CatalogHistory;
  private geography: FieldGeographyCatalog;
  private registry: RegistryCatalog;
  private settlements: SettlementCatalog;
  private presentation: PresentationCatalog;
  private mutation: CatalogMutation;
  private publication: PublicationStaging;
  constructor(
    private db: Database,
    private kernel: GeometryKernel,
    tileMetres = regionTopologyTileMetres
  ) {
    db.exec(catalogSchema);
    this.journal = new CatalogHistory(db, kernel);
    this.geography = new FieldGeographyCatalog(db, kernel);
    this.projection = new CatalogProjection(db, kernel);
    this.features = new FeatureCatalog(db, kernel, this.projection);
    this.registry = new RegistryCatalog(db, this.projection, this.features, kernel);
    this.settlements = new SettlementCatalog(db, this.features);
    this.presentation = new PresentationCatalog(db, this.features);
    this.boundaries = new BoundaryIndex(db, kernel);
    this.boundaryTiles = new BoundaryTiles(this.boundaries, kernel, tileMetres);
    this.topology = new BoundaryProjection(
      db,
      this.boundaries,
      this.boundaryTiles,
      this.features,
      this.projection
    );
    this.boundaries.prepare = (scope, extent) => this.topology.ensure(scope, extent);
    this.regions = new RegionCatalog(db, this.boundaryTiles, (query) => this.readFeatures(query));
    this.mutation = new CatalogMutation(db, kernel, {
      journal: this.journal,
      projection: this.projection,
      registry: this.registry,
      topology: this.topology,
      tiles: this.boundaryTiles,
      geography: this.geography,
    });
    this.publication = new PublicationStaging(db, this.mutation);
  }
  regionChoices(query: RegionQuery) {
    return this.regions.choices(query);
  }
  drawRegion(input: RegionDrawing) {
    return this.regions.draw(input);
  }
  async createWorld(world: WorldMetadata) {
    this.db.exec({
      sql: "INSERT INTO worlds VALUES(?,?,?)",
      bind: [world.id, world.version, JSON.stringify(world)],
    });
  }
  async readWorld(worldId: string): Promise<WorldMetadata> {
    const row = this.db.selectObject("SELECT data,revision FROM worlds WHERE id=?", [worldId]);
    requireThat(row, "missing_world", "Choose an existing world.");
    return { ...JSON.parse(String(row.data)), version: Number(row.revision) };
  }
  async readRecords(scope: WorkspaceScope, kind: ObjectKind, ids: string[]) {
    return ids.flatMap((id) => {
      const row = this.db.selectObject(
        "SELECT * FROM records WHERE world_id=? AND space_id=? AND area_id=? AND kind=? AND id=?",
        [scope.worldId, scope.spaceId, scope.areaId, kind, id]
      );
      return row ? [decodeRecord(row, this.kernel)] : [];
    });
  }
  async readFeatures(query: FeatureQuery): Promise<FeaturePage> {
    return this.features.read(query);
  }
  async readDisplay(query: FeatureQuery, tolerance: number) {
    return this.features.read(query, tolerance);
  }
  async readAuthoring(input: ReadRequirements) {
    return this.projection.read(input);
  }
  async readAuthoringPage(input: AuthoringFeatureQuery, after: string | null, limit: number) {
    return this.projection.readPage(input, after, limit);
  }
  async readEditor(worldId: string) {
    return this.projection.editor(worldId);
  }
  async readRegistry(input: RegistryRequest) {
    return this.registry.read(input);
  }
  async readSettlement(scope: WorkspaceScope, id: string) {
    return this.settlements.read(scope, id);
  }
  async readConnections(scope: WorkspaceScope) {
    return this.presentation.connections(scope);
  }
  async readLayerPresentation(worldId: string, layerId: string) {
    return this.presentation.layer(worldId, layerId);
  }
  async readFeature(scope: WorkspaceScope, id: string) {
    const item = this.features.one(scope, id);
    requireThat(item, "missing_feature", "Choose an existing geographic feature.");
    return item.feature;
  }
  async readFieldGeography(scope: WorkspaceScope, id: string) {
    return this.geography.read(scope, id);
  }
  async readFieldWindow(scope: WorkspaceScope, id: string, extent: Bounds, tolerance = 0) {
    return this.geography.window(scope, id, extent, tolerance);
  }
  async readHistory(worldId: string, before: number | null, limit: number) {
    return this.journal.read(worldId, before, limit);
  }
  async readCauses(worldId: string, areaId: string) {
    return this.journal.causes(worldId, areaId);
  }
  snapshot(path: string) {
    this.db.exec({ sql: "VACUUM INTO ?", bind: [path] });
  }
  exportFeatures(worldId: string, areaId: string | undefined, after: string | null, limit: number) {
    return exportFeaturePage(this.db, this.projection, worldId, areaId, after, limit);
  }
  /** The released snapshot save format carries revision gaps after undo. Import each
   * historical state through the normal writer, then retain its original history identity. */
  async importRevision(
    changes: CatalogChanges,
    version: number,
    history?: import("@atlas/domain").History
  ) {
    const result = await this.commit(changes);
    this.db.transaction(() => {
      this.db.exec({
        sql: "UPDATE worlds SET revision=? WHERE id=?",
        bind: [version, changes.worldId],
      });
      this.db.exec({
        sql: "UPDATE records_core SET revision=? WHERE world_id=? AND revision=?",
        bind: [version, changes.worldId, result.revision],
      });
      if (history)
        this.db.exec({
          sql: "UPDATE operations SET revision=?,actor=?,kind=?,at=? WHERE world_id=? AND operation_id=?",
          bind: [
            history.version,
            history.actor,
            history.kind,
            history.at,
            changes.worldId,
            changes.operationId,
          ],
        });
      else this.journal.remove(changes.worldId, changes.operationId);
    });
  }
  importCauses(worldId: string, causes: Record<string, import("@atlas/domain").EpochHistory[]>) {
    this.db.transaction(() => {
      for (const [areaId, entries] of Object.entries(causes))
        this.journal.recordCauses(worldId, { runId: crypto.randomUUID(), areaId, entries });
    });
  }
  async undo(worldId: string, operationId: string) {
    return this.mutation.commit(
      worldId,
      operationId,
      this.journal.inverse(worldId, operationId),
      true,
      operationId
    );
  }
  async commit(changes: CatalogChanges): Promise<WorkspaceChange> {
    return this.mutation.commit(changes.worldId, changes.operationId, [changes], false);
  }
  async beginPublication(input: CatalogPublication) {
    return this.publication.begin(input);
  }
  async appendPublication(token: string, changes: CatalogChanges) {
    this.publication.append(token, changes);
  }
  async finishPublication(token: string) {
    return this.publication.finish(token);
  }
  async discardPublication(token: string) {
    this.publication.discard(token);
  }
  async close() {
    this.kernel.close();
    this.db.close();
  }
}
