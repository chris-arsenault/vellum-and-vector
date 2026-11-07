import { expect, it } from "vitest";
import { createField } from "./world/field";
import { createWorldMesh } from "./world/worldMesh";
import { topographicProminence } from "./topographicProminence";

/**
 * A ridge profile along x on every row: a high peak in the west, a saddle, and a lower peak
 * in the east. Prominence is the lower peak's rise above the saddle and the high peak's
 * rise above the datum.
 */
it("measures each summit's rise above its key col and the highest above the datum", () => {
  const mesh = createWorldMesh([0, 0, 8000, 4000], 32, 0),
    map = createField(mesh),
    profile = (x: number) =>
      x < 0 ? 800 - Math.abs(x + 2000) / 10 : 500 - Math.abs(x - 2000) / 10;
  for (let i = 0; i < mesh.count; i++) map.Elevation.set(i, profile(mesh.x(i)));
  const adjacent = (i: number) => {
    const cells: number[] = [];
    for (let edge = 0; edge < mesh.degree(i); edge++) {
      const j = mesh.neighbor(i, edge);
      if (j >= 0) cells.push(j);
    }
    return cells;
  };
  const { rise, saddle } = topographicProminence(map.coverage, map.Elevation, adjacent, 0),
    heights = Array.from({ length: mesh.count }, (_, i) => map.Elevation.get(i)),
    highest = Math.max(...heights),
    east = Math.max(...heights.filter((_, i) => mesh.x(i) > 0)),
    col = Math.min(...heights.filter((_, i) => Math.abs(mesh.x(i)) < 500));
  const risesAt = (height: number) =>
    heights.map((h, i) => (h === height ? rise.get(i) : 0)).reduce((a, b) => Math.max(a, b));
  expect(risesAt(highest)).toBeCloseTo(highest, 9);
  expect(risesAt(east)).toBeCloseTo(east - col, 9);
  // The lower peak's saddle is a cell at the col's height.
  const peak = heights.findIndex((h, i) => h === east && rise.get(i) > 0);
  expect(map.Elevation.get(saddle.get(peak))).toBeCloseTo(col, 9);
  // Cells that are not summits of anything have no rise.
  const nonSummit = heights.findIndex((h, i) => h < east && h > col && mesh.x(i) > 0);
  expect(rise.get(nonSummit)).toBe(0);
  map.coverage.release(rise);
  map.coverage.release(saddle);
});
