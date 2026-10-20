import { fieldInterpolator, type GridSurface, type Position } from "@atlas/domain";
import GeoJSON from "ol/format/GeoJSON.js";
import ImageTileSource from "ol/source/ImageTile.js";
import { createXYZ } from "ol/tilegrid.js";
import type Projection from "ol/proj/Projection.js";
import type { Raster } from "./types";
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
    field.channels[channel]?.forEach((value, i) => {
      if (!field.active[i] || !Number.isFinite(value)) return;
      limits[0] = Math.min(limits[0], value);
      limits[1] = Math.max(limits[1], value);
    });
    for (const overlay of field.overlays ?? [])
      if (overlay.channels.includes(channel)) include(overlay.grid, channel);
  };
  for (const raster of data) include(raster.field, raster.channel);
  return Number.isFinite(limits[0]) ? limits : [0, 1];
}

/** Pixels query committed geography. Tile boundaries do not bound derivative reads. */
export function tilePainter(
  raster: Raster,
  limits: number[]
): (extent: number[], size: number) => Uint8ClampedArray {
  const footprint = new GeoJSON().readGeometry(raster.footprint)!;
  const valueAt = fieldInterpolator(raster.field, raster.channel);
  const colorAt: ColorAt =
    raster.channel === "elevation"
      ? terrainPainter(raster, limits[0], valueAt)
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
  raster: Raster,
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

function terrainPainter(raster: Raster, minimum: number, height: (p: Position) => number): ColorAt {
  const waterAt = terrainWater(raster);
  const iceAt = raster.ice ? fieldInterpolator(raster.ice, "ice") : null;
  return (p, dx, dy) => {
    const value = height(p),
      { level: seaLevel, kind: water } = waterAt(p, value);
    const relative =
      water === 1 ? Math.min(-Number.EPSILON, value - seaLevel) : Math.max(0, value - seaLevel);
    let color = water === 2 ? [73, 139, 153] : terrainColor(relative, minimum - seaLevel);
    if (water !== 2) {
      const east = ((height({ ...p, x: p.x + dx }) - height({ ...p, x: p.x - dx })) * 4) / dx;
      const north = ((height({ ...p, y: p.y + dy }) - height({ ...p, y: p.y - dy })) * 4) / dy;
      const light = Math.max(
        0,
        (east * 0.5 - north * 0.5 + Math.SQRT1_2) / Math.sqrt(1 + east * east + north * north)
      );
      color = color.map((channel) => Math.min(255, channel * (0.63 + light * 0.52)));
    }
    const ice = Math.min(1, (iceAt?.(p) ?? 0) * (water ? 2 : 1.5));
    return [...color.map((channel, i) => channel + ([226, 237, 232][i] - channel) * ice), 255];
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
