import type { PhysicalField } from "./field";
import { physicalFieldReader } from "./continuousState";
import { spatial } from "@atlas/domain";
import type { Geometry } from "geojson";
import type { ChannelPaths, ChannelPoint } from "./riverChannelPaths";

type Station = { point: ChannelPoint; segment: number; fraction: number; elevation: number };
export interface RiverPaths extends ChannelPaths {
  elevationAt: (x: number, y: number) => number;
  water?: { ocean: Geometry | null; lakes: Map<number, Geometry> };
}
const mix = (a: ChannelPoint, b: ChannelPoint, t = 0.5): ChannelPoint => [
  a[0] + (b[0] - a[0]) * t,
  a[1] + (b[1] - a[1]) * t,
];

/** Borrow the completed channel structure; extraction cannot solve or fit paths. */
export function createRiverPaths(map: PhysicalField): RiverPaths {
  if (!map.riverPaths)
    throw new Error("Prepare river paths in channel geometry before extraction.");
  return { ...map.riverPaths, elevationAt: physicalFieldReader(map, "Elevation") };
}
function profile(
  members: number[],
  stations: Station[],
  values: Float64Array,
  scale = 1,
  offset = 0
) {
  return stations.map(
    ({ segment, fraction }) =>
      (values[members[segment]] * (1 - fraction) +
        values[members[segment + 1]] * fraction -
        offset) *
      scale
  );
}
function clipReceivingWater(
  map: PhysicalField,
  paths: RiverPaths,
  members: number[],
  stations: Station[]
) {
  const last = members.at(-1)!;
  if (map.WaterKindCodes[last] === 0) return stations;
  const wet = receivingWater(map, paths, last);
  if (!wet(...stations.at(-1)!.point)) return stations;
  for (let n = stations.length - 2; n >= 0; n--) {
    const a = stations[n],
      b = stations[n + 1];
    if (wet(...a.point)) continue;
    let low = 0,
      high = 1;
    while ((high - low) * Math.hypot(b.point[0] - a.point[0], b.point[1] - a.point[1]) > 1e-6) {
      const middle = (low + high) / 2;
      if (!wet(...mix(a.point, b.point, middle))) low = middle;
      else high = middle;
    }
    const fraction = (low + high) / 2;
    const start = a.segment === b.segment ? a.fraction : 0;
    return [
      ...stations.slice(0, n + 1),
      {
        point: mix(a.point, b.point, fraction),
        segment: b.segment,
        fraction: start + (b.fraction - start) * fraction,
        elevation: a.elevation + (b.elevation - a.elevation) * fraction,
      },
    ];
  }
  return stations;
}
function receivingWater(map: PhysicalField, paths: RiverPaths, last: number) {
  const shape =
    map.WaterKindCodes[last] === 1
      ? paths.water?.ocean
      : paths.water?.lakes.get(map.WaterBodyIds[last]);
  if (shape) {
    const covers = spatial.pointCoverage(shape);
    return (x: number, y: number) =>
      covers({ x: x + map.mesh.origin[0], y: y + map.mesh.origin[1], z: 0 });
  }
  const level = map.WaterSurfaceElevations[last];
  return (x: number, y: number) => Number.isFinite(level) && paths.elevationAt(x, y) < level;
}

/** Export a producer-owned path with dimensional profiles and the shared receiving shoreline. */
export function riverPath(map: PhysicalField, paths: RiverPaths, members: number[]) {
  let stations: Station[] = [
    {
      point: [paths.x[members[0]], paths.y[members[0]]],
      segment: 0,
      fraction: 0,
      elevation: paths.segments[members[0]][0].elevation,
    },
  ];
  for (let segment = 0; segment < members.length - 1; segment++) {
    const i = members[segment],
      j = members[segment + 1];
    if (map.FlowTargets[i] !== j || !paths.segments[i])
      throw new Error(`Missing prepared channel edge ${i} -> ${j}.`);
    stations.push(...paths.segments[i].slice(1).map((station) => ({ ...station, segment })));
  }
  stations = clipReceivingWater(map, paths, members, stations);
  return {
    geometry: {
      type: "LineString" as const,
      coordinates: stations.map(({ point: [x, y] }) => [
        x + map.mesh.origin[0],
        y + map.mesh.origin[1],
      ]),
    },
    profiles: {
      discharges: profile(members, stations, map.FlowAccumulation),
      widths: profile(members, stations, map.RiverWidth),
      depths: profile(members, stations, map.RiverDepth),
      catchmentAreas: profile(members, stations, map.CatchmentArea),
      elevations: stations.map((station) => (station.elevation - map.BaseSeaLevel) / 1024),
      bedElevations: stations.map(
        ({ point }) => (paths.elevationAt(...point) - map.BaseSeaLevel) / 1024
      ),
    },
  };
}
