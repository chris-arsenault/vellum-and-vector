import { expect, it } from "vitest";
import { createTestField as createField } from "../rock/groundTestFixture";
import { createWorldMesh } from "../world/worldMesh";
import { units } from "../world/math";
import { recordCut } from "../rock/groundLedger";
import { valleyShare } from "./streams";

it("lowers a cell's mean by the valley's share and records the valley's own depth", () => {
  const map = createField(createWorldMesh([0, 0, 1_000, 1_000], 16, 0));
  map.BedrockElevation.fill(units(500));
  map.Elevation.fill(units(500));
  recordCut(map, 0, units(100), 0.1, "test");
  expect(map.Elevation.get(0) / 1024).toBeCloseTo(490, 1);
  expect(map.CumulativeFluvialErosion.get(0) / 1024).toBeCloseTo(100, 1);
});
it("gives a valley more of a coarse cell the bigger its catchment and all of a fine cell", () => {
  const widthShare = 0.05,
    catchment = 1e10;
  expect(valleyShare(widthShare, catchment, 28_000 ** 2)).toBeCloseTo(0.179, 2);
  expect(valleyShare(widthShare, catchment, 3_500 ** 2)).toBe(1);
  expect(valleyShare(widthShare, 1e13, 28_000 ** 2)).toBe(1);
});
