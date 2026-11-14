import { expect, it } from "vitest";
import { groundOf } from "../rock/ground";
import { createTestField } from "../rock/groundTestFixture";
import { openCut, projectGround } from "../rock/groundShares";
import { setLayer } from "../rock/rockColumn";
import { rockCatalogue as rocks } from "../rock/rockCatalogue";
import { createWorldMesh } from "../world/worldMesh";
import { cuttingResistance } from "./material";

const supplied = () => createTestField(createWorldMesh([0, 0, 1000, 1000], 16, 0));

it("a loose cap controls cutting resistance rather than its concealed strong bed", () => {
  const map = supplied();
  setLayer(map, 0, 0, rocks.granite.code, 100);
  projectGround(map, 0);
  const bare = groundOf(map).fold(0, cuttingResistance)!;
  setLayer(map, 0, 0, rocks.shale.code, 20, {}, "loose");
  projectGround(map, 0);
  const covered = groundOf(map).fold(0, cuttingResistance)!;
  setLayer(map, 0, 0, rocks.basalt.code, 100);
  expect(groundOf(map).fold(0, cuttingResistance)).toBe(covered);
  expect(covered).toBeLessThan(bare);
});

it("occupied facets answer separately before their cutting response is area weighted", () => {
  const map = supplied();
  setLayer(map, 0, 0, rocks.granite.code, 100);
  projectGround(map, 0);
  const intact = groundOf(map).fold(0, cuttingResistance)!;
  openCut(map, 0, 0.25);
  setLayer(map, 0, 0, rocks.shale.code, 10, {}, "cutLoose");
  projectGround(map, 0);
  const mixed = groundOf(map).fold(0, cuttingResistance)!;
  setLayer(map, 0, 0, rocks.shale.code, 10, {}, "loose");
  projectGround(map, 0);
  const covered = groundOf(map).fold(0, cuttingResistance)!;
  expect(mixed).toBeCloseTo(0.75 * intact + 0.25 * covered);
  expect(mixed).toBeGreaterThan(covered);
});
