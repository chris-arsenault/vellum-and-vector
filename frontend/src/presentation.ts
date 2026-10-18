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
          ? terrainColor(value, min, max)
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

function terrainColor(value: number, min: number, max: number): number[] {
  if (value < 0) {
    const depth = Math.min(1, value / Math.min(-1, min));
    return [45 - depth * 20, 100 - depth * 35, 114 - depth * 33];
  }
  const t = Math.min(1, value / max);
  if (t < 0.1) return [184 + t * 110, 187 + t * 100, 139 + t * 180];
  if (t < 0.4) return [161 - t * 45, 172 - t * 55, 124 - t * 30];
  if (t < 0.75) return [155 + t * 35, 150 + t * 25, 125 + t * 30];
  return [205 + t * 35, 201 + t * 40, 186 + t * 50];
}
function fieldColor(value: number, min: number, max: number): number[] {
  const t = (value - min) / Math.max(1e-9, max - min);
  return [80 + 150 * t, 115 + 50 * (1 - t), 180 - 90 * t];
}
