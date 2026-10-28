import { point, spatial, geometryParts, combineGeometry, type Band } from "@atlas/domain";
import type { Geometry } from "geojson";
import type { GenerationState } from "../process";
import type { MagicField } from "./magicState";
import { nativePosition } from "./atlasWorkspace";
import { nearestTriangle } from "./mesh";
import type { RegionMembers } from "./regionMembers";
import { workingArray, releaseWorking } from "./physicalNumerics";

export interface PlaceGeometry {
  geometry: Geometry;
  anchor: number;
  meaning: string;
}
export function bestMember(members: RegionMembers, score: (i: number) => number) {
  return members.reduce((a, b) => (score(b) > score(a) ? b : a));
}
/** Read real directed links, never the boundary of a classified polygon. */
export function linkedCourse(
  state: GenerationState,
  members: RegionMembers,
  targets: Band,
  exits = false
) {
  const work = state.physical!,
    included = workingArray(work.map, "uint8", "course:members"),
    lines: number[][][] = [];
  for (const cell of members) included.set(cell, 1);
  for (const i of members) {
    const j = targets.get(i);
    if (j < 0 || (!exits && !included.get(j))) continue;
    const a = nativePosition(work, i),
      b = nativePosition(work, j);
    lines.push([
      [a.x, a.y],
      [b.x, b.y],
    ]);
  }
  releaseWorking(work.map, included);
  return clippedLines(state, lines);
}
function clippedLines(state: GenerationState, lines: number[][][]) {
  if (!lines.length) return null;
  const shape: Geometry = { type: "MultiLineString", coordinates: lines };
  const clipped = spatial.intersection(shape, state.domain.scope.footprint);
  return lineGeometry(clipped);
}
function lineGeometry(geometry: Geometry | null) {
  return geometry ? combineGeometry(geometryParts(geometry), 1) : null;
}
export function naturalPlaceGeometry(
  state: GenerationState,
  kind: string,
  members: RegionMembers,
  extent?: Geometry
): PlaceGeometry | null {
  const work = state.physical!,
    map = work.map;
  if (kind === "gorge") {
    const path = linkedCourse(state, members, map.FlowTargets, true);
    const geometry = path && extent ? lineGeometry(spatial.intersection(path, extent)) : path;
    return geometry ? { geometry, anchor: members[0], meaning: "incised drainage course" } : null;
  }
  if (kind !== "waterfall") return null;
  const anchor = bestMember(members, (i) => {
    const target = map.FlowTargets.get(i);
    return target >= 0 ? map.Elevation.get(i) - map.Elevation.get(target) : -Infinity;
  });
  const geometry = point(nativePosition(work, anchor));
  return !extent || spatial.intersects(geometry, extent)
    ? { geometry, anchor, meaning: "channel drop" }
    : null;
}
export function magicPlaceGeometry(
  state: GenerationState,
  field: MagicField,
  ruleId: string,
  members: RegionMembers,
  extent: Geometry
): PlaceGeometry | null {
  const rule = field.definition.features.find((r) => r.id === ruleId)!;
  const map = state.physical!.map;
  const anchor = bestMember(
    members,
    (i) =>
      field.intensity.get(i) +
      (ruleId === "spring" ? map.Geothermal.get(i) + map.Moisture.get(i) : field.source.get(i))
  );
  if (rule.cartography === "course") {
    const parents = propagationParents(state, field, rule);
    const course =
      ruleId === "wake"
        ? wakeCourse(state, field, extent)
        : parents && linkedCourse(state, members, parents);
    return course
      ? { geometry: course, anchor, meaning: "retained physical propagation course" }
      : null;
  }
  if (rule.cartography !== "site") return null;
  return {
    geometry:
      sourcePoint(state, field, ruleId, members) ?? point(nativePosition(state.physical!, anchor)),
    anchor,
    meaning: ["core", "locus"].includes(ruleId)
      ? "source location"
      : "representative of classified site complex",
  };
}
function propagationParents(
  state: GenerationState,
  field: MagicField,
  rule: MagicField["definition"]["features"][number]
) {
  const participants = new Set(
    [...rule.seeds, ...(rule.retains ?? [])]
      .flat()
      .map((condition) => condition.field.replace(/^system:/, ""))
  );
  return (
    field.parents ??
    state.physical!.magic?.fields.find(
      (f) =>
        participants.has(f.definition.id) &&
        f.definition.origins.some((origin) => origin.propagation === "fracture")
    )?.parents
  );
}
function sourcePoint(
  state: GenerationState,
  field: MagicField,
  ruleId: string,
  members: RegionMembers
) {
  if (!["core", "locus"].includes(ruleId)) return null;
  const [x0, y0] = state.physical!.map.mesh.origin;
  for (const source of field.located) {
    const geometry: Geometry = { type: "Point", coordinates: [source.x + x0, source.y + y0] };
    if (
      members.includes(nearestTriangle(state.physical!.map.mesh, source.x, source.y)) &&
      spatial.intersects(state.domain.scope.footprint, geometry)
    )
      return geometry;
  }
  return null;
}
function wakeCourse(state: GenerationState, field: MagicField, extent: Geometry) {
  const paths = clippedLines(state, field.wakePaths ?? []);
  if (!paths) return null;
  const geometry = spatial.intersection(paths, extent);
  return lineGeometry(geometry);
}
