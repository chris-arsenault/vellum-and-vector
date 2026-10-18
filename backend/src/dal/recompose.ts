import { composeFeature, areaSpace, type World } from "@atlas/domain";
import type { Sql } from "./database";
import { readFeatures } from "./objectReaders";
import { ancestorIds, readAreas } from "./areaReader";
import { bindingSourceIds, dependentIds, featureAreaIds } from "./selection";
import { writeSpatialRows, type ComposedSpatialRow } from "./spatialRows";

export async function recomposeFeatures(
  sql: Sql,
  world: World,
  changed: string[]
): Promise<string[]> {
  const affected = await dependentIds(sql, world.id, world.version, changed);
  const selected = await bindingSourceIds(sql, world.id, world.version, affected);
  const features = await readFeatures(sql, world.id, world.version, selected);
  const areaIds = await featureAreaIds(sql, world.id, world.version, selected);
  const ancestors = await ancestorIds(sql, world.id, world.version, areaIds);
  const areas = await readAreas(sql, world.id, world.version, ancestors);
  const context = { ...world, features: features.objects, areas: areas.objects };
  const composed: ComposedSpatialRow[] = [];
  for (const id of affected) {
    const feature = context.features[id];
    if (!feature) continue;
    const geometry = composeFeature(context, feature);
    if (geometry)
      composed.push({
        featureId: id,
        spaceId: areaSpace(context, feature.areaId),
        layerId: feature.layerId,
        geometry,
      });
  }
  await writeSpatialRows(sql, world.id, world.version, affected, composed);
  return affected;
}
