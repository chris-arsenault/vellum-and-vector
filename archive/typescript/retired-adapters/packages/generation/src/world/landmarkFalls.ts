// The great falls: a caprock step on a river. Below the World mesh's landform rule, so it is
// latent there, but the step between two cells is a measure World can hold and a Region
// realizes as lip, plunge pool and gorge.
import { hardenRock } from "../rock/rockField";
import type { PhysicalField } from "./field";
import { round, units } from "./math";
import { nearestTriangle } from "./mesh";
import { cut, distance, shiftBedrock, type Placed } from "./landmarkGeometry";
import type { LandmarkRecord } from "./landmarkLedger";
import type { Kind } from "./landmarkKind";
import { captureInto } from "./landmarkCanyon";
import { reachAt, riverSuccessor, waterAt } from "../water/riverKeeping";

/** The river cell at the point: the greatest flow among the nearest cell and its neighbours. */
function lipCell(map: PhysicalField, placed: Placed, record?: LandmarkRecord) {
  const nearest = nearestTriangle(map.mesh, ...placed.center);
  if (nearest === undefined || nearest < 0) return -1;
  const candidates = [nearest, ...(record?.corridor ?? [])];
  for (let edge = 0; edge < map.mesh.degree(nearest); edge++) {
    const j = map.mesh.neighbor(nearest, edge);
    if (j >= 0) candidates.push(j);
  }
  const nearby = candidates.filter((i) => distance(map, i, placed.center) <= map.scale.cells(1.1));
  return nearby.reduce(
    (best, i) => (best < 0 || waterAt(map, i) > waterAt(map, best) ? i : best),
    -1
  );
}
/** An existing course owns the foot; before one exists, emplacement chooses from terrain. */
function footCell(map: PhysicalField, lip: number) {
  const course = reachAt(map, lip),
    target = course ? riverSuccessor(map, lip, course) : map.FlowTargets.get(lip);
  if (target >= 0 && map.WaterKindCodes.get(target) === 0) return target;
  if (course) return -1;
  let lowest = -1;
  for (let edge = 0; edge < map.mesh.degree(lip); edge++) {
    const j = map.mesh.neighbor(lip, edge);
    if (j >= 0 && (lowest < 0 || map.Elevation.get(j) < map.Elevation.get(lowest))) lowest = j;
  }
  return lowest;
}
/** Hold the step: cut the foot as incision, and lift the lip where base level stops the cut. */
function holdStep(map: PhysicalField, lip: number, foot: number, deficit: number, book: boolean) {
  if (lip < 0 || foot < 0 || deficit <= 0) return 0;
  const done = cut(map, foot, deficit);
  if (book) map.LandmarkMaintenance.add(foot, done);
  const remainder = round(deficit - done);
  const lifted = remainder > 0 ? shiftBedrock(map, lip, remainder) : 0;
  if (book) map.LandmarkMaintenance.add(lip, lifted);
  return Math.max(done, lifted);
}
export const falls: Kind = {
  holdsLatent: true,
  emplace(map, _p, placed, _epoch, record) {
    const lip = lipCell(map, placed, record);
    if (lip < 0) return;
    // Caprock at the lip and the cells upstream of it.
    const lipElevation = map.Elevation.get(lip);
    for (const i of [
      lip,
      ...Array.from({ length: map.mesh.degree(lip) }, (_, e) => map.mesh.neighbor(lip, e)),
    ])
      if (i >= 0 && map.Elevation.get(i) >= lipElevation) hardenRock(map, i, "quartzite");
    const foot = footCell(map, lip);
    if (foot < 0) return;
    holdStep(
      map,
      lip,
      foot,
      units(placed.parameters.drop) - (map.Elevation.get(lip) - map.Elevation.get(foot)),
      false
    );
  },
  measure(map, placed, record) {
    const lip = lipCell(map, placed, record),
      foot = lip < 0 ? -1 : footCell(map, lip);
    if (lip < 0 || foot < 0) return { drop: NaN };
    return { drop: MapScale.metres(map.Elevation.get(lip) - map.Elevation.get(foot), "native") };
  },
  maintain(map, _p, placed, shortfall, _epoch, record) {
    const lip = lipCell(map, placed, record);
    return holdStep(map, lip, lip < 0 ? -1 : footCell(map, lip), units(shortfall.drop ?? 0), true);
  },
  capture(map, placed, record) {
    const lip = lipCell(map, placed, record);
    return captureInto(map, record, {
      head: lip,
      floor: new Set([lip, ...record.corridor].filter((i) => i >= 0)),
      floorWidth: map.scale.cells(0.55),
      reach: MapScale.metres(placed.parameters.captureDistance, "km"),
      label: "falls",
    });
  },
};
import { MapScale } from "@atlas/domain";
