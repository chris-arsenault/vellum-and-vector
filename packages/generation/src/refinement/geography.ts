import {
  fieldContour,
  regularContourSupport,
  fieldInterpolator,
  gridPosition,
  spatial,
  canonicalGeometry,
  semanticId,
  resolutionCells,
  type DrainageReach,
} from "@atlas/domain";
import type { Geometry } from "geojson";
import { putRefinementFeature, putRefinementNetwork } from "./features";
import { spacing, type RefinementState } from "./state";

export function extractRegionalWater(state: RefinementState) {
  const g = state.surface,
    height = fieldInterpolator(g, "elevation"),
    marine = g.coverage.scratch("float64", "regional:marine-membership", g.active.length),
    inside = fieldInterpolator({ ...g, channels: { marine } }, "marine"),
    datum = g.channels.seaLevel?.get(0) ?? 0,
    tolerance = (g.scope.resolution ?? 1000) / 4;
  for (let i = 0; i < marine.length; i++) marine.set(i, Number(g.channels.water.get(i) === 1));
  g.ocean = fieldContour(
    g,
    (x, y) => Math.min(datum - height({ x, y, z: 0 }), (inside({ x, y, z: 0 }) - 0.1) * 1e6),
    regularContourSupport(g, (i) => marine.get(i) === 1),
    0,
    tolerance,
    state.contours
  );
  g.coverage.release(marine);
  if (g.ocean) g.ocean = canonicalGeometry(state.domain.world.reference, g.ocean);
  if (g.ocean)
    putRefinementFeature(state, "ocean", "ocean", "oceans", g.ocean, {}, "Coastal water");
  extractLakes(state);
  extractRivers(state);
}
/** Trace each physical stage against its floor, with continuous connected-basin support. */
function extractLakes(state: RefinementState) {
  const g = state.surface,
    stages = new Map<number, number[]>(),
    membership = g.coverage.scratch("float64", "regional:lake-membership", g.active.length),
    floor = fieldInterpolator(g, "elevation"),
    inside = fieldInterpolator({ ...g, channels: { membership } }, "membership");
  for (let i = 0; i < g.active.length; i++) {
    if (g.channels.water.get(i) !== 2) continue;
    const stage = g.channels.waterLevel.get(i);
    if (!stages.has(stage)) stages.set(stage, []);
    stages.get(stage)!.push(i);
  }
  g.lakes = [];
  for (const [stage, members] of stages) {
    for (const i of members) membership.set(i, 1);
    const shape = fieldContour(
      g,
      (x, y) => Math.min(stage - floor({ x, y, z: 0 }), (inside({ x, y, z: 0 }) - 0.1) * 1e6),
      lakeSupport(g.width, g.height, members),
      0,
      (g.scope.resolution ?? 1000) / 4,
      state.contours
    );
    publishLakes(state, shape, stage);
    for (const i of members) membership.set(i, 0);
  }
  g.coverage.release(membership);
}
function lakeSupport(width: number, height: number, members: number[]) {
  const cells = new Set<number>();
  for (const i of members) {
    const x = i % width,
      y = Math.floor(i / width);
    for (const dy of [-1, 0])
      for (const dx of [-1, 0])
        if (x + dx >= 0 && y + dy >= 0 && x + dx < width - 1 && y + dy < height - 1)
          cells.add((y + dy) * width + x + dx);
  }
  return [...cells].sort((a, b) => a - b);
}
function publishLakes(state: RefinementState, shape: Geometry | null, level: number) {
  const g = state.surface;
  const polygons =
    shape?.type === "Polygon"
      ? [shape]
      : shape?.type === "MultiPolygon"
        ? shape.coordinates.map((coordinates) => ({ type: "Polygon" as const, coordinates }))
        : [];
  for (const geometry of polygons) {
    const key = `lake:${g.lakes!.length}`,
      [w, s, e, n] = spatial.bounds(geometry),
      [dx, dy] = spacing(g);
    if (e - w < dx * resolutionCells || n - s < dy * resolutionCells) continue;
    putRefinementFeature(state, key, "lake", "lakes", geometry, { level }, "Regional lake");
    g.lakes!.push({
      id: semanticId(state.domain.world.id, `regional:${state.input.areaId}`, key),
      geometry: canonicalGeometry(state.domain.world.reference, geometry),
      level,
    });
  }
}
/**
 * One feature per river: from its source, a stream continues through each confluence
 * where it is the larger inflow, and ends where it joins a larger river.
 */
function extractRivers(state: RefinementState) {
  const g = state.surface,
    river = g.channels.riverOrder,
    main = mainInflows(state),
    stem = new Int32Array(g.active.length).fill(-1),
    reaches: DrainageReach[] = [],
    ends: number[] = [];
  for (let i = 0; i < river.length; i++) {
    if (river.get(i) <= 0 || main[i] >= 0) continue;
    const members = stemMembers(state, main, i);
    if (members.length < 2) continue;
    const mouth = claimStem(members, main, stem, reaches.length);
    reaches.push(publishRiver(state, `river:${i}`, members, mouth));
    ends.push(members.at(-1)!);
  }
  for (const [i, reach] of reaches.entries()) {
    const joined = stem[ends[i]];
    reach.downstream = joined >= 0 && joined !== i ? joined : null;
  }
  publishDrainage(state, reaches);
}
/** Mark the samples this river owns; returns its mouth, the last sample it owns. */
function claimStem(members: number[], main: Int32Array, stem: Int32Array, index: number) {
  for (const [k, cell] of members.entries())
    if (k === 0 || main[cell] === members[k - 1]) stem[cell] = index;
  return stem[members.at(-1)!] === index ? members.at(-1)! : members.at(-2)!;
}
function publishDrainage(state: RefinementState, reaches: DrainageReach[]) {
  const g = state.surface;
  (state.domain.world.drainage ??= {})[state.input.areaId] = {
    areaId: state.input.areaId,
    spaceId: g.scope.spaceId,
    reaches,
  };
}
function publishRiver(
  state: RefinementState,
  key: string,
  members: number[],
  mouth: number
): DrainageReach {
  const g = state.surface,
    c = g.channels,
    coordinates = smoothCourse(
      members.map((cell) => {
        const p = gridPosition(g, cell);
        return [p.x, p.y, c.elevation.get(cell)];
      })
    ),
    discharge = c.flow.get(mouth),
    discharges = members.map((cell) => c.flow.get(cell)),
    widths = discharges.map((flow) => Math.max(1, 3 * Math.sqrt(flow))),
    f = putRefinementFeature(
      state,
      key,
      "river",
      "rivers",
      { type: "LineString", coordinates },
      {
        discharge,
        order: c.riverOrder.get(mouth),
        width: widths[0],
        widths,
        elevations: coordinates.map((p) => p[2]),
        discharges,
      }
    );
  putRefinementNetwork(state, f, discharge, coordinates);
  return {
    coordinates: coordinates.map(([x, y]) => [x, y]),
    discharges,
    catchmentAreas: members.map((cell) => c.catchmentArea.get(cell)),
    waterBody: null,
    order: c.riverOrder.get(mouth),
    basin: 0,
    featureIds: [f.id],
    downstream: null,
  };
}
/** Relax interior stations while retaining the exact shared confluence endpoints. */
function smoothCourse(points: number[][]) {
  for (let pass = 0; pass < 3; pass++)
    points = points.map((p, i) =>
      i === 0 || i === points.length - 1
        ? p
        : [
            (points[i - 1][0] + p[0] * 2 + points[i + 1][0]) / 4,
            (points[i - 1][1] + p[1] * 2 + points[i + 1][1]) / 4,
            p[2],
          ]
    );
  return points;
}
/** Each river sample's largest river inflow, or -1 at a source. */
function mainInflows(state: RefinementState) {
  const { receiver } = state.drainage!,
    { riverOrder: river, flow } = state.surface.channels,
    main = new Int32Array(river.length).fill(-1);
  for (let i = 0; i < river.length; i++) {
    const j = receiver.get(i);
    if (river.get(i) <= 0 || j < 0 || river.get(j) <= 0) continue;
    if (main[j] < 0 || flow.get(i) > flow.get(main[j])) main[j] = i;
  }
  return main;
}
function stemMembers(state: RefinementState, main: Int32Array, start: number) {
  const { receiver } = state.drainage!,
    river = state.surface.channels.riverOrder,
    members = [start];
  for (let i = start, j = receiver.get(i); j >= 0; i = j, j = receiver.get(i)) {
    members.push(j);
    if (river.get(j) <= 0 || main[j] !== i) break;
  }
  return members;
}
