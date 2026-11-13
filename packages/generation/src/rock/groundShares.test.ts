import { expect, it } from "vitest";
import { units } from "../world/math";
import { createWorldMesh } from "../world/worldMesh";
import { facetSurface, moveFacet, openCut, projectGround, resolveCut } from "./groundShares";
import { createTestField } from "./groundTestFixture";
import { rockCatalogue as rocks } from "./rockCatalogue";
import { setLayer } from "./rockColumn";

/** Four cells of one coarse cell's ground: a surface at 100 with a quarter of it cut 40 deep. */
function inherited() {
  const map = createTestField(createWorldMesh([0, 0, 1000, 1000], 16, 0));
  for (const cell of [0, 1, 2, 3]) {
    map.BedrockElevation.set(cell, units(100));
    setLayer(map, cell, 0, rocks.quartzite.code, units(200), { formedMin: 1, formedMax: 1 });
    openCut(map, cell, 0.25);
    moveFacet(map, cell, "cut", -units(40));
    projectGround(map, cell);
  }
  return map;
}
const metres = (native: number) => native / units(1);

it("keeps the uncut surface where it stood and puts the valley floor at its recorded depth", () => {
  const map = inherited(),
    uncut = metres(facetSurface(map, 0, "land")),
    floor = metres(facetSurface(map, 0, "cut"));
  expect(uncut - floor).toBeCloseTo(40, 6);
  // One of the four cells is the valley; the other three are the ground beside it.
  resolveCut(map, 0, 1);
  for (const cell of [1, 2, 3]) resolveCut(map, cell, 0);
  expect(metres(map.Elevation.get(0))).toBeCloseTo(floor, 6);
  for (const cell of [1, 2, 3]) expect(metres(map.Elevation.get(cell))).toBeCloseTo(uncut, 6);
});

it("gives a cell on the valley's edge the part of the valley that crosses it", () => {
  const map = inherited(),
    uncut = metres(facetSurface(map, 0, "land"));
  resolveCut(map, 0, 0.5);
  expect(map.GroundCutShare.get(0)).toBeCloseTo(0.5, 9);
  expect(metres(facetSurface(map, 0, "land"))).toBeCloseTo(uncut, 6);
  expect(metres(map.Elevation.get(0))).toBeCloseTo(uncut - 20, 6);
});

it("changes nothing on ground that inherited no valley", () => {
  const map = createTestField(createWorldMesh([0, 0, 1000, 1000], 16, 0));
  map.BedrockElevation.set(0, units(100));
  setLayer(map, 0, 0, rocks.quartzite.code, units(200), { formedMin: 1, formedMax: 1 });
  projectGround(map, 0);
  const before = map.Elevation.get(0);
  resolveCut(map, 0, 1);
  expect(map.Elevation.get(0)).toBe(before);
  expect(map.GroundCutShare.get(0)).toBe(0);
});
