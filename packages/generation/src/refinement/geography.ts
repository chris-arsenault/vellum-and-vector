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
function extractRivers(state: RefinementState) {
  const g = state.surface,
    river = g.channels.riverOrder,
    incoming = g.coverage.scratch("int32", "regional:river-incoming", g.active.length),
    reaches: DrainageReach[] = [],
    starts: number[] = [],
    ends: number[] = [];
  countIncoming(state, incoming);
  for (let i = 0; i < river.length; i++) {
    if (river.get(i) <= 0 || incoming.get(i) === 1) continue;
    const members = reachMembers(state, incoming, i);
    if (members.length < 2) continue;
    const coordinates = smoothCourse(
        members.map((cell) => {
          const p = gridPosition(g, cell);
          return [p.x, p.y, g.channels.elevation.get(cell)];
        })
      ),
      discharge = g.channels.flow.get(i),
      widths = members.map((cell) => Math.max(1, 3 * Math.sqrt(g.channels.flow.get(cell)))),
      f = putRefinementFeature(
        state,
        `river:${i}`,
        "river",
        "rivers",
        { type: "LineString", coordinates },
        {
          discharge,
          order: river.get(i),
          width: widths[0],
          widths,
          elevations: coordinates.map((p) => p[2]),
          discharges: members.map((cell) => g.channels.flow.get(cell)),
        }
      );
    putRefinementNetwork(state, f, discharge, coordinates);
    reaches.push({
      coordinates: coordinates.map(([x, y]) => [x, y]),
      discharges: members.map((cell) => g.channels.flow.get(cell)),
      catchmentAreas: members.map((cell) => g.channels.catchmentArea.get(cell)),
      waterBody: null,
      order: river.get(i),
      basin: 0,
      featureIds: [f.id],
      downstream: null,
    });
    starts.push(i);
    ends.push(members.at(-1)!);
  }
  const indices = new Map(starts.map((cell, i) => [cell, i]));
  for (const [i, reach] of reaches.entries()) reach.downstream = indices.get(ends[i]) ?? null;
  (state.domain.world.drainage ??= {})[state.input.areaId] = {
    areaId: state.input.areaId,
    spaceId: g.scope.spaceId,
    reaches,
  };
  g.coverage.release(incoming);
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
function countIncoming(state: RefinementState, incoming: import("@atlas/domain").Band) {
  const { receiver } = state.drainage!,
    river = state.surface.channels.riverOrder;
  for (let i = 0; i < river.length; i++) {
    const j = receiver.get(i);
    if (river.get(i) > 0 && j >= 0 && river.get(j) > 0) incoming.add(j, 1);
  }
}
function reachMembers(
  state: RefinementState,
  incoming: import("@atlas/domain").Band,
  start: number
) {
  const { receiver } = state.drainage!,
    river = state.surface.channels.riverOrder,
    members = [start];
  let i = start;
  while (receiver.get(i) >= 0) {
    i = receiver.get(i);
    members.push(i);
    if (river.get(i) <= 0 || incoming.get(i) !== 1) break;
  }
  return members;
}
