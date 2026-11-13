import { unwrapCoordinates, type DrainageReach } from "@atlas/domain";
import type { PhysicalField } from "../world/field";
import { riverCourseJudgments } from "../world/worldRiverCourses";
import { waterAt } from "./riverKeeping";

/** The same course judgement serves river questions and publication. */
export function markDrawnReaches(map: PhysicalField) {
  const reaches = [...map.rivers.reaches.values()].filter((reach) => !reach.dry),
    indices = new Map(reaches.map((reach, n) => [reach.id, n]));
  const records: DrainageReach[] = reaches.map((reach) => {
    const end = map.FlowTargets.get(reach.cells[reach.cells.length - 1]),
      members = end >= 0 ? [...reach.cells, end] : [...reach.cells];
    reach.drawn = !!reach.river;
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
  for (const judgement of riverCourseJudgments(records, map.scale))
    if (judgement.publish) for (const index of judgement.course) reaches[index].drawn = true;
}
