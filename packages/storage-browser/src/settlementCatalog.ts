import type { Database } from "@sqlite.org/sqlite-wasm";
import type { SettlementInspection, WorkspaceScope, AtlasFeature } from "@atlas/domain";
import type { FeatureCatalog } from "./featureCatalog";

/**
 * A way names the two places it joins, and a work or an event the place it stands at. These
 * indexes find them from the place.
 */
const schema = `
CREATE INDEX IF NOT EXISTS records_from_place ON records_core(
  world_id,kind,json_extract(data,'$.value.attributes.fromPlace'));
CREATE INDEX IF NOT EXISTS records_to_place ON records_core(
  world_id,kind,json_extract(data,'$.value.attributes.toPlace'));
CREATE INDEX IF NOT EXISTS records_at_place ON records_core(
  world_id,kind,json_extract(data,'$.value.attributes.atPlace'));`;

/** What stands beside one settlement: read from the records that name it. */
export class SettlementCatalog {
  constructor(
    private db: Database,
    private features: FeatureCatalog
  ) {
    db.exec(schema);
  }
  read(scope: WorkspaceScope, featureId: string): SettlementInspection | null {
    const feature = this.features.one(scope, featureId)?.feature;
    if (!feature || feature.kind !== "settlement") return null;
    const beside = this.naming(scope.worldId, feature.id),
      // The places at the far ends of its ways.
      neighbours = beside.flatMap((way) =>
        [way.attributes.fromPlace, way.attributes.toPlace].filter(
          (id): id is string => typeof id === "string" && id !== feature.id
        )
      ),
      realm = typeof feature.attributes.polityId === "string" ? feature.attributes.polityId : null;
    const ids = new Set([
      ...beside.map((found) => found.id),
      ...neighbours,
      ...(realm ? this.territories(scope.worldId, realm) : []),
    ]);
    return { related: this.read_(scope, [...ids]) };
  }
  /** The ways that end at a place, and the works and events recorded at it. */
  private naming(worldId: string, placeId: string): AtlasFeature[] {
    const rows = this.db.selectObjects(
      `SELECT data FROM records_core WHERE world_id=?1 AND kind='feature'
          AND json_extract(data,'$.value.attributes.fromPlace')=?2
       UNION SELECT data FROM records_core WHERE world_id=?1 AND kind='feature'
          AND json_extract(data,'$.value.attributes.toPlace')=?2
       UNION SELECT data FROM records_core WHERE world_id=?1 AND kind='feature'
          AND json_extract(data,'$.value.attributes.atPlace')=?2`,
      [worldId, placeId]
    );
    return rows.map((row) => (JSON.parse(String(row.data)) as { value: AtlasFeature }).value);
  }
  /** The territories of a realm: the records whose relations name it. */
  private territories(worldId: string, realm: string): string[] {
    return this.db
      .selectObjects(
        `SELECT r.id FROM records_core r WHERE r.world_id=? AND r.kind='feature'
          AND json_extract(r.data,'$.value.kind') IN ('sovereignty','control','claim')
          AND EXISTS (SELECT 1 FROM json_each(r.data,'$.value.relations') relation
            WHERE json_extract(relation.value,'$.targetId')=?)`,
        [worldId, realm]
      )
      .map((row) => String(row.id));
  }
  private read_(scope: WorkspaceScope, ids: string[]): AtlasFeature[] {
    return ids.flatMap((id) => {
      const item = this.features.one(scope, id);
      return item ? [item.feature] : [];
    });
  }
}
