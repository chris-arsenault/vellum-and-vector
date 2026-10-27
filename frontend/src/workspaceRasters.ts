import { areaSpace, isDescendant, areaDepth, type World, type Bounds } from "@atlas/domain";
import type { BrowserWorkspace } from "@atlas/storage-browser";
import type { FieldReference, ResourceRaster } from "./types";
import { sceneWindows } from "./sceneWindows";
import { mappedPatches, patchRanges, rasterCategorySummaries } from "./workspaceRasterSummary";

async function reference(
  current: BrowserWorkspace,
  world: World,
  id: string,
  fieldId: string,
  areaId: string
): Promise<FieldReference> {
  const resource = await current.resources.describe(id),
    field = resource.field!;
  const patchSnapshot = await current.catalog.readAuthoring({
    scope: {
      ...field.scope,
      areaId,
      footprint: world.areas[areaId].footprint,
      revision: world.version,
    },
    objects: [],
    channels: [{ fieldId, names: Object.keys(field.channels) }],
    spatialLayers: [],
    parentHistory: [],
    dependencies: false,
  });
  const units: FieldReference["units"] = {},
    quantities: FieldReference["quantities"] = {};
  for (const [name, key] of Object.entries(field.channels)) {
    const array = resource.arrays.find((a) => a.name === key)!;
    units[name] = array.unit;
    quantities[name] = array.quantity as FieldReference["quantities"][string];
  }
  const result: FieldReference = {
    resourceId: id,
    scope: field.scope,
    bounds: resource.bounds,
    units,
    quantities,
    channels: structuredClone(field.summaries ?? {}),
    patches: mappedPatches(world, areaId, fieldId, patchSnapshot.fieldPatches).map((p) => ({
      resourceId: p.resourceId,
      channels: p.channels,
      mapOnly: p.mapOnly ?? false,
    })),
  };
  await patchRanges(current.resources, result);
  return result;
}
export async function workspaceRasters(
  current: BrowserWorkspace,
  worldId: string,
  areaId: string,
  extent: Bounds,
  tolerance: number
): Promise<ResourceRaster[]> {
  const world = await current.catalog.readEditor(worldId),
    windows = sceneWindows(world, extent);
  const fields = world.fields
    .filter(
      (field) =>
        field.resourceId &&
        areaSpace(world, field.areaId) === areaSpace(world, areaId) &&
        isDescendant(world.areas, areaId, field.areaId)
    )
    .sort((a, b) => areaDepth(world.areas, a.areaId) - areaDepth(world.areas, b.areaId));
  const references = new Map<string, FieldReference>();
  for (const field of fields)
    references.set(field.id, await reference(current, world, field.resourceId!, field.id, areaId));
  const geographyIds = new Map<string, string>();
  for (const field of fields)
    geographyIds.set(
      field.id,
      (await current.resources.describe(field.resourceId!)).field!.geographyId
    );
  const rasters: ResourceRaster[] = fields.flatMap((field) => {
    const data = references.get(field.id)!;
    const companion = (channel: string) => {
      const found = fields.find((f) => f.areaId === field.areaId && f.channels?.includes(channel));
      return found ? references.get(found.id) : undefined;
    };
    return (field.channels ?? [])
      .filter((name) => !name.startsWith("magicApplied:") && data.units[name] !== "cell-index")
      .map((channel) => ({
        id: field.id,
        areaId: field.areaId,
        footprint: data.scope.footprint,
        bounds: data.bounds,
        channel,
        field: data,
        geography: {
          scope: { worldId, spaceId: data.scope.spaceId, areaId: data.scope.areaId },
          areaId,
          geographyId: geographyIds.get(field.id)!,
          windows: windows.map(([x0, y0, x1, y1]): Bounds => [
            x0 - 128 * tolerance,
            y0 - 128 * tolerance,
            x1 + 128 * tolerance,
            y1 + 128 * tolerance,
          ]),
          tolerance,
          revision: world.version,
        },
        ...(channel === "elevation"
          ? {
              water: companion("water"),
              ice: companion("ice"),
              surface: companion("finalSurface"),
            }
          : {}),
      }));
  });
  await rasterCategorySummaries(current.resources, rasters);
  return rasters;
}
