import {
  areaSpace,
  areaDepth,
  spatial,
  type World,
  type Bounds,
  geographyAreas,
  ownsMapGeography,
} from "@atlas/domain";
import type { BrowserWorkspace } from "@atlas/storage-browser";
import type { FieldReference, ResourceRaster } from "./types";
import { sceneWindows } from "./sceneWindows";
import { mappedPatches, patchRanges, rasterCategorySummaries } from "./workspaceRasterSummary";

async function reference(
  current: Pick<BrowserWorkspace, "catalog" | "resources">,
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
/** Raster references and their legends depend on the area's fields, patches and coverage,
 * not on the window: they are assembled once per input stamp and stored. A request only
 * attaches its windows and scale. */
export async function workspaceRasters(
  current: Pick<BrowserWorkspace, "catalog" | "resources">,
  worldId: string,
  areaId: string,
  extent: Bounds,
  tolerance: number
): Promise<ResourceRaster[]> {
  const catalog = current.catalog,
    world = await catalog.readEditor(worldId),
    family = `rasters:${areaId}`,
    stamp = catalog.productStamp(
      worldId,
      ["area", "field", "fieldPatch", "coverage"],
      geographyAreas(world, areaId)
    );
  let rasters = await catalog.readProduct<ResourceRaster[]>(worldId, family, stamp);
  if (!rasters) {
    rasters = await rasterReferences(current, world, areaId);
    await catalog.writeProduct(worldId, family, stamp, rasters);
  }
  const windows = sceneWindows(world, extent),
    geographyStamp = catalog.productStamp(
      worldId,
      ["area", "field", "fieldPatch", "coverage", "feature"],
      geographyAreas(world, areaId)
    );
  return rasters.map((raster) => ({
    ...raster,
    geography: {
      ...raster.geography,
      windows: windows.map(([x0, y0, x1, y1]): Bounds => [
        x0 - 128 * tolerance,
        y0 - 128 * tolerance,
        x1 + 128 * tolerance,
        y1 + 128 * tolerance,
      ]),
      tolerance,
      revision: geographyStamp,
    },
  }));
}
async function rasterReferences(
  current: Pick<BrowserWorkspace, "catalog" | "resources">,
  world: World,
  areaId: string
): Promise<ResourceRaster[]> {
  const worldId = world.id,
    fields = mapRasterFields(world, areaId);
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
    const data = references.get(field.id)!,
      footprint = ownsMapGeography(world, areaId)
        ? data.scope.footprint
        : spatial.intersection(data.scope.footprint, world.areas[areaId].footprint);
    if (!footprint) return [];
    const companion = (channel: string) => {
      const found = [...fields]
        .reverse()
        .find(
          (f) =>
            f.areaId === field.areaId && f.input === field.input && f.channels?.includes(channel)
        );
      return found ? references.get(found.id) : undefined;
    };
    return (field.channels ?? [])
      .filter((name) => !name.startsWith("magicApplied:") && data.units[name] !== "cell-index")
      .map((channel) => ({
        id: field.id,
        areaId: field.areaId,
        footprint,
        bounds: data.bounds,
        channel,
        field: data,
        geography: {
          scope: { worldId, spaceId: data.scope.spaceId, areaId: data.scope.areaId },
          areaId,
          geographyId: geographyIds.get(field.id)!,
          windows: [],
          tolerance: 0,
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
  // Each map shows its nearest available source per channel. Zoom never switches maps.
  const nearest = new Map<string, string>();
  for (const raster of rasters) nearest.set(raster.channel, raster.id);
  const shown = rasters.filter((raster) => nearest.get(raster.channel) === raster.id);
  await rasterCategorySummaries(current.resources, shown);
  return shown;
}

/** Field precedence shared by map drawing and exact cell inspection. */
export function mapRasterFields(world: World, areaId: string) {
  return world.fields
    .filter(
      (field) =>
        field.resourceId &&
        areaSpace(world, field.areaId) === areaSpace(world, areaId) &&
        geographyAreas(world, areaId).includes(field.areaId)
    )
    .sort(
      (a, b) =>
        areaDepth(world.areas, a.areaId) - areaDepth(world.areas, b.areaId) ||
        Number(!!b.input) - Number(!!a.input)
    );
}
