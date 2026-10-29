import type { Database } from "@sqlite.org/sqlite-wasm";
import {
  areaSpace,
  canonicalFeatures,
  composeFeature,
  composeFootprint,
  presentAtlasFeature,
} from "@atlas/domain";
import type { CatalogProjection } from "./catalogProjection";

/** Resolve one semantic feature and its finer representations at a time. */
export function exportFeaturePage(
  db: Database,
  projection: CatalogProjection,
  worldId: string,
  areaId: string | undefined,
  after: string | null,
  limit: number
) {
  const owned =
    areaId &&
    db.selectValue(
      "SELECT json_type(data,'$.value.map') IS NOT NULL OR json_extract(data,'$.value.parentId') IS NULL FROM records_core WHERE world_id=? AND kind='area' AND id=?",
      [worldId, areaId]
    );
  const owner = owned ? areaId! : null;
  const rows = db.selectObjects(
    `SELECT id,area_id FROM records_core r WHERE world_id=?
    AND kind IN ('feature','landmark','magic') AND id>? AND (? IS NULL OR area_id=?)
    AND (kind<>'feature' OR NOT EXISTS(SELECT 1 FROM records_core s WHERE s.world_id=r.world_id
      AND s.id=r.id AND s.kind IN ('landmark','magic'))) ORDER BY id LIMIT ?`,
    [worldId, after ?? "", owner, owner, limit]
  );
  const features = rows.flatMap((row) => {
    const world = projection.context(
      worldId,
      areaId ?? String(row.area_id),
      [String(row.id)],
      areaId === undefined
    ).world;
    const source = canonicalFeatures(world).find((feature) => feature.id === String(row.id));
    if (!source) return [];
    const feature = areaId ? presentAtlasFeature(world, source, areaId) : source;
    if (!feature) return [];
    return [
      {
        type: "Feature",
        id: feature.id,
        geometry: areaId ? feature.geometry : composeFeature(world, feature),
        properties: {
          ...feature.attributes,
          name: feature.name,
          placeId: feature.placeId ?? feature.id,
          kind: feature.kind,
          layerId: feature.layerId,
          footprint: areaId ? feature.footprint : composeFootprint(world, feature),
          representations: source.detail,
          areaId: feature.areaId,
          spaceId: areaSpace(world, feature.areaId),
          state: feature.state,
          protected: feature.protected,
          actor: feature.actor,
          relations: feature.relations,
          causes: feature.causes,
        },
      },
    ];
  });
  return { features, next: rows.length === limit ? String(rows.at(-1)!.id) : null };
}
