import type { Area } from "./model";
import { requireThat } from "./errors";

export const defaultWorldDimensions = { width: 4_000_000, height: 3_000_000 };
export const referenceWorldArea = defaultWorldDimensions.width * defaultWorldDimensions.height;
export const defaultTerrainCells = 60_000;
export const regionalUsableLandFraction = 0.35;
export const regionalSubdivisionCount = 12;
const regionalDetailArea = { draft: 4, standard: 1, fine: 0.25 };

/** A fixed physical scale ladder, calibrated once rather than fitted to each selection. */
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
  return { cellArea, cellAreaKm2: cellArea / 1e6, cellSpan: Math.sqrt(cellArea) };
}

export function regionalSelectionArea(level: number) {
  return regionalScale(level).cellArea * defaultTerrainCells;
}

/** New maps pin their level; the short ancestry fallback supports older map records. */
export function mapRefinementLevel(areas: Record<string, Area>, areaId: string) {
  let level = 0;
  for (let area = areas[areaId]; area?.map; area = areas[area.parentId ?? ""]) {
    if (area.map.refinementLevel !== undefined) return level + area.map.refinementLevel;
    level++;
  }
  return level;
}
