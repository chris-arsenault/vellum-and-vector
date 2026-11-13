import { unwrapCoordinates, type DrainageReach } from "@atlas/domain";
import type { PhysicalField } from "../world/field";
import { riverCourseJudgments } from "../world/worldRiverCourses";
import { waterAt } from "./riverKeeping";
import { riverStorage } from "./riverStorage";
import type { Reach } from "./reaches";
import { coordinateKey } from "../world/worldSources";

/** Only explicit establishment groups previously unassigned reaches by present significance. */
function courseRecords(map: PhysicalField) {
  const reaches = [...riverStorage(map).reaches.values()].filter(
      (reach) => !reach.dry && !reach.river
    ),
    indices = new Map(reaches.map((reach, n) => [reach.id, n]));
  const records: DrainageReach[] = reaches.map((reach) => {
    const end = map.FlowTargets.get(reach.cells[reach.cells.length - 1]),
      members = end >= 0 ? [...reach.cells, end] : [...reach.cells];
    return {
      downstream: reach.downstream === null ? null : (indices.get(reach.downstream) ?? null),
      waterBody: end >= 0 && map.WaterKindCodes.get(end) !== 0 ? map.WaterBodyIds.get(end) : null,
      order: reach.order,
      basin: 0,
      featureIds: [],
      coordinates: unwrapCoordinates(
        members.map((cell) => [map.mesh.x(cell), map.mesh.y(cell)]),
        map.mesh.periodic?.width
      ) as [number, number][],
      discharges: members.map((cell) => waterAt(map, cell, "flood")),
      catchmentAreas: members.map((cell) => map.CatchmentArea.get(cell)),
    };
  });
  return { reaches, records };
}

/** Current visibility consumes established membership; it never chooses another main stem. */
export function markDrawnReaches(map: PhysicalField) {
  for (const reach of riverStorage(map).reaches.values())
    if (!reach.dry) reach.drawn = !!reach.river;
}

/** The same end-coordinate identity formerly assigned by area publication. */
function identityOf(map: PhysicalField, reach: Reach) {
  const next = map.FlowTargets.get(reach.cells[reach.cells.length - 1]),
    members = next >= 0 ? [...reach.cells, next] : reach.cells,
    line = unwrapCoordinates(
      members.map((cell) => [
        Math.round(map.mesh.x(cell) + map.mesh.origin[0]),
        Math.round(map.mesh.y(cell) + map.mesh.origin[1]),
      ]),
      map.mesh.periodic?.width
    ),
    end = line[line.length - 1],
    from = line[Math.max(0, line.length - 2)];
  return `river:${coordinateKey(end[0], end[1])}:${coordinateKey(from[0], from[1])}`;
}

/** Explicit river evolution establishes what exists before any cartographic reader runs. */
export function establishRiverIdentities(map: PhysicalField) {
  const { reaches, records } = courseRecords(map);
  for (const { course, publish } of riverCourseJudgments(records, map.scale)) {
    if (!publish) continue;
    const river = identityOf(map, reaches[course[course.length - 1]]);
    for (const index of course) {
      const reach = reaches[index];
      reach.river = river;
      reach.record ??= `river:${river}:0`;
      reach.drawn = true;
    }
  }
}
