import {
  classInterpolator,
  fieldInterpolator,
  surfaceCategories,
  type GridSurface,
  type Position,
  type SurfaceCategory,
} from "@atlas/domain";
import GeoJSON from "ol/format/GeoJSON.js";
import ImageTileSource from "ol/source/ImageTile.js";
import { createXYZ } from "ol/tilegrid.js";
import type Projection from "ol/proj/Projection.js";
import { resourceRaster, type Raster, type LoadedRaster } from "./types";
import { terrainWater } from "./terrainWater";

type ColorAt = (position: Position, dx: number, dy: number) => number[];

export function categorical(raster: Raster): boolean {
  return (
    ["category", "cell-index"].includes(raster.field.units[raster.channel]) ||
    raster.field.quantities?.[raster.channel] === "category"
  );
}

export function rasterLimits(data: Raster[]): number[] {
  const limits = [Infinity, -Infinity];
  const include = (field: GridSurface, channel: string) => {
    const values = field.channels[channel];
    for (let i = 0; values && i < values.length; i++) {
      const value = values.get(i);
      if (!field.active.get(i) || !Number.isFinite(value)) continue;
      limits[0] = Math.min(limits[0], value);
      limits[1] = Math.max(limits[1], value);
    }
    for (const overlay of field.overlays ?? [])
      if (overlay.channels.includes(channel)) include(overlay.grid, channel);
  };
  for (const raster of data) {
    if (!resourceRaster(raster)) {
      include(raster.field, raster.channel);
      continue;
    }
    const range = raster.field.channels[raster.channel]?.range;
    if (range) {
      limits[0] = Math.min(limits[0], range[0]);
      limits[1] = Math.max(limits[1], range[1]);
    }
  }
  return Number.isFinite(limits[0]) ? limits : [0, 1];
}

/** Pixels query committed geography. Tile boundaries do not bound derivative reads. */
export function tilePainter(
  raster: LoadedRaster,
  limits: number[],
  classes: SurfaceCategory[] = surfaceCategories()
): (extent: number[], size: number) => Uint8ClampedArray {
  const footprint = new GeoJSON().readGeometry(raster.footprint)!;
  const valueAt = fieldInterpolator(raster.field, raster.channel);
  const colorAt: ColorAt =
    raster.channel === "elevation"
      ? terrainPainter(raster, limits[0], valueAt, classes)
      : (p) => fieldColor(valueAt(p), limits[0], limits[1]);
  return (extent, size) => {
    const pixels = new Uint8ClampedArray(size * size * 4);
    const dx = (extent[2] - extent[0]) / size,
      dy = (extent[3] - extent[1]) / size;
    for (let row = 0; row < size; row++)
      for (let col = 0; col < size; col++) {
        const p = { x: extent[0] + (col + 0.5) * dx, y: extent[3] - (row + 0.5) * dy, z: 0 };
        if (!footprint.intersectsCoordinate([p.x, p.y])) continue;
        const color = colorAt(p, dx, dy);
        if (color.every(Number.isFinite)) pixels.set(color, (row * size + col) * 4);
      }
    return pixels;
  };
}

export function rasterTileSource(
  raster: LoadedRaster,
  limits: number[],
  projection: Projection,
  pixelRatio = globalThis.devicePixelRatio ?? 1
): ImageTileSource {
  // ImageTile supports different source and rendered tile sizes. Match screen
  // pixels without stretching one CSS-resolution texture on a high-density view.
  const tileGrid = createXYZ({ extent: projection.getExtent(), tileSize: 256 / pixelRatio });
  const paint = tilePainter(raster, limits);
  return new ImageTileSource({
    projection,
    tileGrid,
    tileSize: 256,
    gutter: 1,
    wrapX: false,
    interpolate: !categorical(raster),
    transition: 0,
    loader: (z, x, y) => {
      const extent = tileGrid.getTileCoordExtent([z, x, y]);
      const resolution = (extent[2] - extent[0]) / 256;
      const padded = [
        extent[0] - resolution,
        extent[1] - resolution,
        extent[2] + resolution,
        extent[3] + resolution,
      ];
      const canvas = document.createElement("canvas");
      canvas.width = canvas.height = 258;
      const context = canvas.getContext("2d")!;
      const image = context.createImageData(258, 258);
      image.data.set(paint(padded, 258));
      context.putImageData(image, 0, 0);
      return canvas;
    },
  });
}

const hexColor = (hex: string) => [1, 3, 5].map((at) => parseInt(hex.slice(at, at + 2), 16));
function surfacePainter(raster: LoadedRaster, classes: SurfaceCategory[]) {
  const interpolator = (channel: string) =>
    raster.surface?.channels[channel] ? classInterpolator(raster.surface, channel) : null;
  const surfaceAt = interpolator("finalSurface"),
    secondAt = interpolator("secondSurface"),
    naturalAt = interpolator("naturalSurface");
  const painted = new Map(
    classes
      .filter((c) => !c.bathymetric)
      .map((c) => [c.code, { rgb: hexColor(c.color), tint: c.tint }])
  );
  const wash = (base: number[], cls: { rgb: number[]; tint: number } | undefined) =>
    cls ? base.map((channel, i) => channel + (cls.rgb[i] - channel) * cls.tint) : base;
  return (p: Position, terrain: number[], dx = 0) => {
    const natural = naturalAt ? painted.get(Math.round(naturalAt(p))) : undefined;
    const base = natural?.rgb ?? terrain;
    // A minority class that holds a share of the cell shows as a diagonal hatch over the first.
    const hatched = secondAt && dx > 0 && Math.floor((p.x + p.y) / (3 * dx)) % 2 === 0;
    const second = hatched ? painted.get(Math.round(secondAt(p))) : undefined;
    if (second) return wash(base, second);
    return wash(base, surfaceAt ? painted.get(Math.round(surfaceAt(p))) : undefined);
  };
}
function terrainPainter(
  raster: LoadedRaster,
  minimum: number,
  height: (p: Position) => number,
  classes: SurfaceCategory[]
): ColorAt {
  const waterAt = terrainWater(raster);
  const iceAt = raster.ice ? fieldInterpolator(raster.ice, "ice") : null;
  const surfaceAt = surfacePainter(raster, classes);
  return (p, dx, dy) => {
    const value = height(p),
      { level: seaLevel, kind: water } = waterAt(p, value);
    const relative =
      water === 1 ? Math.min(-Number.EPSILON, value - seaLevel) : Math.max(0, value - seaLevel);
    let color =
      water === 2 ? [73, 139, 153] : surfaceAt(p, terrainColor(relative, minimum - seaLevel), dx);
    const ice = Math.min(1, (iceAt?.(p) ?? 0) * (water ? 2 : 1.5));
    color = color.map((channel, i) => channel + ([226, 237, 232][i] - channel) * ice);
    if (water !== 2) {
      const east = ((height({ ...p, x: p.x + dx }) - height({ ...p, x: p.x - dx })) * 4) / dx;
      const north = ((height({ ...p, y: p.y + dy }) - height({ ...p, y: p.y - dy })) * 4) / dy;
      const light = Math.max(
        0,
        (east * 0.5 - north * 0.5 + Math.SQRT1_2) / Math.sqrt(1 + east * east + north * north)
      );
      color = color.map((channel) => Math.min(255, channel * (0.63 + light * 0.52)));
    }
    return [...color, 255];
  };
}

function terrainColor(value: number, min: number): number[] {
  if (value < 0) {
    const depth = Math.sqrt(Math.min(1, value / Math.min(-1, min)));
    return [67 - depth * 44, 146 - depth * 87, 158 - depth * 66];
  }
  const stops = [
    [0, 161, 179, 126],
    [180, 140, 164, 114],
    [600, 150, 159, 114],
    [1200, 171, 158, 128],
    [2200, 193, 180, 159],
    [3200, 220, 215, 201],
    [4000, 241, 240, 231],
  ];
  let upper = 1;
  while (upper < stops.length - 1 && value > stops[upper][0]) upper++;
  const a = stops[upper - 1],
    b = stops[upper],
    t = Math.min(1, (value - a[0]) / (b[0] - a[0]));
  return [1, 2, 3].map((i) => a[i] + (b[i] - a[i]) * t);
}

function fieldColor(value: number, min: number, max: number): number[] {
  const t = (value - min) / Math.max(1e-9, max - min);
  return [80 + 150 * t, 115 + 50 * (1 - t), 180 - 90 * t, 165];
}
