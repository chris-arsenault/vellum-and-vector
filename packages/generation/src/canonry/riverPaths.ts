import type { PhysicalField } from "./field";

type Coordinate = [number, number];
type Station = { point: Coordinate; segment: number; fraction: number };
export interface RiverPaths {
  x: Float64Array;
  y: Float64Array;
  upstream: Int32Array;
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
    if (previous < 0 || next < 0 || map.RiverOrders[i] <= 0 || map.WaterKindCodes[i] !== 0)
      continue;
    const dx = (x[previous] + x[next] + 2 * x[i]) / 4 - map.mesh.x[i],
      dy = (y[previous] + y[next] + 2 * y[i]) / 4 - map.mesh.y[i];
    // The centroid-to-edge distance is h/2. Keep the point strictly inside its cell.
    const factor = Math.min(1, (map.mesh.spacing * 0.45) / Math.hypot(dx, dy));
    paths.x[i] = map.mesh.x[i] + dx * factor;
    paths.y[i] = map.mesh.y[i] + dy * factor;
  }
}
function tangent(map: PhysicalField, paths: RiverPaths, i: number): Coordinate {
  const previous = paths.upstream[i],
    next = map.FlowTargets[i];
  const a = position(paths, previous < 0 ? i : previous),
    b = position(paths, next < 0 ? i : next);
  return [b[0] - a[0], b[1] - a[1]];
}

/** Clip a handle to the convex union of the two adjacent triangular drainage cells. */
function corridorHandle(map: PhysicalField, i: number, j: number, a: Coordinate, d: Coordinate) {
  const dx = map.mesh.x[j] - map.mesh.x[i],
    dy = map.mesh.y[j] - map.mesh.y[i],
    h = Math.hypot(dx, dy),
    ex = dx / h,
    ey = dy / h;
  const x = a[0] - (map.mesh.x[i] + map.mesh.x[j]) / 2,
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
    chord: Coordinate = [target[0] - source[0], target[1] - source[1]];
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
  stations: Station[]
) {
  const pending = [{ points, start: 0, end: 1 }];
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

/** The same continuous channel and longitudinal profiles feed drawing, inspection and export. */
export function riverPath(map: PhysicalField, paths: RiverPaths, members: number[]) {
  const stations: Station[] = [{ point: position(paths, members[0]), segment: 0, fraction: 0 }];
  for (let segment = 0; segment < members.length - 1; segment++) {
    const i = members[segment],
      j = members[segment + 1];
    appendCurve(
      [
        position(paths, i),
        handle(map, paths, i, j, false),
        handle(map, paths, i, j, true),
        position(paths, j),
      ],
      segment,
      Math.min(100, map.mesh.spacing / 64),
      stations
    );
  }
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
    },
  };
}
