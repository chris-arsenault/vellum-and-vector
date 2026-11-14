import type { Geometry, Position as GeoPosition } from "geojson";

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
