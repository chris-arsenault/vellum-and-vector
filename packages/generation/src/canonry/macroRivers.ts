import type { AtlasPhysicalWorkspace } from "./atlasWorkspace";
import { createRiverPaths, type RiverPaths } from "./riverPaths";
import { addTerrainProfile, profileElevation, finishedElevation } from "./macroTerrain";
import { unitNoise } from "./noise";
import { shapeRiverDrops } from "./macroDrops";
import { correctRiverCrossings } from "./macroRiverCrossings";
import { Landform } from "./codes";
import { admitRiverPoint, composeRiverStems } from "./macroRiverStems";
import { descendingGrade } from "./macroGrades";
import type { GenerationState } from "../process";
import { membershipContour } from "./geographicContours";
import type { Geometry } from "geojson";

function riverIncoming(work: AtlasPhysicalWorkspace) {
  const map = work.map,
    incoming = new Int32Array(map.mesh.count);
  for (let i = 0; i < incoming.length; i++) {
    const j = map.FlowTargets[i];
    if (map.RiverOrders[i] > 0 && j >= 0 && map.RiverOrders[j] > 0) incoming[j]++;
  }
  return incoming;
}
export function riverReaches(work: AtlasPhysicalWorkspace) {
  const map = work.map,
    incoming = riverIncoming(work),
    result: number[][] = [];
  for (let i = 0; i < incoming.length; i++) {
    if (map.RiverOrders[i] <= 0 || incoming[i] === 1) continue;
    const members = [i];
    while (map.FlowTargets[members.at(-1)!] >= 0) {
      const j = map.FlowTargets[members.at(-1)!];
      members.push(j);
      if (map.WaterKindCodes[j] || map.RiverOrders[j] <= 0 || incoming[j] !== 1) break;
    }
    if (members.length > 1) result.push(members);
  }
  return result;
}
function lengths(work: AtlasPhysicalWorkspace, members: number[]) {
  const mesh = work.map.mesh,
    distances = [0];
  for (let n = 1; n < members.length; n++)
    distances.push(
      distances[n - 1] +
        Math.hypot(
          mesh.x[members[n]] - mesh.x[members[n - 1]],
          mesh.y[members[n]] - mesh.y[members[n - 1]]
        )
    );
  return distances;
}
function relaxedPoint(
  paths: RiverPaths,
  members: number[],
  distances: number[],
  station: number,
  radius: number
): [number, number] {
  const distance = distances[station];
  let x = 0,
    y = 0,
    total = 0;
  for (let n = 0; n < members.length; n++) {
    const relative = Math.abs(distances[n] - distance) / radius;
    if (relative >= 1) continue;
    const weight = (1 - relative ** 2) ** 2;
    x += paths.x[members[n]] * weight;
    y += paths.y[members[n]] * weight;
    total += weight;
  }
  return [x / total, y / total];
}
function segmentPosition(distances: number[], distance: number) {
  let low = 0,
    high = distances.length - 1;
  while (high - low > 1) {
    const middle = (low + high) >>> 1;
    if (distances[middle] > distance) high = middle;
    else low = middle;
  }
  return low + (distance - distances[low]) / (distances[high] - distances[low]);
}
function composedReach(
  work: AtlasPhysicalWorkspace,
  paths: RiverPaths,
  members: number[],
  seed: number
) {
  const map = work.map,
    distances = lengths(work, members),
    length = distances.at(-1)!,
    middle = members[members.length >>> 1],
    width = Math.max(...members.map((i) => map.RiverWidth[i])),
    wavelength = Math.max(width * 24, length * 0.16),
    valleyWidth =
      Math.max(width * 8, Math.min(18_000, length * 0.045)) / (1 + map.Slope[middle] * 100),
    controls = members.map((_, n) => relaxedPoint(paths, members, distances, n, wavelength * 0.45));
  controls[0] = [paths.x[members[0]], paths.y[members[0]]];
  controls[controls.length - 1] = [paths.x[members.at(-1)!], paths.y[members.at(-1)!]];
  const count = Math.max(2, Math.ceil(length / Math.max(100, wavelength / 12))),
    points: [number, number][] = [],
    positions: number[] = [];
  for (let n = 0; n <= count; n++) {
    const distance = (length * n) / count,
      position = segmentPosition(distances, distance),
      at = Math.min(members.length - 2, Math.floor(position)),
      fraction = position - at,
      a = controls[at],
      b = controls[at + 1],
      original = cubicPoint(controls, at, fraction),
      heading = Math.hypot(b[0] - a[0], b[1] - a[1]),
      broad = unitNoise(distance, seed, seed ^ 0x53fa, wavelength, 1) - 0.5,
      narrow = unitNoise(distance, seed, seed ^ 0x125d, wavelength * 0.3, 1) - 0.5,
      displacement = (broad + narrow * 0.25) * valleyWidth * Math.sin((Math.PI * n) / count) ** 2;
    const proposed: [number, number] = heading
      ? [
          original[0] - ((b[1] - a[1]) / heading) * displacement,
          original[1] + ((b[0] - a[0]) / heading) * displacement,
        ]
      : original;
    points.push(
      n === 0 || n === count ? original : admitRiverPoint(work, members[at], proposed, original)
    );
    positions.push(position);
  }
  return { points, positions, valleyWidth };
}
function cubicPoint(points: [number, number][], at: number, t: number): [number, number] {
  const a = points[Math.max(0, at - 1)],
    b = points[at],
    c = points[at + 1],
    d = points[Math.min(points.length - 1, at + 2)];
  const value = (axis: number) =>
    0.5 *
    (2 * b[axis] +
      (-a[axis] + c[axis]) * t +
      (2 * a[axis] - 5 * b[axis] + 4 * c[axis] - d[axis]) * t * t +
      (-a[axis] + 3 * b[axis] - 3 * c[axis] + d[axis]) * t * t * t);
  return [value(0), value(1)];
}
function composeJunctions(work: AtlasPhysicalWorkspace, paths: RiverPaths) {
  const map = work.map,
    incoming = riverIncoming(work),
    mesh = map.mesh;
  for (let i = 0; i < mesh.count; i++) {
    const previous = paths.upstream[i],
      next = map.FlowTargets[i];
    if (incoming[i] < 2 || previous < 0 || next < 0 || map.WaterKindCodes[i]) continue;
    const original: [number, number] = [paths.x[i], paths.y[i]],
      candidate: [number, number] = [
        (paths.x[previous] + paths.x[next] + paths.x[i] * 2) / 4,
        (paths.y[previous] + paths.y[next] + paths.y[i] * 2) / 4,
      ];
    [paths.x[i], paths.y[i]] = admitRiverPoint(work, i, candidate, original);
  }
}

export function composeRiverNetwork(state: GenerationState, seed: number) {
  const work = state.physical!, map = work.map,
    regionalHeight = finishedElevation(work),
    paths = createRiverPaths(map);
  composeRiverStems(work, paths);
  composeJunctions(work, paths);
  paths.reaches = new Map();
  const reaches = riverReaches(work), footprints = catchmentFootprints(state, reaches),
    curves = reaches.map((members) =>
      composedReach(work, paths, members, seed ^ map.DrainageBasinIds[members[0]])
    );
  correctRiverCrossings(work, reaches, curves);
  for (const [r, members] of reaches.entries()) {
    const curve = curves[r],
      drop = shapeRiverDrops(work, members, curve);
    paths.reaches.set(members[0], {
      ...curve,
      members,
      forms: curve.positions.map((position) => map.LandformCodes[members[Math.round(position)]]),
    });
    fitRiverTerrain(work, members, curve, drop, regionalHeight, footprints.get(map.DrainageBasinIds[members[0]]));
  }
  work.finishing!.rivers = paths;
  return paths;
}
function catchmentFootprints(state: GenerationState, reaches: number[][]) {
  const map = state.physical!.map, wanted = new Set(reaches.map((r) => map.DrainageBasinIds[r[0]])),
    groups = new Map<number, number[]>(), result = new Map<number, Geometry>();
  for (let i = 0; i < map.mesh.count; i++) {
    const basin = map.DrainageBasinIds[i];
    if (!wanted.has(basin)) continue;
    const cells = groups.get(basin) ?? []; cells.push(i); groups.set(basin, cells);
  }
  for (const [id, cells] of groups) {
    const shape = membershipContour(state, cells, (i) => Number(map.DrainageBasinIds[i] === id));
    if (shape) result.set(id, shape);
  }
  return result;
}
function fitRiverTerrain(
  work: AtlasPhysicalWorkspace,
  members: number[],
  curve: ReturnType<typeof composedReach>,
  drop: (position: number, ordinary: number) => number,
  regionalHeight: (x: number, y: number) => number,
  footprint: Geometry | undefined
) {
  const map = work.map,
    mesh = map.mesh,
    sample = (values: ArrayLike<number>) =>
      curve.positions.map((position) => {
        const n = Math.min(members.length - 2, Math.floor(position)),
          t = position - n;
        return values[members[n]] * (1 - t) + values[members[n + 1]] * t;
      }),
    widths = sample(map.RiverWidth),
    depths = sample(map.RiverDepth),
    inherited = sample(map.DrainageElevations).map((height, n) =>
      profileElevation(work, drop(curve.positions[n], height))
    ),
    beds = descendingGrade(
      inherited,
      widths.map((w) => Math.max(1, w)),
      inherited[0],
      inherited.at(-1)!
    );
  const points = curve.points.map(([x, y]): [number, number] => [
    x + mesh.origin[0],
    y + mesh.origin[1],
  ]);
  addTerrainProfile(work, {
    id: `valley:${members[0]}`,
    footprint: footprint ?? work.finishing?.baseSurface?.scope.footprint,
    edgeBlend: work.profile.LandformNeighborhoodRadius * 0.3,
    exclusions: {
      elevation: [
        ...(work.finishing?.ocean ? [work.finishing.ocean] : []),
        ...[...work.finishing!.lakes.values()].map((lake) => lake.footprint),
      ],
    },
    points,
    widths: widths.map((width, n) => {
      const form = map.LandformCodes[members[Math.round(curve.positions[n])]],
        cell = members[Math.round(curve.positions[n])],
        gorge = form === Landform.Gorge,
        flank = gorge ? 0.25 : Math.max(0.015, Math.min(0.08, map.Slope[cell] * 1.8)),
        point = curve.points[n],
        cut = Math.max(0, profileElevation(work, regionalHeight(point[0], point[1])) - beds[n]);
      return Math.max(width * 5, curve.valleyWidth * (gorge ? 0.3 : 1), cut / flank);
    }),
    operation: "replace",
    flat: 0.35,
    values: { elevation: beds },
  });
  addTerrainProfile(work, {
    id: `channel:${members[0]}`,
    points,
    widths: widths.map((width) => Math.max(1, width)),
    operation: "lower",
    flat: 0.25,
    values: {
      elevation: beds.map((height, n) => height - depths[n]),
      riverWidth: widths,
      riverDepth: depths,
      riverChannel: widths.map(() => 1),
      drainageElevation: beds,
      riverOrder: curve.positions.map((position) => map.RiverOrders[members[Math.round(position)]]),
      landform: curve.positions.map((position) => {
        const form = map.LandformCodes[members[Math.round(position)]];
        return form === Landform.Gorge || form === Landform.Waterfall ? form : Landform.Valley;
      }),
    },
  });
}
