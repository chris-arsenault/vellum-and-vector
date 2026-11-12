import { MapScale, unwrapCoordinates, type Band } from "@atlas/domain";
import { nativePosition } from "../world/atlasWorkspace";
import type { PhysicalField } from "../world/field";
import { releaseWorking, workingArray } from "../world/physicalNumerics";
import { coordinateKey } from "../world/worldSources";
import { holdsOldBed } from "../water/rivers";
import { generatedFeature, putGenerated } from "../mapFeatures";
import type { GenerationState } from "../process";
import { mapScale, worldRiverLength } from "../worldSignificance";

/**
 * Old river beds. The water owner keeps, on every cell, the order of the river it carries or
 * last carried (`RiverMemory`). A bed with no river in it now is an old course: its river
 * dried, was drawn off, or turned elsewhere. The map draws those long enough to be a course
 * at its scale, the same length it asks of a river, each to the water or bed it ran into.
 */

/** Ground that carried a river and carries none now. */
const bed = holdsOldBed;

/**
 * The old courses, each as its cells from head to end, followed down the present slope. Where
 * two beds meet, the first keeps the trunk and the other ends on it. A course's last cell is
 * the river, lake, sea or bed it ran into, when it reaches one.
 */
export function dryBedCourses(map: PhysicalField): number[][] {
  const count = map.mesh.count,
    fed = workingArray(map, "uint8", "beds:fed"),
    taken = workingArray(map, "uint8", "beds:taken"),
    courses: number[][] = [];
  for (let i = 0; i < count; i++) {
    const j = map.FlowTargets.get(i);
    if (j >= 0 && bed(map, i) && bed(map, j)) fed.set(j, 1);
  }
  for (let head = 0; head < count; head++)
    if (bed(map, head) && !fed.get(head)) courses.push(courseFrom(map, head, taken));
  releaseWorking(map, fed, taken);
  return courses;
}
/** One old course from its head: down the bed until it ends or meets one already followed. */
function courseFrom(map: PhysicalField, head: number, taken: Band) {
  const course = [head];
  taken.set(head, 1);
  let j = map.FlowTargets.get(head);
  while (j >= 0 && bed(map, j) && !taken.get(j)) {
    course.push(j);
    taken.set(j, 1);
    j = map.FlowTargets.get(j);
  }
  // It is drawn onto what it ran into: a river, standing water, or the bed it joined.
  if (j >= 0) course.push(j);
  return course;
}
const lengthOf = (line: readonly [number, number][]) =>
  line.slice(1).reduce((sum, p, n) => sum + Math.hypot(p[0] - line[n][0], p[1] - line[n][1]), 0);

/** Draws the map's old beds: one record to a course, of the kind `dryBed`. */
export function publishDryBeds(state: GenerationState) {
  const work = state.physical!,
    map = work.map,
    least = mapScale(state).resolveMeasure(worldRiverLength);
  for (const course of dryBedCourses(map)) {
    const cells = course.filter((cell) => map.mesh.membership(cell) === 1);
    if (cells.length < 2) continue;
    const line = unwrapCoordinates(
      cells.map((cell) => {
        const p = nativePosition(work, cell);
        return [Math.round(p.x), Math.round(p.y)] as [number, number];
      }),
      map.mesh.periodic?.width
    ) as [number, number][];
    if (lengthOf(line) < least) continue;
    const [x, y] = line[0];
    putGenerated(
      state,
      generatedFeature(
        state,
        `dry-bed:${coordinateKey(x, y)}`,
        `Dry bed ${Math.round(MapScale.inUnits(x, "km"))} ${Math.round(MapScale.inUnits(y, "km"))}`,
        "dryBed",
        "rivers",
        { type: "LineString", coordinates: line },
        {
          order: Math.round(map.RiverMemory.get(cells[0])),
          regime: "dry",
          sourceAlgorithm: "atlas-1",
        }
      )
    );
  }
}
