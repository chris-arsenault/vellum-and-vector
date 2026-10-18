import type { Geometry } from "geojson";
import type { Position } from "./model";
import { lineParts } from "./lineStations";
import { requireThat } from "./errors";

export function lineEndpoints(geometry: Geometry): Position[] {
  return lineParts(geometry)
    .flatMap((part) => [part[0], part.at(-1)!])
    .map((p) => ({ x: p[0], y: p[1], z: p[2] ?? 0 }));
}
export function splitDirectedLine(
  geometry: Geometry,
  anchors: Position[],
  precision: number
): Geometry[] {
  return lineParts(geometry).flatMap((coordinates) => splitPart(coordinates, anchors, precision));
}
function splitPart(coordinates: number[][], anchors: Position[], precision: number): Geometry[] {
  const points = cuts(coordinates, anchors, precision);
  const unique = points.filter((p, i) => i === 0 || p.measure - points[i - 1].measure > precision);
  const result: Geometry[] = [];
  for (let i = 1; i < unique.length; i++) {
    const a = unique[i - 1],
      b = unique[i],
      part: number[][] = [a.point];
    for (let j = a.segment + 1; j <= b.segment; j++)
      if (
        Math.hypot(part.at(-1)![0] - coordinates[j][0], part.at(-1)![1] - coordinates[j][1]) >
        precision
      )
        part.push(coordinates[j]);
    if (Math.hypot(part.at(-1)![0] - b.point[0], part.at(-1)![1] - b.point[1]) > precision)
      part.push(b.point);
    if (part.length > 1) result.push({ type: "LineString", coordinates: part });
  }
  requireThat(
    result.length > 0,
    "network_geometry",
    "A network path needs nonzero directed reaches."
  );
  return result;
}
interface Cut {
  segment: number;
  measure: number;
  point: number[];
}
function cuts(coordinates: number[][], anchors: Position[], precision: number): Cut[] {
  const points: Cut[] = [{ segment: 0, measure: 0, point: coordinates[0] }];
  let measure = 0;
  for (let segment = 0; segment < coordinates.length - 1; segment++) {
    const a = coordinates[segment],
      b = coordinates[segment + 1],
      length = Math.hypot(b[0] - a[0], b[1] - a[1]);
    if (length === 0) continue;
    for (const p of anchors) {
      const fraction = Math.max(
        0,
        Math.min(
          1,
          ((p.x - a[0]) * (b[0] - a[0]) + (p.y - a[1]) * (b[1] - a[1])) / (length * length)
        )
      );
      const point = [a[0] + fraction * (b[0] - a[0]), a[1] + fraction * (b[1] - a[1])];
      if (a.length === 3 && b.length === 3) point.push(a[2] + fraction * (b[2] - a[2]));
      if (Math.hypot(point[0] - p.x, point[1] - p.y) <= precision) {
        point[0] = p.x;
        point[1] = p.y;
        points.push({ segment, point, measure: measure + fraction * length });
      }
    }
    measure += length;
  }
  points.push({ segment: coordinates.length - 2, measure, point: coordinates.at(-1)! });
  return points.sort((a, b) => a.measure - b.measure);
}
