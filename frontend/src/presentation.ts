import type { Geometry, Position as GeoPosition } from "geojson";
import type { Area, Frame, LayerStyle, World } from "./types";

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
    visible: families[preset].includes(layer.family) && layer.id !== "faults",
    opacity: layer.family === "political" ? 0.4 : 0.85,
    color:
      (
        { rivers: "#397d99", lakes: "#83b6c5", roads: "#ac8553", geology: "#9b8c70" } as Record<
          string,
          string
        >
      )[layer.id] ?? layer.color,
    labels: ["settlements", "pois"].includes(layer.id),
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
