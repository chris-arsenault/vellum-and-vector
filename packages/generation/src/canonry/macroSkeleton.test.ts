import { expect, it } from "vitest";
import { macroFixture } from "./macroFixtures";
import { regionSpines, summitHierarchy } from "./macroSkeleton";
import { descendingGrade } from "./macroGrades";

it("follows a curved connected region instead of joining its ends through empty space", () => {
  const mesh = macroFixture().physical!.map.mesh,
    cells = Array.from(mesh.x.keys()).filter((i) => {
      const r = Math.hypot(mesh.x[i], mesh.y[i]);
      return r > 50_000 && r < 70_000 && mesh.x[i] > -10_000;
    }),
    members = new Set(cells),
    paths = regionSpines(mesh, cells, 20_000);
  expect(paths[0].length).toBeGreaterThan(10);
  expect(paths.flat().every((i) => members.has(i))).toBe(true);
});
it("ranks a lower isolated summit above a higher shoulder with little prominence", () => {
  const mesh = macroFixture().physical!.map.mesh,
    cells = Array.from(mesh.x.keys()).filter((i) => Math.hypot(mesh.x[i], mesh.y[i]) < 85_000),
    height = Float64Array.from(mesh.x, (x, i) =>
      Math.max(
        2000 * Math.exp(-((x + 30_000) ** 2 + mesh.y[i] ** 2) / 20_000 ** 2),
        1400 * Math.exp(-((x - 40_000) ** 2 + mesh.y[i] ** 2) / 10_000 ** 2)
      )
    ),
    ranked = summitHierarchy(mesh, cells, height);
  expect(ranked[0].prominence).toBeGreaterThan(1500);
  expect(ranked.some((p) => p.prominence > 1000 && p.prominence < 1500)).toBe(true);
});
it("fits noisy grades without moving shared terminal elevations", () => {
  const fitted = descendingGrade([100, 80, 95, 30, 40, 10], [1, 1, 1, 1, 1, 1], 100, 10);
  expect(fitted).toEqual([100, 87.5, 87.5, 35, 35, 10]);
});
