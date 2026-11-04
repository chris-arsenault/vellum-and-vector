import type { AtlasFeature } from "@atlas/domain";
import type { GenerationState } from "../process";
import { isContent } from "../regional/lattice";
import type { RegionalState } from "../regional/state";
import type { PoiCarried, PoiPlace, PoiUnrealized } from "./poiContract";
import { cellsWithin, featureCell, fieldOf, gap, nearestWhere } from "./poiReads";

/**
 * What most places need to cross onto a refined map, as rules an entry names: the feature
 * lands on the child's lattice; its counterpart is the nearest cell of its kind; failing
 * that it keeps, moves or drops. Refinement writes the child only.
 */
export const carryWhereItLands = (
  state: RegionalState,
  feature: AtlasFeature
): PoiCarried | null => {
  const cell = featureCell(state, feature);
  return cell >= 0 && isContent(state.physical.map.mesh, cell) ? { feature, cell } : null;
};
/** The nearest cell of the kind within `parentCells` of the parent's cell span, or -1. */
export const counterpartOf =
  (isA: (state: GenerationState, cell: number) => boolean, parentCells: number) =>
  (state: RegionalState, carried: PoiCarried) =>
    nearestWhere(state, carried.cell, parentCells * state.regional.parentSpan, (cell) =>
      isA(state, cell)
    );
export const stays = (): PoiUnrealized => ({ outcome: "keep" });
export const goes = (): PoiUnrealized => ({ outcome: "drop" });
/** Stands at the nearest cell of the kind, or keeps its place if none is near. */
export const movesTo =
  (counterpart: (state: RegionalState, carried: PoiCarried) => number) =>
  (state: RegionalState, carried: PoiCarried): PoiUnrealized => {
    const cell = counterpart(state, carried);
    return cell >= 0 ? { outcome: "move", cell } : { outcome: "keep" };
  };

/** A network's cost multiplied by `factor` on the cells of a place, or within `reach` metres of its anchor. */
export const costNear =
  (factor: number, reach = 0) =>
  (state: GenerationState, place: PoiPlace, cell: number) =>
    place.cells.includes(cell) || (reach > 0 && gap(state, place.anchor, cell) <= reach)
      ? factor
      : 1;
/** Every cell of a place and those within `radius` metres of its anchor. */
export const groundOf = (state: GenerationState, place: PoiPlace, radius: number) => [
  ...new Set([...place.cells, ...cellsWithin(state, place.anchor, radius)]),
];
export const parentSpanOf = (state: RegionalState) => state.regional.parentSpan;
export const fieldOfRegion = (state: RegionalState) => fieldOf(state);
