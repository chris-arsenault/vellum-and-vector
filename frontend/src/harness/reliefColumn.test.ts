import { expect, it } from "vitest";
import { observeRemapPackage } from "../../../packages/generation/src/rock/rockColumn";
import { watchRockColumns } from "./reliefColumn";

it("groups remap packages by column and original contact count, including packages without folds", () => {
  const finish = watchRockColumns();
  observeRemapPackage("land", 12, 8);
  observeRemapPackage("land", 12, 8);
  observeRemapPackage("land", 6, 6);
  observeRemapPackage("loose", 6, 4);
  observeRemapPackage("cut", 0, 0);
  const report = finish(null);
  expect(report.remapPackages).toEqual({
    land: { 12: { count: 2, folds: 8 }, 6: { count: 1, folds: 0 } },
    cut: { 0: { count: 1, folds: 0 } },
    loose: { 6: { count: 1, folds: 2 } },
    cutLoose: {},
  });
  observeRemapPackage("land", 12, 8);
  expect(report.remapPackages.land[12].count).toBe(2);
});
