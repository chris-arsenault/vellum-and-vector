import type { PhysicalField } from "./field";
import { physicalSampler } from "./physicalMetric";
import { spatial } from "@atlas/domain";
import type { Geometry } from "geojson";
import { meshDeltaX, meshPointX } from "./mesh";

type Coordinate = [number, number];
type Station = { point: Coordinate; segment: number; fraction: number };
export interface RiverPaths {
  x: Float64Array;
  y: Float64Array;
  upstream: Int32Array;
  elevationAt?: (x: number, y: number) => number;
  water?: { ocean: Geometry | null; lakes: Map<number, Geometry> };
}
const mix = (a: Coordinate, b: Coordinate, t = 0.5): Coordinate => [
  a[0] + (b[0] - a[0]) * t,
  a[1] + (b[1] - a[1]) * t,
];
const position = (paths: RiverPaths, i: number): Coordinate => [paths.x[i], paths.y[i]];

/** Remove cell-scale stair steps along the main stem, sharing every confluence position. */
export function createRiverPaths(map: PhysicalField): RiverPaths {
  const paths: RiverPaths = {
    x: Float64Array.from(map.mesh.x),
    y: Float64Array.from(map.mesh.y),
    upstream: new Int32Array(map.mesh.count).fill(-1),
    elevationAt: physicalSampler(map.mesh, map.Elevation),
  };
  for (let i = 0; i < map.mesh.count; i++) {
    const target = map.FlowTargets[i];
    if (map.RiverOrders[i] <= 0 || target < 0) continue;
    const previous = paths.upstream[target];
    if (previous < 0 || map.FlowAccumulation[i] > map.FlowAccumulation[previous])
      paths.upstream[target] = i;
  }
  // Numerical de-aliasing, not geological activity or a physical meander wavelength.
  for (let pass = 0; pass < 3; pass++) relax(map, paths);
  return paths;
}
function relax(map: PhysicalField, paths: RiverPaths) {
  const x = paths.x.slice(),
    y = paths.y.slice();
  for (let i = 0; i < map.mesh.count; i++) {
    const previous = paths.upstream[i],
      next = map.FlowTargets[i];
    if (
      previous < 0 ||
      next < 0 ||
      map.RiverOrders[i] <= 0 ||
      map.WaterKindCodes[i] !== 0 ||
      bordersWater(map, i)
    )
      continue;
    const dx =
        x[i] +
        (meshDeltaX(map.mesh, x[previous] - x[i]) + meshDeltaX(map.mesh, x[next] - x[i])) / 4 -
        map.mesh.x[i],
      dy = (y[previous] + y[next] + 2 * y[i]) / 4 - map.mesh.y[i];
    // The centroid-to-edge distance is h/2. Keep the point strictly inside its cell.
    const factor = map.mesh.topology
      ? Math.min(
          1,
          (map.mesh.cellWidth[i] * 0.45) / Math.abs(dx),
          (map.mesh.cellHeight[i] * 0.45) / Math.abs(dy)
        )
      : Math.min(1, (map.mesh.spacing * 0.45) / Math.hypot(dx, dy));
    paths.x[i] = map.mesh.x[i] + dx * factor;
    paths.y[i] = map.mesh.y[i] + dy * factor;
  }
}
/** A shore cell's centre is its only point guaranteed dry in the published water geometry. */
function bordersWater(map: PhysicalField, i: number) {
  for (let edge = 0; edge < map.mesh.degree[i]; edge++) {
    const j = map.mesh.neighbors[i * map.mesh.stride + edge];
    if (j >= 0 && map.WaterKindCodes[j] !== 0) return true;
  }
  return false;
}
/**
 * The deepest neighbouring cell of the same water body, deeper than `i`. A mouth into
 * shallow water heads on toward it, so the channel enters open water rather than skimming
 * the shore where the water is only a sliver deep.
 */
function openWater(map: PhysicalField, i: number) {
  let best = -1;
  for (let edge = 0; edge < map.mesh.degree[i]; edge++) {
    const j = map.mesh.neighbors[i * map.mesh.stride + edge];
    if (
      j < 0 ||
      map.WaterKindCodes[j] !== map.WaterKindCodes[i] ||
      map.WaterBodyIds[j] !== map.WaterBodyIds[i]
    )
      continue;
    if (map.WaterDepths[j] > (best < 0 ? map.WaterDepths[i] : map.WaterDepths[best])) best = j;
  }
  return best;
}
function tangent(map: PhysicalField, paths: RiverPaths, i: number): Coordinate {
  const previous = paths.upstream[i],
    next =
      map.FlowTargets[i] < 0 && map.WaterKindCodes[i] !== 0
        ? openWater(map, i)
        : map.FlowTargets[i];
  const a = position(paths, previous < 0 ? i : previous),
    b = position(paths, next < 0 ? i : next);
  return [meshDeltaX(map.mesh, b[0] - a[0]), b[1] - a[1]];
}

/** Clip a handle to the convex union of the two adjacent triangular drainage cells. */
function corridorHandle(map: PhysicalField, i: number, j: number, a: Coordinate, d: Coordinate) {
  const dx = meshDeltaX(map.mesh, map.mesh.x[j] - map.mesh.x[i]),
    dy = map.mesh.y[j] - map.mesh.y[i],
    h = Math.hypot(dx, dy),
    ex = dx / h,
    ey = dy / h;
  const x = a[0] - (map.mesh.x[i] + dx / 2),
    y = a[1] - (map.mesh.y[i] + map.mesh.y[j]) / 2;
  const u = (x * ex + y * ey) / (1.5 * h),
    v = (-x * ey + y * ex) / ((Math.sqrt(3) * h) / 2),
    du = (d[0] * ex + d[1] * ey) / (1.5 * h),
    dv = (-d[0] * ey + d[1] * ex) / ((Math.sqrt(3) * h) / 2);
  let fraction = 1;
  for (const sx of [-1, 1])
    for (const sy of [-1, 1]) {
      const rate = sx * du + sy * dv;
      if (rate > 0) fraction = Math.min(fraction, Math.max(0, (1 - sx * u - sy * v) / rate));
    }
  return [a[0] + d[0] * fraction, a[1] + d[1] * fraction] as Coordinate;
}
function handle(map: PhysicalField, paths: RiverPaths, i: number, j: number, end: boolean) {
  const source = position(paths, i),
    target = position(paths, j),
    direction = tangent(map, paths, end ? j : i),
    chord: Coordinate = [meshDeltaX(map.mesh, target[0] - source[0]), target[1] - source[1]];
  target[0] = source[0] + chord[0];
  // A joining tributary must not turn upstream to borrow the main stem's tangent.
  const vector = direction[0] * chord[0] + direction[1] * chord[1] > 0 ? direction : chord;
  const scale = (Math.hypot(...chord) / (3 * Math.hypot(...vector))) * (end ? -1 : 1);
  return corridorHandle(map, i, j, end ? target : source, [vector[0] * scale, vector[1] * scale]);
}
function flatness(a: Coordinate, b: Coordinate, c: Coordinate, d: Coordinate) {
  const dx = d[0] - a[0],
    dy = d[1] - a[1],
    length = Math.hypot(dx, dy);
  return (
    Math.max(
      Math.abs(dx * (b[1] - a[1]) - dy * (b[0] - a[0])),
      Math.abs(dx * (c[1] - a[1]) - dy * (c[0] - a[0]))
    ) / length
  );
}
function appendCurve(
  points: Coordinate[],
  segment: number,
  tolerance: number,
  stations: Station[],
  range: [number, number] = [0, 1]
) {
  const pending = [{ points, start: range[0], end: range[1] }];
  while (pending.length) {
    const {
      points: [a, b, c, d],
      start,
      end,
    } = pending.pop()!;
    if (flatness(a, b, c, d) <= tolerance) {
      stations.push({ point: d, segment, fraction: end });
      continue;
    }
    const ab = mix(a, b),
      bc = mix(b, c),
      cd = mix(c, d),
      abc = mix(ab, bc),
      bcd = mix(bc, cd),
      center = mix(abc, bcd),
      middle = (start + end) / 2;
    pending.push({ points: [center, bcd, cd, d], start: middle, end });
    pending.push({ points: [a, ab, abc, center], start, end: middle });
  }
}
function cellHandle(map: PhysicalField, i: number, a: Coordinate, vector: Coordinate) {
  const low = [
    map.mesh.x[i] - map.mesh.cellWidth[i] / 2,
    map.mesh.y[i] - map.mesh.cellHeight[i] / 2,
  ];
  const high = [
    map.mesh.x[i] + map.mesh.cellWidth[i] / 2,
    map.mesh.y[i] + map.mesh.cellHeight[i] / 2,
  ];
  let factor = 1;
  for (let axis = 0; axis < 2; axis++) {
    if (vector[axis] > 0) factor = Math.min(factor, (high[axis] - a[axis]) / vector[axis]);
    if (vector[axis] < 0) factor = Math.min(factor, (low[axis] - a[axis]) / vector[axis]);
  }
  return [
    a[0] + vector[0] * Math.max(0, factor),
    a[1] + vector[1] * Math.max(0, factor),
  ] as Coordinate;
}
function portal(
  map: PhysicalField,
  i: number,
  j: number,
  a: Coordinate,
  b: Coordinate
): Coordinate {
  const low = [
    Math.max(map.mesh.x[i] - map.mesh.cellWidth[i] / 2, map.mesh.x[j] - map.mesh.cellWidth[j] / 2),
    Math.max(
      map.mesh.y[i] - map.mesh.cellHeight[i] / 2,
      map.mesh.y[j] - map.mesh.cellHeight[j] / 2
    ),
  ];
  const high = [
    Math.min(map.mesh.x[i] + map.mesh.cellWidth[i] / 2, map.mesh.x[j] + map.mesh.cellWidth[j] / 2),
    Math.min(
      map.mesh.y[i] + map.mesh.cellHeight[i] / 2,
      map.mesh.y[j] + map.mesh.cellHeight[j] / 2
    ),
  ];
  const axis = Math.abs(high[0] - low[0]) < Math.abs(high[1] - low[1]) ? 0 : 1;
  const fraction = (low[axis] - a[axis]) / (b[axis] - a[axis]);
  const point = mix(a, b, fraction);
  return [
    Math.max(low[0], Math.min(high[0], point[0])),
    Math.max(low[1], Math.min(high[1], point[1])),
  ];
}
function curvedHandle(
  map: PhysicalField,
  paths: RiverPaths,
  i: number,
  a: Coordinate,
  b: Coordinate,
  reverse = false
) {
  const t = tangent(map, paths, i),
    chord: Coordinate = [b[0] - a[0], b[1] - a[1]];
  const vector = t[0] * chord[0] + t[1] * chord[1] > 0 ? t : chord;
  const scale = (Math.hypot(...chord) / (3 * Math.hypot(...vector))) * (reverse ? -1 : 1);
  return cellHandle(map, i, reverse ? b : a, [vector[0] * scale, vector[1] * scale]);
}
function appendAdaptiveSegment(
  map: PhysicalField,
  paths: RiverPaths,
  i: number,
  j: number,
  segment: number,
  stations: Station[]
) {
  const a = position(paths, i),
    d = position(paths, j),
    crossing = portal(map, i, j, a, d);
  const chord: Coordinate = [d[0] - a[0], d[1] - a[1]];
  const before = Math.hypot(crossing[0] - a[0], crossing[1] - a[1]);
  const after = Math.hypot(d[0] - crossing[0], d[1] - crossing[1]);
  const fraction = before / (before + after),
    length = Math.hypot(...chord);
  const tolerance = Math.min(
    100,
    Math.min(
      map.mesh.cellWidth[i],
      map.mesh.cellHeight[i],
      map.mesh.cellWidth[j],
      map.mesh.cellHeight[j]
    ) / 64
  );
  appendCurve(
    [
      a,
      curvedHandle(map, paths, i, a, crossing),
      cellHandle(map, i, crossing, [
        (-chord[0] * before) / (3 * length),
        (-chord[1] * before) / (3 * length),
      ]),
      crossing,
    ],
    segment,
    tolerance,
    stations,
    [0, fraction]
  );
  appendCurve(
    [
      crossing,
      cellHandle(map, j, crossing, [
        (chord[0] * after) / (3 * length),
        (chord[1] * after) / (3 * length),
      ]),
      curvedHandle(map, paths, j, crossing, d, true),
      d,
    ],
    segment,
    tolerance,
    stations,
    [fraction, 1]
  );
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
/** The mouth is generation's last land cell to receiving water edge; only that segment can enter water. */
function clipReceivingWater(
  map: PhysicalField,
  paths: RiverPaths,
  members: number[],
  stations: Station[]
) {
  const receiving = members.findIndex((i) => map.WaterKindCodes[i] !== 0);
  if (!paths.elevationAt || receiving < 1) return stations;
  const wet = receivingWater(map, paths, members[receiving]),
    final = receiving - 1;
  for (let n = 0; n < stations.length - 1; n++) {
    const a = stations[n],
      b = stations[n + 1];
    if (b.segment < final || !wet(...b.point)) continue;
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
      covers({ x: meshPointX(map.mesh, x) + map.mesh.origin[0], y: y + map.mesh.origin[1], z: 0 });
  }
  const level = map.WaterSurfaceElevations[last];
  return (x: number, y: number) => Number.isFinite(level) && paths.elevationAt!(x, y) < level;
}

/** The same continuous channel and longitudinal profiles feed drawing, inspection and export. */
export function riverPath(map: PhysicalField, paths: RiverPaths, members: number[]) {
  let stations: Station[] = [{ point: position(paths, members[0]), segment: 0, fraction: 0 }];
  for (let segment = 0; segment < members.length - 1; segment++) {
    const i = members[segment],
      j = members[segment + 1];
    if (map.mesh.topology) {
      appendAdaptiveSegment(map, paths, i, j, segment, stations);
      continue;
    }
    const a = position(paths, i),
      d = position(paths, j);
    d[0] = a[0] + meshDeltaX(map.mesh, d[0] - a[0]);
    const offset = stations.at(-1)!.point[0] - a[0],
      start = stations.length;
    appendCurve(
      [a, handle(map, paths, i, j, false), handle(map, paths, i, j, true), d],
      segment,
      Math.min(100, map.mesh.spacing / 64),
      stations
    );
    for (let n = start; n < stations.length; n++) stations[n].point[0] += offset;
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
      elevations: profile(members, stations, map.DrainageElevations, 1 / 1024, map.BaseSeaLevel),
      bedElevations: paths.elevationAt
        ? stations.map(({ point }) => (paths.elevationAt!(...point) - map.BaseSeaLevel) / 1024)
        : profile(members, stations, map.Elevation, 1 / 1024, map.BaseSeaLevel),
    },
  };
}
