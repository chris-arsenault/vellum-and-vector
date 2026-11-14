import type { Geometry } from "geojson";
import type { Position } from "./model";
import { requireThat } from "./errors";
import { spatial, point } from "./spatial";

export function lineParts(geometry: Geometry): number[][][] {
  if (geometry.type === "LineString") return [geometry.coordinates];
  requireThat(
    geometry.type === "MultiLineString",
    "line_geometry",
    "This operation needs directed line geometry."
  );
  return geometry.coordinates;
}
export interface LineLocation {
  part: number;
  segment: number;
  offset: number;
  fraction: number;
  distance: number;
  point: Position;
  tangent: Position;
}
function isNearer(distance: number, z: number, p: Position, nearest: LineLocation | null): boolean {
  return (
    nearest === null ||
    distance < nearest.distance ||
    (distance === nearest.distance && Math.abs(z - p.z) < Math.abs(nearest.point.z - p.z))
  );
}
export function locateOnLine(geometry: Geometry, p: Position): LineLocation {
  let nearest: LineLocation | null = null,
    offset = 0;
  for (const [part, coordinates] of lineParts(geometry).entries()) {
    for (let segment = 0; segment < coordinates.length - 1; segment++) {
      const a = coordinates[segment],
        b = coordinates[segment + 1],
        dx = b[0] - a[0],
        dy = b[1] - a[1],
        length = Math.hypot(dx, dy);
      if (length > 0) {
        const fraction = Math.max(
          0,
          Math.min(1, ((p.x - a[0]) * dx + (p.y - a[1]) * dy) / (length * length))
        );
        const x = a[0] + fraction * dx,
          y = a[1] + fraction * dy,
          distance = Math.hypot(p.x - x, p.y - y),
          z = (a[2] ?? 0) + fraction * ((b[2] ?? 0) - (a[2] ?? 0));
        if (isNearer(distance, z, p, nearest))
          nearest = {
            part,
            segment,
            offset,
            fraction,
            distance,
            point: { x, y, z },
            tangent: { x: dx / length, y: dy / length, z: 0 },
          };
      }
      offset++;
    }
    offset++;
  }
  requireThat(nearest, "empty_line", "A directed line needs nonzero segments.");
  return nearest;
}
export function stationAt(
  geometry: Geometry,
  attributes: Record<string, unknown>,
  channel: string,
  p: Position
): number | null {
  const values = attributes[channel];
  if (!Array.isArray(values)) return null;
  const count = lineParts(geometry).reduce((sum, part) => sum + part.length, 0);
  requireThat(
    values.length === count && values.every((v) => typeof v === "number" && Number.isFinite(v)),
    "station_profile",
    `Channel ${channel} needs one finite value per line vertex.`
  );
  const location = locateOnLine(geometry, p),
    a = values[location.offset] as number,
    b = values[location.offset + 1] as number;
  return a + (b - a) * location.fraction;
}
export function crossingDirection(
  geometry: Geometry,
  footprint: Geometry,
  p: Position,
  precision: number
): string {
  const location = locateOnLine(geometry, p),
    epsilon = precision * 4;
  const before = spatial.covers(
    footprint,
    point({ ...p, x: p.x - location.tangent.x * epsilon, y: p.y - location.tangent.y * epsilon })
  );
  const after = spatial.covers(
    footprint,
    point({ ...p, x: p.x + location.tangent.x * epsilon, y: p.y + location.tangent.y * epsilon })
  );
  return before === after ? "undirected" : after ? "incoming" : "outgoing";
}
export function interpolateProfile(
  source: Geometry,
  attributes: Record<string, unknown>,
  target: Geometry,
  channel: string
): number[] | null {
  const values = lineParts(target)
    .flat()
    .map((p) => stationAt(source, attributes, channel, { x: p[0], y: p[1], z: p[2] ?? 0 }));
  return values.every((value) => value !== null) ? values : null;
}
