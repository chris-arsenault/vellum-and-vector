import { areaSpace, isDescendant, type SpatialScope } from "@atlas/domain";
import type { SpatialCatalog } from "@atlas/storage-browser";

export async function generationSource(catalog: SpatialCatalog, worldId: string, areaId: string) {
  const world = await catalog.readEditor(worldId),
    area = world.areas[areaId];
  if (!area) throw new Error("Choose an existing mapped area.");
  const stateAreas = Object.keys(world.areas).filter(
    (id) => isDescendant(world.areas, areaId, id) || isDescendant(world.areas, id, areaId)
  );
  const related = new Set(stateAreas),
    spaceId = areaSpace(world, areaId);
  const fields = world.fields.filter(
    (field) => related.has(field.areaId) && areaSpace(world, field.areaId) === spaceId
  );
  const scope: SpatialScope = {
    worldId,
    areaId,
    spaceId,
    crsId: world.reference.id,
    footprint: area.footprint,
    revision: world.version,
    time: "present",
    resolution: null,
  };
  return catalog.readAuthoring({
    scope,
    objects: [
      { kind: "area", ids: stateAreas },
      { kind: "entity", ids: Object.keys(world.entities) },
      { kind: "field", ids: fields.map((field) => field.id) },
      {
        kind: "view",
        ids: world.views.filter((view) => related.has(view.areaId)).map((view) => view.id),
      },
      {
        kind: "magic",
        ids: world.magic
          .filter((source) => !source.areaId || related.has(source.areaId))
          .map((source) => source.id),
      },
      {
        kind: "landmark",
        ids: world.landmarks
          .filter((source) => !source.areaId || related.has(source.areaId))
          .map((source) => source.id),
      },
      { kind: "society", ids: stateAreas.map((id) => `society:${id}`) },
      { kind: "drainage", ids: stateAreas.map((id) => `drainage:${id}`) },
    ],
    spatialLayers: [],
    channels: fields.map((field) => ({ fieldId: field.id, names: field.channels ?? [] })),
    dependencies: false,
    parentHistory: [],
    constraints: {
      intersectingAreas: true,
      descendantsOf: [areaId],
      boundaryFeatures: [],
    },
  });
}
