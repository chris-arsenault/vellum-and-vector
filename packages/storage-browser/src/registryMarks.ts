import type { Database } from "@sqlite.org/sqlite-wasm";
import type { Area, CatalogRecord, RecordReference } from "@atlas/domain";
import type { CatalogProjection } from "./catalogProjection";
import type { GeometryKernel } from "./geometryKernel";

/** Marks, in every built registry scope, the features a write can affect. Only entity writes
 * still drop whole scopes. */
export class RegistryMarks {
  constructor(
    private db: Database,
    private projection: CatalogProjection,
    private kernel: GeometryKernel
  ) {}
  changed(worldId: string, reference: RecordReference, next?: CatalogRecord) {
    if (this.changedContext(worldId, reference, next)) return;
    const id = this.changedFeature(worldId, reference);
    if (!id) return;
    this.db.exec({
      sql: `WITH RECURSIVE affected(id) AS (SELECT ? UNION SELECT r.id FROM affected a
        JOIN record_links l ON l.world_id=? AND l.target=a.id AND l.relation IN ('follows','dependsOn')
        JOIN records_core r ON r.record_id=l.source)
        INSERT OR IGNORE INTO registry_marks SELECT s.world_id,s.scope,a.id
        FROM affected a,registry_scopes s WHERE s.world_id=?`,
      bind: [id, worldId, worldId],
    });
  }
  /** Area, layer, society and entity writes: true when handled here. */
  private changedContext(worldId: string, reference: RecordReference, next?: CatalogRecord) {
    switch (reference.kind) {
      case "area":
        if (next?.data.kind === "area" && this.unchangedArea(worldId, next.data.value)) return true;
        this.markWhere(
          worldId,
          `r.area_id IN (WITH RECURSIVE descendants(id) AS (SELECT ? UNION SELECT a.id FROM records_core a
            JOIN descendants d ON json_extract(a.data,'$.value.parentId')=d.id WHERE a.world_id=? AND a.kind='area')
            SELECT id FROM descendants)`,
          [reference.id, worldId]
        );
        return true;
      case "layer":
        this.markWhere(worldId, "r.layer_id=?", [reference.id]);
        return true;
      case "society":
        this.markWhere(worldId, "r.area_id=?", [
          next?.data.kind === "society"
            ? next.data.value.areaId
            : String(reference.id).replace(/^society:/, ""),
        ]);
        return true;
      case "entity":
        this.db.exec({ sql: "DELETE FROM registry_scopes WHERE world_id=?", bind: [worldId] });
        return true;
      default:
        return false;
    }
  }
  private changedFeature(worldId: string, reference: RecordReference) {
    if (reference.kind === "representation")
      return this.db.selectValue(
        "SELECT json_extract(data,'$.value.featureId') FROM records_core WHERE world_id=? AND kind='representation' AND id=?",
        [worldId, reference.id]
      );
    return ["feature", "magic", "landmark"].includes(reference.kind) ? reference.id : null;
  }
  /** Features owned by, or represented in, the matching areas become dirty. */
  private markWhere(worldId: string, where: string, bind: (string | number)[]) {
    this.db.exec({
      sql: `INSERT OR IGNORE INTO registry_marks
        SELECT s.world_id,s.scope,CASE WHEN r.kind='representation' THEN json_extract(r.data,'$.value.featureId') ELSE r.id END
        FROM records_core r JOIN registry_scopes s ON s.world_id=r.world_id
        WHERE r.world_id=? AND r.kind IN ('feature','magic','landmark','representation') AND ${where}`,
      bind: [worldId, ...bind],
    });
  }
  private unchangedArea(worldId: string, after: Area) {
    const previous = this.db.selectValue(
      "SELECT data FROM records WHERE world_id=? AND kind='area' AND id=?",
      [worldId, after.id]
    );
    if (previous === undefined) return false;
    const before = JSON.parse(String(previous)).value,
      keys = ["name", "parentId", "profile", "context", "spaceId", "frame", "map"] as const,
      footprint = this.kernel.encode(
        after.footprint,
        this.projection.metadata(worldId).reference.precision ?? 1e-6
      ).bytes;
    return (
      keys.every((key) => JSON.stringify(before[key]) === JSON.stringify(after[key])) &&
      this.db.selectValue(
        "SELECT footprint IS ? FROM records WHERE world_id=? AND kind='area' AND id=?",
        [footprint, worldId, after.id]
      ) === 1
    );
  }
}
