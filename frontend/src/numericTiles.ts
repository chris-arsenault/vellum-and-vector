import {
  classInterpolator,
  fieldInterpolator,
  fieldPosition,
  adaptivePointLocator,
  MapScale,
  type FieldChannelName,
  type AdaptivePointLocator,
  type Bounds,
  type Position,
  type GridSurface,
} from "@atlas/domain";
import DataTileSource from "ol/source/DataTile.js";
import type Projection from "ol/proj/Projection.js";
import { createXYZ } from "ol/tilegrid.js";
import type { Raster, LoadedRaster, RasterGeography as TileGeography } from "./types";
import { categorical } from "./rasterTiles";
import { scaledValue } from "./rasterPresentation";
import { tileWater } from "./terrainWater";
import { terrainDisplaySampler } from "./terrainDisplay";
import { insideAt, sampledExtent, tileCoverage, type TileInside } from "./tileCoverage";
import { polygonTileMask } from "./tileMask";

/** On an adaptive field without terrain edits, the display height is the physical height. */
function displayHeight(raster: LoadedRaster, locate: AdaptivePointLocator) {
  const field = raster.field,
    edited = (field.overlays ?? []).some((overlay) => overlay.channels.includes("Elevation"));
  return field.topology && !edited ? null : terrainDisplaySampler(field, locate);
}
/** Cells narrower than this many pixels show their stored value. */
const unresolvedPixels = 1.5;
type Reading = (p: Position) => number;
/**
 * A reading at one tile's pixel size: where a cell is narrower than a pixel and a half, the
 * smooth surface inside it is finer than the screen can show, so the pixel shows the cell's
 * stored value and no patch is built. Wider cells, and edited fields, keep the smooth reading.
 */
function pixelScaled(
  grid: GridSurface | undefined,
  channel: FieldChannelName,
  locate: AdaptivePointLocator,
  smooth: Reading
): (pixel: number) => Reading {
  const t = grid?.topology,
    values = grid?.channels[channel],
    edited = (grid?.overlays ?? []).some((overlay) => overlay.channels.includes(channel));
  if (!grid || !t || !values || edited) return () => smooth;
  return (pixel) => {
    const narrow = unresolvedPixels * pixel;
    return (p) => {
      const q = fieldPosition(grid, p),
        x = Math.max(t.bounds[0], Math.min(t.bounds[2], q.x)),
        y = Math.max(t.bounds[1], Math.min(t.bounds[3], q.y)),
        { leaf } = locate(t, x, y);
      if (leaf < 0) return smooth(p);
      const box = t.leaves.get(leaf) * 4;
      return t.boxes.get(box + 2) - t.boxes.get(box) < narrow ? values.get(leaf) : smooth(p);
    };
  };
}
/** The terrain companions of one tile, written after the value and mask bands. */
function terrainAt(raster: LoadedRaster, locate: AdaptivePointLocator) {
  const water = tileWater(raster, locate);
  const ice = pixelScaled(
    raster.ice,
    "IceThickness",
    locate,
    raster.ice ? fieldInterpolator(raster.ice, "IceThickness", false, locate) : () => 0
  );
  const finalSurface = surfaceAt(raster, "finalSurface", locate),
    naturalSurface = surfaceAt(raster, "naturalSurface", locate),
    display = displayHeight(raster, locate);
  return (extent: number[], size: number, fold: Fold, own?: TileGeography) => {
    const waterAt = water(extent, size, fold, own),
      step = (extent[2] - extent[0]) / size,
      iceAt = ice(step),
      surface = finalSurface(step),
      natural = naturalSurface(step);
    return (values: Float32Array, at: number, pixel: number, p: Position, height: number) => {
      waterAt(values, at + 2, pixel, p, height);
      values[at + 4] = Math.min(1, iceAt(p) / 1000);
      values[at + 5] = step;
      values[at + 6] = surface(p);
      values[at + 7] = natural(p);
      values[at + 8] = MapScale.metres(display ? display(p) : height, "native");
    };
  };
}
type Fold = (x: number) => number;
/** Samples east of the chart fold back into it on a cylindrical world. */
function chartFold(wrap?: number[]): Fold | undefined {
  if (!wrap) return undefined;
  const [west, east] = wrap,
    width = east - west;
  return (x) => west + ((((x - west) % width) + width) % width);
}
/** Surface class for the base map; -1 where no classification exists. */
function surfaceAt(
  raster: LoadedRaster,
  channel: FieldChannelName,
  locate: AdaptivePointLocator
): (pixel: number) => Reading {
  if (!raster.surface?.channels[channel]) return () => () => -1;
  const read = pixelScaled(
    raster.surface,
    channel,
    locate,
    classInterpolator(raster.surface, channel, locate)
  );
  return (pixel) => {
    const at = read(pixel);
    return (p) => {
      const code = at(p);
      return Number.isFinite(code) ? code : -1;
    };
  };
}
/** Terrain tiles: physical value, mask, relative height, water, ice, step, final/natural classes, display height. */
export const terrainSampleBands = 9;

/** A tile's footprint: whole, absent, or a pixel mask for a tile on the footprint's edge. */
function footprintAt(raster: LoadedRaster) {
  const coverage = tileCoverage(raster.footprint);
  return (extent: number[], size: number, fold?: Fold): boolean | Uint8Array => {
    const inside = coverage(sampledExtent(extent, raster.wrap));
    return typeof inside === "boolean"
      ? inside
      : polygonTileMask(raster.footprint, extent, size, fold);
  };
}
/**
 * Writes a pixel's value, mask and companion bands; a pixel whose bands are not all finite
 * is cleared and stays outside the drawn raster.
 */
function writePixel(
  values: Float32Array,
  at: number,
  bands: number,
  value: number,
  companions: (at: number, value: number) => void
) {
  if (!Number.isFinite(value)) return;
  values[at] = value;
  values[at + 1] = 1;
  companions(at, value);
  for (let k = at; k < at + bands; k++)
    if (!Number.isFinite(values[k])) return values.fill(0, at, at + bands);
}

/**
 * Physical bands share geographic reads; display height only generalizes contours and relief.
 * A terrain tile can carry its own sea and lake shapes, read at its scale.
 */
export function numericTileSampler(raster: LoadedRaster) {
  const footprint = footprintAt(raster),
    fold = chartFold(raster.wrap);
  const locate = adaptivePointLocator();
  // Classes are reconstructed from memberships so their boundaries match region outlines.
  const value = pixelScaled(
    raster.field,
    raster.channel,
    locate,
    categorical(raster)
      ? classInterpolator(raster.field, raster.channel, locate)
      : fieldInterpolator(raster.field, raster.channel, false, locate)
  );
  const active = activeSampler(raster.field, raster.channel, locate);
  const terrain = raster.channel === "Elevation" ? terrainAt(raster, locate) : null;
  const bands = terrain ? terrainSampleBands : 3;
  return (extent: number[], size: number, own?: TileGeography) => {
    const values = new Float32Array(size * size * bands);
    const dx = (extent[2] - extent[0]) / size,
      dy = (extent[3] - extent[1]) / size;
    const inside = footprint(extent, size, fold);
    if (inside === false) return values;
    const activeAt = active(sampledExtent(extent, raster.wrap)),
      valueAt = value(dx),
      companions = terrain ? terrain(extent, size, fold ?? Number, own) : null,
      p = { x: 0, y: 0, z: 0 };
    for (let pixel = 0; pixel < size * size; pixel++) {
      if (inside !== true && !inside[pixel]) continue;
      const col = pixel % size;
      p.x = (fold ?? Number)(extent[0] + (col + 0.5) * dx);
      p.y = extent[3] - ((pixel - col) / size + 0.5) * dy;
      if (activeAt(p))
        writePixel(values, pixel * bands, bands, valueAt(p), (at, value) => {
          if (companions) companions(values, at, pixel, p, value);
          else values[at + 2] = scaledValue(value, "log");
        });
    }
    return values;
  };
}

export function numericTileSource(
  raster: Raster,
  projection: Projection,
  load: (extent: number[], size: number, signal: AbortSignal) => Promise<Float32Array>,
  pixelRatio = globalThis.devicePixelRatio ?? 1
) {
  const extent = projection.getExtent(),
    tileSize = 256 / pixelRatio;
  const tileGrid = createXYZ({
    extent,
    tileSize,
    ...(projection.canWrapX() ? { maxResolution: (extent[2] - extent[0]) / tileSize } : {}),
  });
  return new DataTileSource({
    projection,
    tileGrid,
    tileSize: 256,
    gutter: 1,
    bandCount: raster.channel === "Elevation" ? terrainSampleBands + 2 : 3,
    interpolate: !categorical(raster),
    transition: 0,
    wrapX: projection.canWrapX(),
    loader: (z, x, y, { signal }) => {
      const box = tileGrid.getTileCoordExtent([z, x, y]);
      const resolution = (box[2] - box[0]) / 256;
      return load(
        [box[0] - resolution, box[1] - resolution, box[2] + resolution, box[3] + resolution],
        258,
        signal
      );
    },
  });
}
/** Per tile, the overlays that reach it; a covering overlay answers the whole tile. */
function activeSampler(
  grid: GridSurface,
  channel: FieldChannelName,
  locate: AdaptivePointLocator
): (extent: Bounds) => (p: Position) => boolean {
  const overlays = (grid.overlays ?? [])
    .filter((overlay) => overlay.channels.includes(channel))
    .slice()
    .reverse()
    .map(({ grid }) => ({
      footprint: tileCoverage(grid.scope.footprint),
      at: activeSampler(grid, channel, locate),
    }));
  const base = baseActive(grid, locate);
  return (extent) => {
    const reaching: { inside: TileInside; at: (p: Position) => boolean }[] = [];
    for (const overlay of overlays) {
      const inside = overlay.footprint(extent);
      if (inside === false) continue;
      reaching.push({ inside, at: overlay.at(extent) });
      if (inside === true) break;
    }
    if (!reaching.length) return base;
    if (reaching[0].inside === true) return reaching[0].at;
    return (p) => (reaching.find(({ inside }) => insideAt(inside, p))?.at ?? base)(p);
  };
}
function baseActive(grid: GridSurface, locate: AdaptivePointLocator) {
  return (position: Position) => {
    const p = fieldPosition(grid, position);
    if (grid.topology) {
      const leaf = locate(grid.topology, p.x, p.y).leaf;
      return leaf >= 0 && grid.active.get(leaf) === 1;
    }
    const x = Math.round(
      ((p.x - grid.bounds[0]) / (grid.bounds[2] - grid.bounds[0])) * (grid.width - 1)
    );
    const y = Math.round(
      ((p.y - grid.bounds[1]) / (grid.bounds[3] - grid.bounds[1])) * (grid.height - 1)
    );
    return grid.active.get(y * grid.width + x) === 1;
  };
}
