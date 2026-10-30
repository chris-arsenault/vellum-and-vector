import {
  fieldContour,
  fieldInterpolator,
  gridPosition,
  spatial,
  canonicalGeometry,
  type DrainageReach,
} from "@atlas/domain";
import type { Geometry } from "geojson";
import { putRefinementFeature, putRefinementNetwork } from "./features";
import type { RefinementState } from "./state";

export function extractRegionalWater(state: RefinementState) {
  const g = state.surface,
    height = fieldInterpolator(g, "elevation"),
    datum = g.channels.seaLevel?.get(0) ?? 0,
    tolerance = (g.scope.resolution ?? 1000) / 4;
  g.ocean = fieldContour(
    g,
    (x, y) => datum - height({ x, y, z: 0 }),
    undefined,
    0,
    tolerance,
    state.contours
  );
  if (g.ocean) g.ocean = canonicalGeometry(state.domain.world.reference, g.ocean);
  if (g.ocean)
    putRefinementFeature(state, "ocean", "ocean", "oceans", g.ocean, {}, "Coastal water");
  const depth = fieldInterpolator(g, "waterDepth"),
    water = fieldInterpolator(g, "water", true),
    lakes = fieldContour(
      g,
      (x, y) => (water({ x, y, z: 0 }) === 2 ? depth({ x, y, z: 0 }) : 0),
      undefined,
      2,
      tolerance,
      state.contours
    );
  publishLakes(state, lakes);
  extractRivers(state);
}
function publishLakes(state: RefinementState, shape: Geometry | null) {
  const g = state.surface,
    levelAt = fieldInterpolator(g, "waterLevel", true);
  const polygons =
    shape?.type === "Polygon"
      ? [shape]
      : shape?.type === "MultiPolygon"
        ? shape.coordinates.map((coordinates) => ({ type: "Polygon" as const, coordinates }))
        : [];
  g.lakes = polygons.map((geometry, index) => {
    const p = spatial.interiorPosition(geometry),
      level = levelAt(p),
      f = putRefinementFeature(
        state,
        `lake:${index}`,
        "lake",
        "lakes",
        geometry,
        { level },
        "Regional lake"
      );
    return { id: f.id, geometry: f.geometry, level };
  });
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
