import {
  defaultTerrainCells,
  compactGeometryBounds,
  foldSamples,
  fieldChannelName,
  requireChannel,
  mapRefinementLevel,
  regionalScale,
  MapScale,
  spatial,
  type Grid,
  type World,
} from "@atlas/domain";
import { FieldInputCache, FieldWorkingSet } from "@atlas/storage-browser";
import { workspaceRasters } from "../workspaceRasters";
import { workspaceRasterGeography } from "../workspaceRasterGeography";
import { loadResourceRaster } from "../resourceRaster";
import { numericTileSampler } from "../numericTiles";
import { tileBlockWindows } from "../renderResources";
import { displayTolerance, sceneWindows } from "../sceneWindows";
import type { LoadedRaster, ResourceRaster } from "../types";
import type { HarnessWorkspace } from "./harnessWorkspace";

/** Pixels across the map at the whole-map view; the zoomed view is four times closer. */
const wholeViewPixels = 1600;

/** The map's published terrain, loaded as the renderer loads it, with its whole geography. */
export async function openTerrain(ws: HarnessWorkspace, worldId: string, areaId: string) {
  const world = await ws.catalog.readEditor(worldId),
    extent = compactGeometryBounds(world.reference, world.areas[areaId].footprint),
    rasters = await workspaceRasters(ws, worldId, areaId, extent, 0),
    // References run parent to child, inputs first: the map's own generated height is last.
    terrain = rasters.filter((raster) => raster.channel === "Elevation").at(-1);
  if (!terrain) throw new Error("This map has no published terrain.");
  if (world.reference.boundaryMode === "cylinder") {
    const [west, , east] = spatial.bounds(world.reference.domain);
    terrain.wrap = [west, east];
  }
  const geography = await workspaceRasterGeography(ws.catalog, {
    ...terrain.geography,
    windows: sceneWindows(world, extent),
    tolerance: 0,
  });
  const loaded = await loadResourceRaster(
    ws.resources,
    terrain,
    geography,
    new FieldInputCache(ws.resources, ws.working.cache)
  );
  return { world, extent, rasters, terrain, geography, ...loaded };
}
export type OpenTerrain = Awaited<ReturnType<typeof openTerrain>>;

const activeCount = (grid: Grid) => foldSamples(grid.active, (sum, value) => sum + value, 0);

/** Cells and cell size against the scale the map was meant to have. */
export function scaleReport(world: World, areaId: string, quality: string, grid: Grid) {
  const area = world.areas[areaId],
    span = Number(grid.scope.resolution),
    base = {
      profile: area.profile,
      cellsInMap: activeCount(grid),
      storedCells: grid.active.length,
      cellSpan: span,
      mapAreaKm2: MapScale.areaUnits(spatial.area(area.footprint), "m2", "km2"),
    };
  if (!area.parentId || !area.map) return base;
  const scale = MapScale.fromCells(
      compactGeometryBounds(world.reference, area.footprint),
      defaultTerrainCells
    ),
    intended = regionalScale(Math.max(1, mapRefinementLevel(world.areas, areaId)), quality, scale),
    subject = world.views.find((view) => view.id === area.regionId)?.region?.footprint,
    subjectArea = subject ? spatial.area(subject) : NaN;
  return {
    ...base,
    intendedCellSpan: intended.cellSpan,
    // Standard detail puts the default cell count in a selection; draft cells are larger.
    intendedCellsInRegion:
      (regionalScale(1, "standard", scale).cellArea * defaultTerrainCells) /
      regionalScale(1, quality, scale).cellArea,
    regionAreaKm2: MapScale.areaUnits(subjectArea, "m2", "km2"),
    cellsInRegion: subjectArea / span ** 2,
    mapCellsAtIntendedSpan: MapScale.areaUnits(base.mapAreaKm2, "km2", "m2") / intended.cellArea,
  };
}

/** Channels grouped by their first two name parts (`magic:fire`), or as plain channels. */
function channelGroups(channels: string[] = []) {
  const groups: Record<string, number> = {};
  for (const name of channels) {
    const key = name.includes(":") ? name.split(":").slice(0, 2).join(":") : "(plain)";
    groups[key] = (groups[key] ?? 0) + 1;
  }
  return groups;
}
/** Every field the map holds and the raster layers it offers, by where they come from. */
export function fieldInventory(world: World, areaId: string, rasters: ResourceRaster[]) {
  const fields = world.fields.filter((field) => field.areaId === areaId),
    layerOf = new Map(world.fields.map((field) => [field.id, field.layerId]));
  const offered: Record<string, number> = {};
  for (const raster of rasters) {
    const layer = layerOf.get(raster.id) ?? "(other map)";
    offered[layer] = (offered[layer] ?? 0) + 1;
  }
  return {
    rastersOffered: rasters.length,
    rastersByLayer: offered,
    fields: fields.map((field) => ({
      layer: field.layerId,
      input: Boolean(field.input),
      channels: field.channels?.length ?? 0,
      groups: channelGroups(field.channels ?? []),
    })),
  };
}

/** Range and invalid count of every channel of the map's own fields, over cells in the map. */
export async function channelRanges(ws: HarnessWorkspace, world: World, areaId: string) {
  const inputs = new FieldInputCache(ws.resources, ws.working.cache),
    working = new FieldWorkingSet(ws.resources, inputs.blocks, inputs),
    ranges: Record<string, { minimum: number; maximum: number; invalid: number }> = {};
  try {
    for (const field of world.fields) {
      if (field.areaId !== areaId || field.input || !field.resourceId) continue;
      const resource = await ws.resources.describe(field.resourceId),
        names = Object.keys(resource.field!.channels),
        grid = await working.load(resource.id, names, {
          id: resource.field!.geographyId,
          scope: resource.scope,
        });
      for (const name of names) ranges[`${field.layerId}/${name}`] = range(grid, name);
    }
  } finally {
    working.close();
  }
  return ranges;
}
function range(grid: Grid, name: string) {
  let minimum = Infinity,
    maximum = -Infinity,
    invalid = 0;
  const values = requireChannel(grid, fieldChannelName(name));
  for (let i = 0; i < grid.active.length; i++) {
    if (!grid.active.get(i)) continue;
    const value = values.get(i);
    if (!Number.isFinite(value)) invalid++;
    else {
      minimum = Math.min(minimum, value);
      maximum = Math.max(maximum, value);
    }
  }
  return { minimum, maximum, invalid };
}

/** Milliseconds to sample a 3x3 block of screen tiles at the map's centre, at two views. */
export async function tileTiming(ws: HarnessWorkspace, terrain: OpenTerrain) {
  const [x0, y0, x1, y1] = terrain.extent,
    span = Math.max(x1 - x0, y1 - y0),
    cellSpan = Number(terrain.raster.field.scope.resolution),
    result: Record<string, number> = {};
  for (const [view, pixels] of [
    ["whole", wholeViewPixels],
    ["zoomed", wholeViewPixels * 4],
  ] as const) {
    const resolution = span / pixels;
    result[`${view}PixelsPerCell`] = cellSpan / resolution;
    result[`${view}MsPerTile`] = await sampleBlock(ws, terrain, resolution);
  }
  return result;
}
async function sampleBlock(ws: HarnessWorkspace, terrain: OpenTerrain, resolution: number) {
  const sample = numericTileSampler(terrain.raster as LoadedRaster),
    [x0, y0, x1, y1] = terrain.extent,
    tile = resolution * 258,
    cx = (x0 + x1) / 2,
    cy = (y0 + y1) / 2;
  let total = 0;
  for (let i = -1; i <= 1; i++)
    for (let j = -1; j <= 1; j++) {
      const box = [cx + i * tile, cy + j * tile, cx + (i + 1) * tile, cy + (j + 1) * tile];
      const own = await workspaceRasterGeography(ws.catalog, {
        ...terrain.terrain.geography,
        windows: tileBlockWindows(box, resolution, terrain.terrain.wrap),
        tolerance: displayTolerance(resolution),
      });
      const started = performance.now();
      sample(box, 258, own);
      total += performance.now() - started;
    }
  return Math.round(total / 9);
}
