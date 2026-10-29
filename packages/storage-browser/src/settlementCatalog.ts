import type { Database } from "@sqlite.org/sqlite-wasm";
import type {
  SocietyRegion,
  SettlementInspection,
  WorkspaceScope,
  AtlasFeature,
} from "@atlas/domain";
import type { FeatureCatalog } from "./featureCatalog";
import type { CommunityIndex } from "./communityIndex";

/** The selected community's retained context, read from the community index. */
export class SettlementCatalog {
  constructor(
    private db: Database,
    private features: FeatureCatalog,
    private index: CommunityIndex
  ) {}
  read(scope: WorkspaceScope, featureId: string): SettlementInspection | null {
    const feature = this.features.one(scope, featureId)?.feature;
    if (!feature || typeof feature.attributes.communityId !== "string") return null;
    const communityId = feature.attributes.communityId;
    const found = this.index.slice(scope.worldId, communityId, [scope.areaId, feature.areaId]);
    if (!found) return null;
    const { recordId, slice } = found;
    const region = this.index.base(recordId);
    region.connections = slice.connections;
    const neighbours = [
      ...new Set([communityId, ...region.connections.flatMap((link) => [link.from, link.to])]),
    ];
    region.communities = this.index.communities(recordId, neighbours);
    region.works = slice.works;
    region.events = slice.events;
    region.magic = slice.magic;
    const polities = [
      String(feature.attributes.polityId ?? ""),
      ...(Array.isArray(feature.attributes.capitalOf)
        ? feature.attributes.capitalOf.map(String)
        : []),
    ].filter(Boolean);
    region.politics = {
      polities: this.index.polities(recordId, polities),
      sovereignty: {},
      control: {},
      contested: {},
      history: [],
    };
    return { region, related: this.related(scope, region, neighbours, polities) };
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
    // Two indexed lookups: by identity, and by community through the expression index.
    const rows = this.db.selectObjects(
      `SELECT id,area_id,space_id FROM records_core WHERE world_id=? AND kind='feature'
        AND id IN (SELECT value FROM json_each(?))
      UNION SELECT id,area_id,space_id FROM records_core WHERE world_id=? AND kind='feature'
        AND json_extract(data,'$.value.attributes.communityId') IN (SELECT value FROM json_each(?))
        AND json_extract(data,'$.value.kind')='settlement'`,
      [scope.worldId, JSON.stringify(ids), scope.worldId, JSON.stringify(neighbours)]
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
