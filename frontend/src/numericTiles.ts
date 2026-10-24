import {
  classInterpolator,
  fieldInterpolator,
  adaptivePointLocator,
  type AdaptivePointLocator,
  type Position,
  type GridSurface,
} from "@atlas/domain";
import DataTileSource from "ol/source/DataTile.js";
import GeoJSON from "ol/format/GeoJSON.js";
import type Projection from "ol/proj/Projection.js";
import { createXYZ } from "ol/tilegrid.js";
import type { Raster } from "./types";
import { categorical } from "./rasterTiles";
import { scaledValue } from "./rasterPresentation";
import { terrainWater } from "./terrainWater";

function terrainAt(raster: Raster, locate: AdaptivePointLocator) {
  const waterAt = terrainWater(raster, locate);
  const ice = raster.ice ? fieldInterpolator(raster.ice, "ice", false, locate) : () => 0;
  return (p: Position, height: number) => {
    const water = waterAt(p, height);
    return [height - water.level, water.kind, Math.min(1, ice(p))];
  };
}
/** Surface class for the base map; -1 where no classification exists. */
function surfaceAt(raster: Raster, channel: string, locate: AdaptivePointLocator) {
  if (!raster.surface?.channels[channel]) return () => -1;
  const read = classInterpolator(raster.surface, channel, locate);
  return (p: Position) => {
    const code = read(p);
    return Number.isFinite(code) ? code : -1;
  };
}
/** Terrain tiles: value, mask, relative height, water kind, ice, step, final and natural classes. */
export const terrainSampleBands = 8;

/** Sampling is shared with geographic reads; pixels never introduce new terrain. */
export function numericTileSampler(raster: Raster) {
  const footprint = new GeoJSON().readGeometry(raster.footprint)!;
  const locate = adaptivePointLocator();
  // Classes are reconstructed from memberships so their boundaries match region outlines.
  const valueAt = categorical(raster)
    ? classInterpolator(raster.field, raster.channel, locate)
    : fieldInterpolator(raster.field, raster.channel, false, locate);
  const active = activeSampler(raster.field, raster.channel, locate);
  const terrain = raster.channel === "elevation" ? terrainAt(raster, locate) : null;
  const surface = terrain ? surfaceAt(raster, "finalSurface", locate) : null;
  const natural = terrain ? surfaceAt(raster, "naturalSurface", locate) : null;
  const bands = terrain ? terrainSampleBands : 3;
  return (extent: number[], size: number) => {
    const values = new Float32Array(size * size * bands);
    const dx = (extent[2] - extent[0]) / size,
      dy = (extent[3] - extent[1]) / size;
    for (let row = 0; row < size; row++)
      for (let col = 0; col < size; col++) {
        const p = { x: extent[0] + (col + 0.5) * dx, y: extent[3] - (row + 0.5) * dy, z: 0 };
        if (!footprint.intersectsCoordinate([p.x, p.y]) || !active(p)) continue;
        const value = valueAt(p);
        if (!Number.isFinite(value)) continue;
        const companions = terrain
          ? [...terrain(p, value), dx, surface!(p), natural!(p)]
          : [scaledValue(value, "log")];
        if (!companions.every(Number.isFinite)) continue;
        values.set([value, 1, ...companions], (row * size + col) * bands);
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
  const tileGrid = createXYZ({ extent: projection.getExtent(), tileSize: 256 / pixelRatio });
  return new DataTileSource({
    projection,
    tileGrid,
    tileSize: 256,
    gutter: 1,
    bandCount: raster.channel === "elevation" ? terrainSampleBands + 2 : 3,
    interpolate: !categorical(raster),
    transition: 0,
    wrapX: false,
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
function activeSampler(
  grid: GridSurface,
  channel: string,
  locate: AdaptivePointLocator
): (p: Position) => boolean {
  const overlays = (grid.overlays ?? [])
    .filter((overlay) => overlay.channels.includes(channel))
    .slice()
    .reverse()
    .map(({ grid }) => ({
      footprint: new GeoJSON().readGeometry(grid.scope.footprint)!,
      at: activeSampler(grid, channel, locate),
    }));
  return (p) => {
    const overlay = overlays.find(({ footprint }) => footprint.intersectsCoordinate([p.x, p.y]));
    if (overlay) return overlay.at(p);
    if (grid.topology) return grid.active[locate(grid.topology, p.x, p.y).leaf] === 1;
    const x = Math.round(
      ((p.x - grid.bounds[0]) / (grid.bounds[2] - grid.bounds[0])) * (grid.width - 1)
    );
    const y = Math.round(
      ((p.y - grid.bounds[1]) / (grid.bounds[3] - grid.bounds[1])) * (grid.height - 1)
    );
    return grid.active[y * grid.width + x] === 1;
  };
}
