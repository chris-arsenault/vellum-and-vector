import {
  gridCellBounds,
  fieldCategories,
  physicalMaterialNames,
  type GridSurface,
  type Bounds,
  type FieldChannelName,
} from "@atlas/domain";
import type { RasterPublicationInput } from "@atlas/engine";
import { terrainBands, terrainLayerId, type MapLayer, type RasterBand } from "@atlas/map";
import type { MapAssets } from "@atlas/storage-browser/maps";
import type { LoadedRaster, World } from "./types";
import { numericTileSampler, terrainSampleBands } from "./numericTiles";
import { terrainTile } from "./terrainTile";
import { categorical, rasterLimits } from "./rasterTiles";
import { categoryPalette, fieldLabel } from "./rasterPresentation";
import { shownUnit } from "./fieldNames";
import { rasterCatalog } from "./mapLayerCatalog";
import { scaledValue } from "./rasterColors";

/** Two presentation samples across a field cell retain its reconstructed surface for map viewing. */
const presentationSamplesPerCell = 2;
const tileSize = 256;
export function rasterLayerId(channel: string) {
  return channel === "Elevation" ? terrainLayerId : `raster:${channel}`;
}

/** The existing cartographic sampler runs once at publication, on the generation host. */
export async function publishMapRaster(
  assets: Pick<MapAssets, "raster">,
  world: World,
  raster: LoadedRaster,
  signal?: AbortSignal
) {
  const input = rasterPublicationInput(world, raster);
  const { source, asset } = await assets.raster(
    input,
    mapRasterRows(raster, input, signal),
    signal
  );
  const layer: MapLayer = {
    id: rasterLayerId(raster.channel),
    name: fieldLabel(world, raster.channel),
    spaceId: raster.field.scope.spaceId,
    bounds: input.grid.bounds,
    attribution: [],
    catalog: rasterCatalog(world, raster.channel),
    source: { kind: "raster", data: source },
  };
  return { layer, asset };
}
export function rasterPublicationInput(world: World, raster: LoadedRaster): RasterPublicationInput {
  const resolution = minimumSpan(raster.field, raster.channel);
  const [west, south, east, north] = raster.bounds;
  const span = resolution / presentationSamplesPerCell;
  const width = Math.ceil((east - west) / span);
  const height = Math.ceil((north - south) / span);
  // The final edge pixels may extend outside coverage; square pixels preserve map gradients.
  const bounds: Bounds = [west, north - height * span, west + width * span, north];
  const terrain = raster.channel === "Elevation";
  const ids = terrain ? terrainBands : ["value", "log-value"];
  const units = terrain
    ? [
        raster.field.units[raster.channel]!,
        "metre",
        "category",
        "ratio",
        "metre",
        "category",
        "category",
        "metre",
        "ratio",
        "ratio",
        "log-value",
      ]
    : [raster.field.units[raster.channel]!, "log-value"];
  const planes = ids.map((id, index) => {
    const channel =
      id === "surface"
        ? "finalSurface"
        : id === "natural-surface"
          ? "naturalSurface"
          : raster.channel;
    const categoricalBand = index === 0 || id.includes("surface");
    const classes = categoricalBand ? categoryPalette(world, channel) : null;
    const band: RasterBand = {
      id,
      name: rasterBandName(world, raster.channel, id, index),
      unit: units[index],
      display: shownUnit(units[index]),
      nodata: null,
      range: index === 0 ? (rasterLimits([raster]) as [number, number]) : null,
      categories: categoricalBand ? publishedCategories(world, raster, id, channel, classes) : [],
    };
    const discrete = (index === 0 && categorical(raster)) || band.unit === "category";
    return { band, resampling: discrete ? ("category" as const) : ("mean" as const) };
  });
  return { assetId: crypto.randomUUID(), grid: { width, height, bounds }, planes };
}
function publishedCategories(
  world: World,
  raster: LoadedRaster,
  id: string,
  channel: string,
  classes: ReturnType<typeof categoryPalette>
) {
  if (!classes && channel !== "PhysicalMaterial") return [];
  const grid = id.includes("surface") ? (raster.surface ?? raster.field) : raster.field;
  const present = fieldCategories(grid, channel, raster.footprint);
  if (channel === "PhysicalMaterial")
    return physicalMaterialNames.map((label, value) => ({
      value,
      label,
      color: null,
      present: present.includes(value),
      surface: null,
    }));
  return (classes ?? []).map((entry) => ({
    value: entry.code,
    label: entry.name,
    color: entry.color,
    present: present.includes(entry.code),
    surface: {
      bathymetric: entry.bathymetric,
      tint: entry.tint,
      system: entry.system ?? null,
      systemName: world.magicSystems?.find((system) => system.id === entry.system)?.name ?? null,
    },
  }));
}
const rasterBandName = (world: World, channel: string, id: string, index: number) =>
  index === 0 ? fieldLabel(world, channel) : id.replaceAll("-", " ");

function minimumSpan(grid: GridSurface, channel: FieldChannelName): number {
  let minimum = Infinity;
  if (grid.topology) {
    for (let i = 0; i < grid.active.length; i++) {
      if (!grid.active.get(i)) continue;
      const [w, s, e, n] = gridCellBounds(grid, i);
      minimum = Math.min(minimum, e - w, n - s);
    }
  } else {
    const [w, s, e, n] = grid.bounds;
    minimum = Math.min((e - w) / (grid.width - 1), (n - s) / (grid.height - 1));
  }
  for (const overlay of grid.overlays ?? [])
    if (overlay.channels.includes(channel))
      minimum = Math.min(minimum, minimumSpan(overlay.grid, channel));
  if (!Number.isFinite(minimum) || minimum <= 0)
    throw new Error("Map pixels require active samples with positive geographic extent.");
  return minimum;
}

/** One tile-height stripe is transferred at a time; the Rust writer pages completed rows. */
export async function* mapRasterRows(
  raster: LoadedRaster,
  input: RasterPublicationInput,
  signal?: AbortSignal
) {
  const {
    width,
    height,
    bounds: [west, south, east, north],
  } = input.grid;
  const dx = (east - west) / width,
    dy = (north - south) / height;
  const sample = numericTileSampler(raster);
  const terrain = raster.channel === "Elevation";
  const bands = input.planes.length + 1;
  for (let row = 0; row < height; row += tileSize) {
    signal?.throwIfAborted();
    const rows = Math.min(tileSize, height - row);
    const stripe = new Float32Array(width * rows * bands);
    for (let col = 0; col < width; col += tileSize) {
      const extent = [
        west + (col - 1) * dx,
        north - (row + tileSize + 1) * dy,
        west + (col + tileSize + 1) * dx,
        north - (row - 1) * dy,
      ];
      const samples = sample(extent, tileSize + 2);
      const values = terrain ? terrainTile(samples, tileSize + 2) : samples;
      copyTile(stripe, values, { width, rows, col, bands, terrain });
      await new Promise<void>((resolve) => setTimeout(resolve, 0));
      signal?.throwIfAborted();
    }
    yield stripe;
  }
}
function copyTile(
  stripe: Float32Array,
  values: Float32Array,
  {
    width,
    rows,
    col,
    bands,
    terrain,
  }: { width: number; rows: number; col: number; bands: number; terrain: boolean }
) {
  const sourceBands = terrain ? terrainSampleBands + 2 : 3;
  for (let y = 0; y < rows; y++)
    for (let x = 0; x < Math.min(tileSize, width - col); x++) {
      const at = ((y + 1) * (tileSize + 2) + x + 1) * sourceBands;
      const target = (y * width + col + x) * bands;
      stripe[target] = values[at];
      // Coverage is the GeoTIFF alpha band, after its data planes.
      stripe.set(values.subarray(at + 2, at + sourceBands), target + 1);
      if (terrain) stripe[target + bands - 2] = scaledValue(values[at], "log");
      stripe[target + bands - 1] = values[at + 1];
    }
}
