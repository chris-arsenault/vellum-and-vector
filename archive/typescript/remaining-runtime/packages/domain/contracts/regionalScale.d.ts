import type { Area } from "./model";
export declare const defaultWorldDimensions: {
  width: number;
  height: number;
};
export declare const referenceWorldArea: number;
export declare const defaultTerrainCells = 60000;
export declare const regionalUsableLandFraction = 0.35;
export declare const regionalSubdivisionCount = 7;
/**
 * A fixed physical ladder, calibrated once on the default world, never fitted to a selection.
 *
 * owner-direction(2026-11-12): the resolutions are fixed; a detail level is not a cell count.
 */
export declare function regionalScale(
  level: number,
  quality?: string
): {
  cellArea: number;
  cellAreaKm2: number;
  cellSpan: number;
};
/** The selection a level suggests: the ground its Standard cells cover at the default count. */
export declare function regionalSelectionArea(level: number): number;
/** A world is level zero; each independent map records its own refinement level. */
export declare function mapRefinementLevel(areas: Record<string, Area>, areaId: string): number;
