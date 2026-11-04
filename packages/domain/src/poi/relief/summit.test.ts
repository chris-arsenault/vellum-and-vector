import { expect, it } from "vitest";
import { summit } from "./summit";
import { cellAt, cone, gridMap } from "../testMap";
import { landPeaks } from "../prominence";
import type { PoiMap, PoiPlace } from "../poiTypes";

const size = 41,
  span = 1000,
  middle = cellAt(size, 20, 20);
const importanceAt = (map: PoiMap, cell: number) => {
  const place = summit.identity.find(map).find((found) => found.anchor === cell);
  if (!place) throw new Error("No summit at that cell.");
  return summit.visibility.importance(place, map);
};
/** Three higher tops around the middle one, all on a high base: the middle is a lesser peak. */
const range = (column: number, row: number) =>
  1000 +
  cone(20, 20, 500, 4)(column, row) +
  cone(20, 12, 1500, 7)(column, row) +
  cone(13, 25, 1500, 7)(column, row) +
  cone(27, 25, 1500, 7)(column, row);

it("ranks a 1500 m summit over plains far above the same height among higher peaks", () => {
  const plains = gridMap(size, size, span, {
    elevation: (c, r) => 100 + cone(20, 20, 1400, 8)(c, r),
  });
  const mountains = gridMap(size, size, span, { elevation: range });
  expect(plains.read("elevation", middle)).toBe(1500);
  expect(mountains.read("elevation", middle)).toBe(1500);
  expect(importanceAt(plains, middle)).toBeGreaterThan(0.6);
  expect(importanceAt(mountains, middle)).toBeLessThan(0.3);
});

it("carries a lesser summit when a capital is named after it", () => {
  const place = (id: string, kind: "summit" | "settlement", extra: Partial<PoiPlace>) =>
    ({ id, kind, cells: [], anchor: middle, measures: {}, roles: [], ...extra }) as PoiPlace;
  const named = gridMap(size, size, span, { elevation: range }, [
    place("mount", "summit", {}),
    place("town", "settlement", {
      anchor: cellAt(size, 20, 22),
      roles: ["capital"],
      namedAfter: "mount",
    }),
  ]);
  expect(importanceAt(named, middle)).toBe(1);
});

it("measures prominence above the key col and finds no summit in a flat field", () => {
  // Two tops of 900 m and 700 m joined by a col at 300 m on a 100 m plain: the higher stands
  // its full height above the sea, the lower 400 m above the col.
  const twin = gridMap(size, size, span, {
    elevation: (c, r) =>
      100 + Math.max(cone(12, 20, 800, 9)(c, r), cone(28, 20, 600, 9)(c, r), r === 20 ? 200 : 0),
  });
  const peaks = new Map(landPeaks(twin).map((peak) => [peak.cell, peak]));
  expect(peaks.get(cellAt(size, 12, 20))?.prominence).toBe(900);
  expect(peaks.get(cellAt(size, 28, 20))?.prominence).toBe(400);
  expect(summit.identity.find(gridMap(size, size, span, { elevation: () => 50 }))).toEqual([]);
});
