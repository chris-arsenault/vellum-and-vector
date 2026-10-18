import type { Geometry, Position as GeoPosition } from "geojson";
import GeoJSON from "ol/format/GeoJSON.js";
import type { Area, Frame, LayerStyle, Raster, World } from "./types";

export function lineage(world: World, areaId: string): Area[] {
  const result: Area[] = [];
  let area: Area | null = world.areas[areaId];
  while (area) {
    result.unshift(area);
    area = area.parentId ? world.areas[area.parentId] : null;
  }
  return result;
}

export function defaultStyles(world: World, preset = "physical"): LayerStyle[] {
  const families: Record<string, string[]> = {
    physical: ["physical", "water", "transport", "built", "custom"],
    political: ["physical", "water", "political", "built"],
    cultural: ["physical", "water", "cultural", "built"],
    magical: ["physical", "water", "magic"],
    infrastructure: ["physical", "water", "transport", "built", "custom"],
  };
  return Object.values(world.layers).map((layer) => ({
    layerId: layer.id,
    visible: families[preset].includes(layer.family),
    opacity: layer.family === "political" ? 0.4 : 0.85,
    color: layer.color,
    minScale: 0,
  }));
}

export function bounds(geometry: Geometry): number[] {
  if (geometry.type === "GeometryCollection") return mergeBounds(geometry.geometries.map(bounds));
  const points: GeoPosition[] = [];
  function walk(value: unknown) {
    const array = value as unknown[];
    if (typeof array[0] === "number") points.push(array as number[]);
    else array.forEach(walk);
  }
  walk(geometry.coordinates);
  return [
    Math.min(...points.map((p) => p[0])),
    Math.min(...points.map((p) => p[1])),
    Math.max(...points.map((p) => p[0])),
    Math.max(...points.map((p) => p[1])),
  ];
}
function mergeBounds(values: number[][]) {
  return [
    Math.min(...values.map((v) => v[0])),
    Math.min(...values.map((v) => v[1])),
    Math.max(...values.map((v) => v[2])),
    Math.max(...values.map((v) => v[3])),
  ];
}

export function rectangle(x: number, y: number, width: number, height: number): Geometry {
  return {
    type: "Polygon",
    coordinates: [
      [
        [x, y],
        [x + width, y],
        [x + width, y + height],
        [x, y + height],
        [x, y],
      ],
    ],
  };
}
export function frameAt(
  x: number,
  y: number,
  z = 0,
  rotation = 0,
  floor: string | null = null
): Frame {
  return { origin: { x, y, z }, rotation, floor, metresPerUnit: 1 };
}

export function rasterImage(raster: Raster, limits?: number[]): string {
  const canvas = document.createElement("canvas");
  canvas.width = raster.width;
  canvas.height = raster.height;
  const context = canvas.getContext("2d")!;
  const image = context.createImageData(raster.width, raster.height);
  const [min, max] = limits ?? rasterExtrema(raster.values);
  const footprint = new GeoJSON().readGeometry(raster.footprint)!;
  for (let y = 0; y < raster.height; y++)
    for (let x = 0; x < raster.width; x++) {
      const value = raster.values[y * raster.width + x];
      if (!Number.isFinite(value)) continue;
      const worldPoint = [
        raster.bounds[0] + ((raster.bounds[2] - raster.bounds[0]) * x) / (raster.width - 1),
        raster.bounds[1] + ((raster.bounds[3] - raster.bounds[1]) * y) / (raster.height - 1),
      ];
      if (!footprint.intersectsCoordinate(worldPoint)) continue;
      const color =
        raster.channel === "elevation"
          ? shadedTerrain(raster, x, y, value, min)
          : fieldColor(value, min, max);
      const index = ((raster.height - 1 - y) * raster.width + x) * 4;
      image.data.set([...color, raster.channel === "elevation" ? 255 : 165], index);
    }
  context.putImageData(image, 0, 0);
  return canvas.toDataURL();
}
function rasterExtrema(values: number[]) {
  return [
    values.reduce((a, b) => (Number.isFinite(b) ? Math.min(a, b) : a), 0),
    values.reduce((a, b) => (Number.isFinite(b) ? Math.max(a, b) : a), 1),
  ];
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
function shadedTerrain(
  raster: Raster,
  x: number,
  y: number,
  value: number,
  minimum: number
): number[] {
  const index = y * raster.width + x,
    water = raster.water?.[index] ?? (value < 0 ? 1 : 0);
  let color = water === 2 ? [73, 139, 153] : terrainColor(value, minimum);
  if (!water && value >= 0) {
    const height = (dx: number, dy: number) => {
      const ix = Math.max(0, Math.min(raster.width - 1, x + dx)),
        iy = Math.max(0, Math.min(raster.height - 1, y + dy));
      const neighbor = raster.values[iy * raster.width + ix];
      return Number.isFinite(neighbor) ? neighbor : value;
    };
    const dx = (raster.bounds[2] - raster.bounds[0]) / (raster.width - 1),
      dy = (raster.bounds[3] - raster.bounds[1]) / (raster.height - 1);
    const east = ((height(1, 0) - height(-1, 0)) / (2 * dx)) * 8;
    const north = ((height(0, 1) - height(0, -1)) / (2 * dy)) * 8;
    const light = Math.max(
      0,
      (east * 0.5 - north * 0.5 + Math.SQRT1_2) / Math.sqrt(1 + east * east + north * north)
    );
    const shade = 0.63 + light * 0.52;
    color = color.map((channel) => Math.min(255, channel * shade));
  }
  const ice = Math.min(1, (raster.ice?.[index] ?? 0) * (water ? 2 : 1.5));
  return color.map((channel, i) => channel + ([226, 237, 232][i] - channel) * ice);
}
function fieldColor(value: number, min: number, max: number): number[] {
  const t = (value - min) / Math.max(1e-9, max - min);
  return [80 + 150 * t, 115 + 50 * (1 - t), 180 - 90 * t];
}
