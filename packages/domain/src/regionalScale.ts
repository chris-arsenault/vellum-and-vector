import type { Area } from "./model";
import { requireThat } from "./errors";
import { MapScale } from "./mapScale";

export const defaultWorldDimensions = {
  width: MapScale.referenceWidth,
  height: MapScale.referenceHeight,
};
export const referenceWorldArea = defaultWorldDimensions.width * defaultWorldDimensions.height;
export const defaultTerrainCells = 60_000;
export const regionalUsableLandFraction = 0.35;
// A world's land divides into about this many regions, and each level divides again alike, so a
// Standard region holds about the cells of the default Standard world.
// owner-direction(2026-11-12): a standard region has roughly the cells of the default standard world, at 7-ish land regions in a world.
export const regionalSubdivisionCount = 7;
const regionalDetailArea = { draft: 4, standard: 1, fine: 0.25 };

/**
 * A fixed physical ladder, calibrated once on the default world, never fitted to a selection.
 *
 * owner-direction(2026-11-12): the resolutions are fixed; a detail level is not a cell count.
 */
export function regionalScale(level: number, quality = "standard") {
  requireThat(
    Number.isInteger(level) && level > 0,
    "regional_scale",
    "Choose a positive regional scale level."
  );
  requireThat(
    Object.hasOwn(regionalDetailArea, quality),
    "generation_quality",
    "Choose draft, standard or fine."
  );
  const standardArea =
    (referenceWorldArea * regionalUsableLandFraction) /
    regionalSubdivisionCount ** level /
    defaultTerrainCells;
  const cellArea = standardArea * regionalDetailArea[quality as keyof typeof regionalDetailArea];
  return {
    cellArea,
    cellAreaKm2: MapScale.areaUnits(cellArea, "m2", "km2"),
    cellSpan: Math.sqrt(cellArea),
  };
}

/** The selection a level suggests: the ground its Standard cells cover at the default count. */
export function regionalSelectionArea(level: number) {
  return regionalScale(level).cellArea * defaultTerrainCells;
}

/** A world is level zero; each independent map records its own refinement level. */
export function mapRefinementLevel(areas: Record<string, Area>, areaId: string) {
  const area = areas[areaId];
  requireThat(area, "missing_area", "Choose an existing map.");
  return area.map ? area.map.refinementLevel : 0;
}
