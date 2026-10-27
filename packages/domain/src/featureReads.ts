import type { Geometry } from "geojson";
import {
  areaSpace,
  composeFeature,
  composeFootprint,
  isDescendant,
  type CompositionSpatial,
} from "./composition";
import { profiles, type AtlasFeature, type World } from "./model";
import { spatial, type Spatial } from "./spatial";
import { authoredLandmarkFeatures } from "./landmarks";

/** Sources stay owned by world.magic; readers and selection share their semantic identities. */
export function authoredMagicFeatures(world: World): AtlasFeature[] {
  const root = Object.values(world.areas).find((a) => !a.parentId)!.id;
  return world.magic.map((s) => ({
    id: s.id,
    areaId: s.areaId ?? root,
    layerId: "magic",
    kind: "magicSource",
    name: s.name,
    geometry: { type: "Point", coordinates: [s.source.x, s.source.y] },
    detail: {},
    attributes: {
      system: s.systemId ?? "placed",
      rule: "source",
      effect: s.effect,
      radius: s.radius,
      strength: s.strength,
      nameStatus: "proper",
    },
    relations: [],
    state: "authored",
    actor: "user",
    protected: true,
    generationId: null,
    causes: [],
  }));
}
export function canonicalFeatures(world: World, gis?: Pick<Spatial, "buffer">) {
  const result = new Map(Object.values(world.features).map((f) => [f.id, f]));
  for (const source of authoredMagicFeatures(world)) result.set(source.id, source);
  for (const landmark of authoredLandmarkFeatures(world, gis)) result.set(landmark.id, landmark);
  return [...result.values()];
}
export function featureIntersects(
  feature: Pick<AtlasFeature, "geometry" | "footprint">,
  extent: Geometry,
  gis: Pick<Spatial, "intersects"> = spatial
) {
  return (
    gis.intersects(feature.geometry, extent) ||
    Boolean(feature.footprint && gis.intersects(feature.footprint, extent))
  );
}
export function presentAtlasFeature(
  world: World,
  feature: AtlasFeature,
  areaId: string,
  gis?: CompositionSpatial & Pick<Spatial, "intersects">
) {
  const area = world.areas[areaId],
    owner = world.areas[feature.areaId];
  if (areaSpace(world, owner.id) !== areaSpace(world, areaId)) return null;
  if (profiles.indexOf(owner.profile) > profiles.indexOf(area.profile)) return null;
  if (!isDescendant(world.areas, areaId, owner.id)) return null;
  const geometry = composeFeature(world, feature, [], area.profile, areaId, gis);
  if (!geometry) return null;
  const footprint = composeFootprint(world, feature, area.profile, areaId, gis);
  if (!featureIntersects({ geometry, footprint: footprint ?? undefined }, area.footprint, gis))
    return null;
  const result = {
    ...feature,
    geometry,
    ...representationMetadata(world, feature, areaId),
  };
  delete result.footprint;
  if (footprint) result.footprint = footprint;
  return result;
}
function representationMetadata(world: World, feature: AtlasFeature, areaId: string) {
  let id: string | null = areaId;
  while (id && !feature.detail[id]) id = world.areas[id].parentId;
  const detail = id ? feature.detail[id] : undefined;
  if (!detail || detail.needsReconciliation || ["stale", "unmaterialized"].includes(detail.state))
    return {};
  return {
    attributes: detail.attributes ?? feature.attributes,
    state: detail.state,
    actor: detail.actor,
    protected: detail.protected,
    generationId: detail.generationId,
    ...(detail.mapOnly ? { mapOnly: true } : {}),
  };
}
export function readAtlasFeatures(world: World, areaId?: string, extent?: Geometry) {
  return canonicalFeatures(world).flatMap((feature) => {
    const presented = presentAtlasFeature(world, feature, areaId ?? feature.areaId);
    if (!presented || (extent && !featureIntersects(presented, extent))) return [];
    return [presented];
  });
}
