import type { Geometry, Position as Coordinate } from "geojson";
import type { Position, World } from "./model";
import { spatial, type Bounds } from "./spatial";

export interface WorldReference {
  id: string;
  domain: Geometry;
  topology: string;
  boundaryMode?: "cylinder" | "ocean" | "none";
  units: string;
  axes: string;
  verticalDatum: string;
  version?: number;
  precision?: number;
}
type Reference = World["reference"];
/** The shortest continuous chart containing a canonical geographic footprint. */
export function compactGeometryBounds(reference: Reference, footprint: Geometry): Bounds {
  const bounds = spatial.bounds(footprint);
  if (reference.boundaryMode !== "cylinder") return bounds;
  const [west, , east] = spatial.bounds(reference.domain),
    width = east - west,
    intervals = parts(footprint, "polygon")
      .map((part) => spatial.bounds(part))
      .sort((a, b) => a[0] - b[0]);
  let end = intervals[0][2],
    gap = intervals[0][0] + width - intervals.at(-1)![2],
    start = intervals[0][0];
  for (const interval of intervals.slice(1)) {
    if (interval[0] - end > gap) {
      gap = interval[0] - end;
      start = interval[0];
    }
    end = Math.max(end, interval[2]);
  }
  return [start, bounds[1], start + width - Math.max(0, gap), bounds[3]];
}
export function canonicalPosition(reference: Reference, p: Position, extent?: Bounds): Position {
  if (reference.boundaryMode !== "cylinder") return p;
  const [west, , east] = extent ?? spatial.bounds(reference.domain),
    width = east - west;
  return { ...p, x: west + ((((p.x - west) % width) + width) % width) };
}

export function translateGeometry(geometry: Geometry, dx: number): Geometry {
  if (geometry.type === "GeometryCollection")
    return { ...geometry, geometries: geometry.geometries.map((g) => translateGeometry(g, dx)) };
  const move = (value: Coordinate | Coordinate[] | Coordinate[][] | Coordinate[][][]): unknown =>
    typeof value[0] === "number"
      ? [(value[0] as number) + dx, ...value.slice(1)]
      : (value as Coordinate[]).map(move);
  return { ...geometry, coordinates: move(geometry.coordinates) } as Geometry;
}

/** Copies that intersect the authoritative chart; coordinates remain continuous before clipping. */
export function chartCopies(reference: Reference, geometry: Geometry): Geometry[] {
  if (reference.boundaryMode !== "cylinder") return [geometry];
  const [west, , east] = spatial.bounds(reference.domain),
    width = east - west;
  const [low, , high] = spatial.bounds(geometry);
  const first = Math.ceil((west - high) / width),
    last = Math.floor((east - low) / width);
  return Array.from({ length: last - first + 1 }, (_, i) =>
    first + i === 0 ? geometry : translateGeometry(geometry, (first + i) * width)
  );
}

/** The simple shapes of one dimension in a clip result, so a one-piece clip stays simple. */
function parts(geometry: Geometry, dimension: "point" | "line" | "polygon"): Geometry[] {
  if (geometry.type === "GeometryCollection")
    return geometry.geometries.flatMap((g) => parts(g, dimension));
  if (!geometry.type.toLowerCase().includes(dimension)) return [];
  if (geometry.type === "MultiLineString")
    return geometry.coordinates.map((coordinates) => ({ type: "LineString", coordinates }));
  if (geometry.type === "MultiPolygon")
    return geometry.coordinates.map((coordinates) => ({ type: "Polygon", coordinates }));
  if (geometry.type === "MultiPoint")
    return geometry.coordinates.map((coordinates) => ({ type: "Point", coordinates }));
  return [geometry];
}

/** A collapsed or otherwise invalid shape cannot be clipped; its consumer reports it. */
function clippable(geometry: Geometry) {
  try {
    spatial.canonical(geometry);
    return true;
  } catch {
    return false;
  }
}
/** Split geography at the chart seam, keeping all pieces under one feature identity. */
export function canonicalGeometry(reference: Reference, geometry: Geometry): Geometry {
  if (
    reference.boundaryMode !== "cylinder" ||
    !clippable(geometry) ||
    spatial.covers(reference.domain, geometry)
  )
    return geometry;
  if (geometry.type === "Point") {
    const [x, y, z = 0] = geometry.coordinates;
    const p = canonicalPosition(reference, { x, y, z });
    return { type: "Point", coordinates: [p.x, p.y, ...geometry.coordinates.slice(2)] };
  }
  return clipGeometry(reference, geometry);
}
function clipGeometry(reference: Reference, geometry: Geometry): Geometry {
  const dimension = geometry.type.includes("Polygon")
    ? "polygon"
    : geometry.type.includes("Line")
      ? "line"
      : "point";
  const shapes = chartCopies(reference, geometry).flatMap((copy) => {
    const clipped = spatial.intersection(copy, reference.domain);
    return clipped ? parts(clipped, dimension) : [];
  });
  if (!shapes.length) return geometry;
  if (shapes.length === 1) return shapes[0];
  if (dimension === "polygon") return spatial.unionAll(shapes)!;
  if (dimension === "line")
    return {
      type: "MultiLineString",
      coordinates: shapes.flatMap((s) =>
        s.type === "LineString"
          ? [s.coordinates]
          : s.type === "MultiLineString"
            ? s.coordinates
            : []
      ),
    };
  return {
    type: "MultiPoint",
    coordinates: shapes.flatMap((s) =>
      s.type === "Point" ? [s.coordinates] : s.type === "MultiPoint" ? s.coordinates : []
    ),
  };
}

export function unwrapCoordinates(
  coordinates: Coordinate[],
  width: number | undefined
): Coordinate[] {
  if (!width || !coordinates.length) return coordinates;
  const result = [coordinates[0]];
  for (const p of coordinates.slice(1)) {
    const previous = result.at(-1)![0];
    result.push([p[0] - Math.round((p[0] - previous) / width) * width, ...p.slice(1)]);
  }
  return result;
}
