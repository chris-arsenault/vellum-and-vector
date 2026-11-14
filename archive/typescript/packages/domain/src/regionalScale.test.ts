import { expect, it } from "vitest";
import {
  defaultTerrainCells,
  referenceWorldArea,
  regionalScale,
  regionalSelectionArea,
  regionalUsableLandFraction,
} from "./regionalScale";

// Owner direction: a Standard region holds about the cells of the default Standard world when
// the world's land divides into about seven regions.
it("gives a Standard region about the default world's cells at about seven regions of land", () => {
  const land = referenceWorldArea * regionalUsableLandFraction,
    region = regionalSelectionArea(1),
    regions = land / region;
  expect(regions).toBeGreaterThanOrEqual(6);
  expect(regions).toBeLessThanOrEqual(8);
  expect(region / regionalScale(1, "standard").cellArea).toBeCloseTo(defaultTerrainCells, 6);
});

it("keeps the ladder fixed: a level and a detail give one cell size whatever the map", () => {
  expect(regionalScale(2).cellArea).toBeLessThan(regionalScale(1).cellArea);
  expect(regionalScale(1, "draft").cellArea).toBe(4 * regionalScale(1, "standard").cellArea);
  expect(regionalScale(1, "fine").cellArea).toBe(regionalScale(1, "standard").cellArea / 4);
});
