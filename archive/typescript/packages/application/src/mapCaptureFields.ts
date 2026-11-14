import {
  semanticId,
  spatial,
  geographyAreas,
  polygonGeometry,
  type Area,
  type CatalogChanges,
  type DomainSnapshot,
  type FieldRef,
  type NumericalResource,
  type SpatialStore,
} from "@atlas/domain";
import type { FieldInputStore } from "@atlas/storage-browser";

/** Capture immutable resource identities once; later map revisions cannot replace these inputs. */
export async function captureMapFields(
  catalog: SpatialStore,
  store: FieldInputStore,
  source: DomainSnapshot,
  area: Area,
  fields: FieldRef[],
  publication: CatalogChanges
) {
  const layouts = new Map<string, string>();
  for (const field of fields) {
    if (!field.resourceId) continue;
    const original = await store.describe(field.resourceId);
    if (!original.field || !spatial.intersects(original.field.scope.footprint, area.footprint))
      continue;
    const layoutId = await captureLayout(
        catalog,
        store,
        source,
        area,
        original,
        layouts,
        publication
      ),
      id = semanticId(source.world.id, `map:${area.id}:field`, field.id),
      resource = aliasResource(
        original,
        semanticId(
          source.world.id,
          `map:${area.id}:samples`,
          `${publication.operationId}:${field.id}`
        ),
        area,
        source
      );
    resource.field = { ...resource.field!, id, layoutResourceId: layoutId, geographyId: layoutId };
    const ready = await publishAlias(store, resource);
    publication.resources.push(ready);
    publication.writes.push({
      scope: ready.scope,
      reference: { kind: "field", id, revision: 0 },
      data: {
        kind: "field",
        value: {
          ...field,
          id,
          areaId: area.id,
          input: true,
          state: "generated",
          resourceId: ready.id,
          footprint: resource.field!.scope.footprint,
        },
      },
    });
    capturePatches(source, area, field, id, publication);
  }
}
function capturePatches(
  source: DomainSnapshot,
  area: Area,
  field: FieldRef,
  fieldId: string,
  publication: CatalogChanges
) {
  const owners = geographyAreas(source.world, source.scope.areaId);
  for (const patch of source.fieldPatches) {
    if (patch.fieldId !== field.id || !owners.includes(patch.areaId)) continue;
    const footprint = spatial.intersection(patch.footprint, area.footprint);
    if (!footprint) continue;
    const id = semanticId(source.world.id, `map:${area.id}:patch`, patch.id);
    publication.writes.push({
      scope: { worldId: source.world.id, areaId: area.id, spaceId: patch.spaceId },
      reference: { kind: "fieldPatch", id, revision: 0 },
      data: {
        kind: "fieldPatch",
        value: {
          ...patch,
          id,
          fieldId,
          areaId: area.id,
          input: patch.input || patch.areaId !== area.id,
          mapOnly: patch.areaId === area.id ? patch.mapOnly : undefined,
          footprint,
          protected: patch.areaId === area.id && patch.protected,
        },
      },
    });
  }
}
async function publishAlias(store: FieldInputStore, resource: NumericalResource) {
  await store.create(resource);
  try {
    return await store.finish(resource.id);
  } catch (error) {
    await store.remove(resource.id);
    throw error;
  }
}
async function captureLayout(
  catalog: SpatialStore,
  store: FieldInputStore,
  source: DomainSnapshot,
  area: Area,
  original: NumericalResource,
  layouts: Map<string, string>,
  publication: CatalogChanges
) {
  const previous = layouts.get(original.field!.geographyId);
  if (previous) return previous;
  const layout = await store.describe(original.field!.layoutResourceId),
    id = semanticId(
      source.world.id,
      `map:${area.id}:layout`,
      `${publication.operationId}:${original.field!.geographyId}`
    ),
    alias = aliasResource(layout, id, area, source);
  publication.resources.push(await publishAlias(store, alias));
  const geography = await catalog.readFieldGeography(
      original.scope,
      original.field!.geographyId,
      spatial.bounds(area.footprint)
    ),
    intersect = spatial.intersectionWith(area.footprint),
    clip = (geometry: import("geojson").Geometry) => polygonGeometry(intersect(geometry));
  (publication.geography ??= []).push({
    ...geography,
    id,
    scope: alias.scope,
    ocean: geography.ocean ? clip(geography.ocean) : geography.ocean,
    lakes: geography.lakes?.flatMap((lake) => {
      const geometry = clip(lake.geometry);
      return geometry ? [{ ...lake, geometry }] : [];
    }),
    waterBodies: geography.waterBodies?.flatMap((body) => {
      const footprint = clip(body.footprint);
      return footprint
        ? [
            {
              ...body,
              footprint,
              slices: body.slices.map((slice) => ({
                ...slice,
                footprint: slice.footprint ? clip(slice.footprint) : null,
              })),
            },
          ]
        : [];
    }),
  });
  layouts.set(original.field!.geographyId, id);
  return id;
}
function aliasResource(
  original: NumericalResource,
  id: string,
  area: Area,
  source: DomainSnapshot
): NumericalResource {
  const scope = { ...original.scope, areaId: area.id };
  return {
    ...structuredClone(original),
    id,
    scope,
    state: "working",
    revision: 1,
    arrays: original.arrays.map((array) => ({
      ...array,
      source: array.source ?? { resourceId: original.id, array: array.name },
    })),
    ...(original.field
      ? {
          field: {
            ...structuredClone(original.field),
            scope: {
              ...original.field.scope,
              ...scope,
              footprint: spatial.intersection(original.field.scope.footprint, area.footprint)!,
              revision: source.world.version,
            },
          },
        }
      : {}),
  };
}
