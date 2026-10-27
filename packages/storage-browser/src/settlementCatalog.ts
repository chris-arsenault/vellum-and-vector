import type { Database, SqlValue } from "@sqlite.org/sqlite-wasm";
import type {
  SocietyRegion,
  SettlementInspection,
  WorkspaceScope,
  AtlasFeature,
} from "@atlas/domain";
import type { FeatureCatalog } from "./featureCatalog";

/** Extract just the selected community's retained context in SQLite. */
export class SettlementCatalog {
  constructor(
    private db: Database,
    private features: FeatureCatalog
  ) {}
  read(scope: WorkspaceScope, featureId: string): SettlementInspection | null {
    const feature = this.features.one(scope, featureId)?.feature;
    if (!feature || typeof feature.attributes.communityId !== "string") return null;
    const row = this.db.selectObject(
      `SELECT record_id FROM records_core WHERE world_id=? AND kind='society'
      AND area_id IN (?,?) AND EXISTS (SELECT 1 FROM json_each(data,'$.value.communities') c
        WHERE json_extract(c.value,'$.id')=?) ORDER BY area_id=? DESC LIMIT 1`,
      [scope.worldId, scope.areaId, feature.areaId, feature.attributes.communityId, scope.areaId]
    );
    if (!row) return null;
    const id = Number(row.record_id),
      communityId = feature.attributes.communityId;
    const region: SocietyRegion = JSON.parse(
      String(
        this.db.selectValue(
          `SELECT json_remove(json_extract(data,'$.value'),
      '$.id','$.communities','$.connections','$.works','$.events','$.magic','$.politics') FROM records_core WHERE record_id=?`,
          [id]
        )
      )
    );
    region.connections = this.entries(
      id,
      "connections",
      "json_extract(j.value,'$.from')=? OR json_extract(j.value,'$.to')=?",
      [communityId, communityId]
    );
    const neighbours = [
      ...new Set([communityId, ...region.connections.flatMap((link) => [link.from, link.to])]),
    ];
    region.communities = this.entries(
      id,
      "communities",
      "json_extract(j.value,'$.id') IN (SELECT value FROM json_each(?))",
      [JSON.stringify(neighbours)]
    );
    region.works = this.entries(
      id,
      "works",
      `json_extract(j.value,'$.communityId')=? OR EXISTS
      (SELECT 1 FROM json_each(j.value,'$.country') WHERE value=?)`,
      [communityId, communityId]
    );
    region.events = this.entries(
      id,
      "events",
      "EXISTS (SELECT 1 FROM json_each(j.value,'$.communities') WHERE value=?)",
      [communityId]
    );
    region.magic = this.entries(id, "magic", "json_extract(j.value,'$.communityId')=?", [
      communityId,
    ]);
    const polities = [
      String(feature.attributes.polityId ?? ""),
      ...(Array.isArray(feature.attributes.capitalOf)
        ? feature.attributes.capitalOf.map(String)
        : []),
    ].filter(Boolean);
    region.politics = {
      polities: this.entries(
        id,
        "politics.polities",
        "json_extract(j.value,'$.id') IN (SELECT value FROM json_each(?))",
        [JSON.stringify(polities)]
      ),
      sovereignty: {},
      control: {},
      contested: {},
      history: [],
    };
    return { region, related: this.related(scope, region, neighbours, polities) };
  }
  private entries<T>(id: number, path: string, where: string, values: SqlValue[]): T[] {
    return this.db
      .selectValues(
        `SELECT j.value FROM records_core r,json_each(r.data,?) j
      WHERE r.record_id=? AND (${where})`,
        [`$.value.${path}`, id, ...values]
      )
      .map((value) => JSON.parse(String(value)) as T);
  }
  private related(
    scope: WorkspaceScope,
    region: SocietyRegion,
    neighbours: string[],
    polities: string[]
  ): AtlasFeature[] {
    const ids = [
      ...region.works.flatMap((work) => [work.id, `work:${work.id}`]),
      ...polities.flatMap((id) => [`control:${id}`, `sovereignty:${id}`]),
    ];
    const rows = this.db.selectObjects(
      `SELECT id,area_id,space_id FROM records_core WHERE world_id=? AND kind='feature'
      AND (id IN (SELECT value FROM json_each(?)) OR (json_extract(data,'$.value.kind')='settlement'
        AND json_extract(data,'$.value.attributes.communityId') IN (SELECT value FROM json_each(?))))`,
      [scope.worldId, JSON.stringify(ids), JSON.stringify(neighbours)]
    );
    return rows.flatMap((row) => {
      const item = this.features.one(
        { worldId: scope.worldId, areaId: String(row.area_id), spaceId: String(row.space_id) },
        String(row.id)
      );
      return item ? [item.feature] : [];
    });
  }
}
