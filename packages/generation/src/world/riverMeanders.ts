import type { LineString } from "geojson";
import type { PhysicalField } from "./field";
import { migrateMeanders } from "./meanders";
import { hashUnit } from "./noise";
import type { RiverPaths } from "./riverPaths";
import { MapScale, spatial } from "@atlas/domain";

type Point = [number, number];

/** Channel width (m) per square root of discharge (m³/s): downstream hydraulic geometry. */
const widthPerRootDischarge = MapScale.measure(8000, -0.5);
/** Meander wavelength in channel widths, used only to decide whether bends resolve on this map. */
const wavelengthWidths = 11;
/** Shortest wavelength a map draws, as a share of its cell spacing: a drawn line zooms past its cells. */
// length-unit: count
const resolvedWavelength = 0.1;
/** Valley gradient above which a channel is confined to its line and does not meander. */
const meanderingGradient = 0.004;
/** Height above the channel (m) a flood reaches: a base and more for larger rivers. */
const floodRelief = MapScale.length(0.0000005),
  floodReliefPerLog = MapScale.length(0.00000075);
/** Finest flood-floor sample: wider channels use their bank scale up to terrain publication detail. */
const maskCell = MapScale.length(0.00000625);
/** One sparse numerical page, allocated only when the channel probes its ground. */
// length-unit: count
const maskPageWidth = 64;
/** Migration steps: the floodplain's working time. */
const floodplainSteps = 240;

export interface MeanderedReach {
  geometry: LineString;
  profiles: Record<string, number[]>;
  oxbows: Point[][];
}

/**
 * A reach on a floodplain migrates across it (`migrateMeanders`) when its bends are large
 * enough to resolve on this map and its valley is gentle enough to hold a floodplain. The
 * floor is the ground a flood reaches beside the valley line; the channel's width follows
 * its discharge. Profiles move with the course. Returns null where the reach stays on the
 * valley line.
 */
export function meanderReach(
  map: PhysicalField,
  paths: RiverPaths,
  geometry: LineString,
  profiles: Record<string, number[]>,
  start: number
): MeanderedReach | null {
  const discharge = (profiles.discharges ?? []).reduce((peak, value) => Math.max(peak, value), 0),
    width = map.scale.resolveMeasure(widthPerRootDischarge) * Math.sqrt(discharge),
    elevationAt = paths.elevationAt;
  if (!elevationAt || wavelengthWidths * width < map.scale.cells(resolvedWavelength)) return null;
  const [ox, oy] = map.mesh.origin,
    valley = geometry.coordinates.map(([x, y]) => [x - ox, y - oy] as Point);
  if (gradient(valley, profiles.bedElevations) > meanderingGradient) return null;
  const relief =
      map.scale.resolveMeasure(floodRelief) +
      map.scale.resolveMeasure(floodReliefPerLog) *
        Math.log10(1 + discharge / map.scale.volume(1.5625e-20)),
    salt = start ^ 0x6d2b;
  const { line, oxbows } = withFloodFloor(
    {
      scale: map.scale,
      valley,
      height: (x, y) => MapScale.metres(elevationAt(x, y), "native"),
      relief,
      width,
    },
    (floor) =>
      migrateMeanders({
        line: valley,
        width,
        steps: floodplainSteps,
        floor,
        draw: (k) => hashUnit(salt, k, 0),
      })
  );
  const moved: LineString = {
    type: "LineString",
    coordinates: line.map(([x, y]) => [x + ox, y + oy]),
  };
  return {
    geometry: moved,
    profiles: carryProfiles(valley, profiles, line),
    oxbows: oxbows.map((loop) => loop.map(([x, y]) => [x + ox, y + oy] as Point)),
  };
}

/**
 * Profiles move with the course: a point of the meandering course reads the valley line's
 * values at the same share of the way down. Both lines share their ends, and the values
 * keep their downstream order.
 */
function carryProfiles(valley: Point[], profiles: Record<string, number[]>, course: Point[]) {
  const along = (line: Point[]) => {
      const out = [0];
      for (let k = 1; k < line.length; k++)
        out.push(out[k - 1] + Math.hypot(line[k][0] - line[k - 1][0], line[k][1] - line[k - 1][1]));
      return out;
    },
    from = along(valley),
    to = along(course),
    total = from.at(-1)! || 1,
    length = to.at(-1)! || 1,
    carried: Record<string, number[]> = {};
  let k = 0;
  const positions = to.map((d) => {
    const target = (d / length) * total;
    while (k < from.length - 2 && from[k + 1] < target) k++;
    const span = from[k + 1] - from[k];
    return { k, t: span > 0 ? Math.min(1, Math.max(0, (target - from[k]) / span)) : 0 };
  });
  for (const [key, values] of Object.entries(profiles))
    carried[key] = positions.map(({ k: at, t }) => {
      const a = values[at] ?? values.at(-1)!,
        b = values[at + 1] ?? a;
      return a + (b - a) * t;
    });
  return carried;
}

/** Fall per metre along the valley line, from its bed profile. */
function gradient(line: Point[], beds: number[] | undefined) {
  if (!beds || beds.length < 2) return 0;
  let length = 0;
  for (let k = 1; k < line.length; k++)
    length += Math.hypot(line[k][0] - line[k - 1][0], line[k][1] - line[k - 1][1]);
  return length > 0 ? Math.abs(beds[0] - beds.at(-1)!) / length : 0;
}

/**
 * The ground a flood reaches: no higher above the valley line's nearest bed than the flood's
 * relief. One native index owns nearest-station queries for this migration only. Sparse
 * typed pages retain visited floor samples without allocating the reach's bounding rectangle.
 */
export function withFloodFloor<T>(
  input: {
    scale: MapScale;
    valley: Point[];
    height: (x: number, y: number) => number;
    relief: number;
    width: number;
  },
  work: (floor: (point: Point) => boolean) => T
): T {
  const { scale, valley, height, relief, width } = input,
    cellSpan = Math.max(scale.resolveMeasure(maskCell), Math.min(width / 4, scale.cells(1 / 64))),
    beds = Float64Array.from(valley, ([x, y]) => height(x, y));
  return spatial.withIndex(
    valley.map((coordinates) => ({ type: "Point" as const, coordinates })),
    (index) =>
      work(
        pagedFloor(cellSpan, (x, y) => {
          const nearest = index.nearest({ x, y, z: 0 });
          return nearest >= 0 && height(x, y) <= beds[nearest] + relief;
        })
      )
  );
}

function pagedFloor(cellSpan: number, reaches: (x: number, y: number) => boolean) {
  // hpc-exempt: sparse page addresses, with all per-sample state in typed arrays.
  const pages = new Map<string, Uint8Array>();
  return ([x, y]: Point) => {
    const column = Math.floor(x / cellSpan),
      row = Math.floor(y / cellSpan),
      pageX = Math.floor(column / maskPageWidth),
      pageY = Math.floor(row / maskPageWidth),
      key = `${pageX},${pageY}`;
    let page = pages.get(key);
    if (!page) pages.set(key, (page = new Uint8Array(maskPageWidth ** 2)));
    const at = (row - pageY * maskPageWidth) * maskPageWidth + column - pageX * maskPageWidth;
    if (!page[at]) page[at] = reaches((column + 0.5) * cellSpan, (row + 0.5) * cellSpan) ? 2 : 1;
    return page[at] === 2;
  };
}
