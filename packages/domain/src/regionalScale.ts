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
export const regionalSubdivisionCount = 12;
const regionalDetailArea = { draft: 4, standard: 1, fine: 0.25 };

/** An independent child resolves its own frame; ancestry never multiplies its cell count. */
export function regionalScale(level: number, quality: string, scale: MapScale) {
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
  return scale.resolution(
    defaultTerrainCells / regionalDetailArea[quality as keyof typeof regionalDetailArea]
  );
}

/** Selection shares use the actual root-world frame, with the existing dimensionless subdivision. */
export function regionalSelectionArea(level: number, rootScale: MapScale) {
  requireThat(
    Number.isInteger(level) && level > 0,
    "regional_scale",
    "Choose a positive regional scale level."
  );
  return rootScale.resolution(regionalSubdivisionCount ** level / regionalUsableLandFraction)
    .cellArea;
}

/** A world is level zero; each independent map records its own refinement level. */
export function mapRefinementLevel(areas: Record<string, Area>, areaId: string) {
  const area = areas[areaId];
  requireThat(area, "missing_area", "Choose an existing map.");
  return area.map ? area.map.refinementLevel : 0;
}
