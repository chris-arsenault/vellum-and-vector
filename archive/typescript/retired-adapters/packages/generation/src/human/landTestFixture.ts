import { MapScale } from "@atlas/domain";
import { createTestField } from "../rock/groundTestFixture";
import { atlasPhysicalProfile } from "../world/atlasProfile";
import { physicalContext } from "../world/context";
import { createWorldMesh } from "../world/worldMesh";
import { closeWork, openWork, type LandWork } from "./landWork";
import { settledPass, type PassFacts } from "./passFacts";

/** Warm, watered, deep-soiled open ground with a little grass and wood on every cell. */
export function fertileLand(samples = 400) {
  const map = createTestField(createWorldMesh([0, 0, 1_000_000, 1_000_000], samples, 0));
  for (let i = 0; i < map.mesh.count; i++) {
    map.Temperature.set(i, 480);
    map.Moisture.set(i, 800);
    map.SoilDepth.set(i, map.scale.length(1.25e-7));
    map.GrassCover.set(i, 0.5);
    map.TreeCover.set(i, 0.2);
    map.Productivity.set(i, 0.5);
  }
  return map;
}
export type TestLand = ReturnType<typeof fertileLand>;
export const landContext = () =>
  physicalContext(1, 0, atlasPhysicalProfile({}, {}, MapScale.reference()));
/** A step's working state on a map, for the length of one check. */
export function withWork<T>(
  map: TestLand,
  facts: Partial<PassFacts>,
  check: (work: LandWork) => T
): T {
  const work = openWork({
    map,
    context: landContext(),
    facts: { ...settledPass(100, 1), ...facts },
  });
  try {
    return check(work);
  } finally {
    closeWork(work);
  }
}
/** Per-cell values: the listed cells hold what is given and every other cell holds nothing. */
export const at = (values: Record<number, number>) => ({
  get: (cell: number) => values[cell] ?? 0,
});
/** The cell of the map itself that lies farthest from a cell. */
export function farthestFrom(map: TestLand, cell: number) {
  let far = cell,
    most = 0;
  for (let other = 0; other < map.mesh.count; other++) {
    const apart = Math.hypot(
      map.mesh.x(other) - map.mesh.x(cell),
      map.mesh.y(other) - map.mesh.y(cell)
    );
    if (map.mesh.membership(other) === 1 && apart > most) [far, most] = [other, apart];
  }
  return far;
}
export function neighbourOf(map: TestLand, cell: number) {
  for (let edge = 0; edge < map.mesh.degree(cell); edge++)
    if (map.mesh.neighbor(cell, edge) >= 0) return map.mesh.neighbor(cell, edge);
  throw new Error("The fixture cell has a neighbour.");
}
