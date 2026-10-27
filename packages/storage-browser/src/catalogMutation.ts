import type { Database } from "@sqlite.org/sqlite-wasm";
import {
  requireThat,
  spatial,
  type CatalogChanges,
  type CatalogRecord,
  type RecordReference,
  type WorldMetadata,
  type WorkspaceChange,
  type NumericalResource,
  type Bounds,
} from "@atlas/domain";
import { writeRecord } from "./catalogRecords";
import type { GeometryKernel } from "./geometryKernel";
import type { CatalogHistory } from "./catalogHistory";
import type { CatalogProjection } from "./catalogProjection";
import type { RegistryCatalog } from "./registryCatalog";
import type { BoundaryProjection } from "./boundaryProjection";
import type { BoundaryTiles } from "./boundaryTiles";
import type { FieldGeographyCatalog } from "./fieldGeography";
import { ChangeAccumulator } from "./changeAccumulator";

interface Components {
  journal: CatalogHistory;
  projection: CatalogProjection;
  registry: RegistryCatalog;
  topology: BoundaryProjection;
  tiles: BoundaryTiles;
  geography: FieldGeographyCatalog;
}
/** A synchronous transaction consumes one batch at a time. No decoded result is retained. */
export class CatalogMutation {
  constructor(
    private db: Database,
    private kernel: GeometryKernel,
    private parts: Components
  ) {}
  commit(
    worldId: string,
    operationId: string,
    batches: Iterable<CatalogChanges>,
    bulk: boolean,
    undoOf?: string
  ) {
    const result = new ChangeAccumulator(worldId, operationId, bulk);
    this.db.transaction(() => {
      const world = this.parts.projection.metadata(worldId);
      result.value.revision = world.version + 1;
      const metadata: CatalogChanges["metadata"] = {};
      if (undoOf) this.parts.journal.requireLatest(worldId, undoOf);
      for (const batch of batches) {
        requireThat(
          batch.worldId === worldId && batch.operationId === operationId,
          "publication_identity",
          "All publication batches belong to one world and operation."
        );
        this.validate(batch, world);
        if (!undoOf) this.parts.journal.record(batch, world, result.value.revision);
        this.apply(batch, world, result, undoOf);
        Object.assign(metadata, batch.metadata);
      }
      this.updateWorld(world, metadata, result.value.revision);
      this.parts.registry.advance(worldId, result.value.revision);
      if (undoOf) this.parts.journal.remove(worldId, undoOf);
    });
    for (const change of result.value.geometryExtents!)
      this.parts.tiles.invalidate({ worldId, spaceId: change.spaceId }, change.bounds);
    return result.value;
  }
  private validate(changes: CatalogChanges, world: WorldMetadata) {
    requireThat(
      changes.expectedWorldRevision === undefined ||
        changes.expectedWorldRevision === world.version,
      "stale_version",
      "The world changed. Your edits were kept. Review the current geography before trying again."
    );
    for (const expected of changes.expected) {
      const actual =
        this.db.selectValue(
          "SELECT revision FROM records_core WHERE world_id=? AND kind=? AND id=?",
          [world.id, expected.kind, expected.id]
        ) ?? 0;
      requireThat(
        actual === expected.revision,
        "stale_version",
        `Record ${expected.id} changed; read the current version.`
      );
    }
  }
  private apply(
    changes: CatalogChanges,
    world: WorldMetadata,
    result: ChangeAccumulator,
    undoOf?: string
  ) {
    const references = [...changes.writes.map((write) => write.reference), ...changes.removes];
    result.layers(this.recordLayers(world.id, references));
    const extents: WorkspaceChange["extents"] = [],
      geometry: WorkspaceChange["extents"] = [];
    for (const record of changes.writes) {
      requireThat(
        record.scope.worldId === world.id,
        "record_scope",
        "Write must belong to the command's world."
      );
      this.requireExpected(changes, record.reference);
      this.parts.registry.changed(world.id, record.reference, record);
      this.put(record, result.value.revision, world, extents, geometry, undoOf);
      this.parts.registry.changed(world.id, record.reference, record);
    }
    for (const remove of changes.removes) {
      this.requireExpected(changes, remove);
      this.parts.registry.changed(world.id, remove);
      geometry.push(...this.parts.topology.changed(world.id, remove));
      this.affected(world.id, remove, geometry);
      this.affected(world.id, remove, extents);
      this.db.exec({
        sql: "DELETE FROM records_core WHERE world_id=? AND kind=? AND id=?",
        bind: [world.id, remove.kind, remove.id],
      });
    }
    this.publishResources(world, changes);
    if (changes.causes) this.parts.journal.recordCauses(world.id, changes.causes);
    result.add(
      references,
      extents,
      geometry,
      changes.resources.map((r) => r.id)
    );
    result.layers(this.recordLayers(world.id, references));
  }
  private recordLayers(worldId: string, references: RecordReference[]) {
    return this.db
      .selectValues(
        "SELECT DISTINCT layer_id FROM records_core WHERE world_id=? AND layer_id IS NOT NULL AND id IN (SELECT value FROM json_each(?))",
        [worldId, JSON.stringify(references.map((r) => r.id))]
      )
      .map(String);
  }
  private updateWorld(world: WorldMetadata, changes: CatalogChanges["metadata"], revision: number) {
    const metadata: Record<string, unknown> = { ...world, ...changes, version: revision };
    for (const key of Object.keys(metadata)) if (metadata[key] === undefined) delete metadata[key];
    metadata.featureCount = Number(
      this.db.selectValue("SELECT count(*) FROM records_core WHERE world_id=? AND kind='feature'", [
        world.id,
      ])
    );
    this.db.exec({
      sql: "UPDATE worlds SET revision=?,data=? WHERE id=?",
      bind: [revision, JSON.stringify(metadata), world.id],
    });
  }
  private publishResources(world: WorldMetadata, changes: CatalogChanges) {
    for (const resource of changes.resources) this.publishResource(world.id, resource);
    for (const geography of changes.geography ?? []) {
      requireThat(
        geography.scope.worldId === world.id,
        "field_geography",
        "Field geography belongs to the publication world."
      );
      this.parts.geography.write(geography, world.reference.precision ?? spatial.precision);
    }
  }
  private put(
    record: CatalogRecord,
    revision: number,
    world: WorldMetadata,
    extents: WorkspaceChange["extents"],
    geometry: WorkspaceChange["extents"],
    undoOf?: string
  ) {
    const start = extents.length;
    this.affected(world.id, record.reference, extents);
    const written = writeRecord(
      this.db,
      this.kernel,
      record,
      revision,
      world.reference.precision ?? spatial.precision,
      undoOf
        ? this.db.selectObject(
            "SELECT geometry_id,footprint_id FROM operation_records WHERE world_id=? AND operation_id=? AND kind=? AND id=?",
            [world.id, undoOf, record.reference.kind, record.reference.id]
          )
        : undefined
    );
    this.affected(world.id, record.reference, extents);
    if (written.changed)
      geometry.push(
        ...extents.slice(start),
        ...this.parts.topology.changed(world.id, record.reference)
      );
  }
  private publishResource(worldId: string, resource: NumericalResource) {
    requireThat(
      resource.state === "ready" && resource.scope.worldId === worldId,
      "resource_publication",
      "Publish only ready resources belonging to this world."
    );
    const data = JSON.stringify(resource),
      previous = this.db.selectValue("SELECT data FROM resources WHERE id=?", [resource.id]);
    requireThat(
      previous === undefined || previous === data,
      "resource_immutable",
      "Published resource identities are immutable."
    );
    this.db.exec({
      sql: "INSERT OR IGNORE INTO resources VALUES(?,?,?)",
      bind: [resource.id, worldId, data],
    });
  }
  private requireExpected(changes: CatalogChanges, reference: RecordReference) {
    requireThat(
      changes.expected.some((r) => r.kind === reference.kind && r.id === reference.id),
      "missing_revision",
      "Every changed record needs its expected revision; use zero for creation."
    );
  }
  private affected(world: string, reference: RecordReference, extents: WorkspaceChange["extents"]) {
    const row = this.db.selectObject(
      `SELECT r.space_id,b.min_x,b.min_y,b.max_x,b.max_y FROM records_core r JOIN record_bounds b USING(record_id)
      WHERE r.world_id=? AND r.kind=? AND r.id=?`,
      [world, reference.kind, reference.id]
    );
    if (row)
      extents.push({
        spaceId: String(row.space_id),
        bounds: [row.min_x, row.min_y, row.max_x, row.max_y].map(Number) as Bounds,
      });
  }
}
