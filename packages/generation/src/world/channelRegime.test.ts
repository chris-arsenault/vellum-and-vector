import { expect, it } from "vitest";
import { riverFlow, riverRegime, riverRegimes } from "./channelRegime";

it("asks the same stretch of cells for a river on every map, so a finer map shows smaller rivers", () => {
  const coarse = riverFlow(196e6, 300),
    fine = riverFlow(9e6, 300);
  // About 24 cells of 14 km shedding 300 mm a year.
  expect(coarse).toBeCloseTo((24 * 196e6 * 0.3) / (365.25 * 86_400), 6);
  expect(fine).toBeLessThan(coarse);
  expect(coarse / fine).toBeCloseTo(196 / 9, 6);
  expect(riverFlow(196e6, 0)).toBe(0);
});

it("calls a river perennial, seasonal or absent by what it carries wet and dry", () => {
  const river = 40;
  // Fed all year: a river.
  expect(riverRegime(120, 60, river)).toBe(riverRegimes.perennial);
  // A river in the wet season and a dry bed after it.
  expect(riverRegime(120, 4, river)).toBe(riverRegimes.seasonal);
  // Never a river's flow: unchannelled country, however wet its one season.
  expect(riverRegime(30, 0, river)).toBe(riverRegimes.none);
  expect(riverRegime(0, 0, river)).toBe(riverRegimes.none);
  expect(riverRegime(120, 60, 0)).toBe(riverRegimes.none);
});

it("ends a river where it has lost its water, without help from what lies below", () => {
  // Flows down a line through dry country: each cell is judged on what reaches it.
  const river = 40,
    flood = [90, 70, 45, 30, 12],
    dry = [50, 41, 20, 8, 0];
  expect(flood.map((value, i) => riverRegime(value, dry[i], river))).toEqual([
    riverRegimes.perennial,
    riverRegimes.perennial,
    riverRegimes.seasonal,
    riverRegimes.none,
    riverRegimes.none,
  ]);
});
