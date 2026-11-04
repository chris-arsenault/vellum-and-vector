import { spatial, type AtlasFeature } from "@atlas/domain";
import { meshWindowCells } from "../canonry/meshWindow";
import type { GenerationState } from "../process";
import { cellAt, isContent, positionOf } from "../regional/lattice";
import type { RegionalState } from "../regional/state";
import type { PoiCarried, PoiCost, PoiPlace, PoiUnrealized } from "./poiContract";
import { cellsWithin, fieldOf, nearestWhere } from "./poiReads";

/** The cell locating a record: its stated representative, or the interior of its shape. */
function locatingCell(state: RegionalState, feature: AtlasFeature) {
  const stated = feature.attributes.representative as { x?: number; y?: number } | undefined,
    at =
      stated && Number.isFinite(stated.x) && Number.isFinite(stated.y)
        ? { x: stated.x!, y: stated.y! }
        : spatial.interiorPosition(feature.geometry);
  return cellAt(fieldOf(state).mesh, at.x, at.y);
}
/** Every cell a record's area covers on this map; a point or line covers only its locating cell. */
function coveredCells(state: RegionalState, feature: AtlasFeature, cell: number) {
  if (!feature.geometry.type.includes("Polygon")) return [cell];
  const mesh = fieldOf(state).mesh,
    covers = spatial.pointCoverage(feature.geometry),
    found: number[] = [];
  for (const other of meshWindowCells(mesh, spatial.bounds(feature.geometry))) {
    const { x, y } = positionOf(mesh, other);
    if (isContent(mesh, other) && covers({ x, y, z: 0 })) found.push(other);
  }
  return found.length ? found : [cell];
}
/**
 * What most places need to cross onto a refined map, as rules an entry names: the feature
 * lands on the child's lattice; its counterpart is the nearest cell of its kind; failing
 * that it keeps, moves or drops. Refinement writes the child only.
 */
export const carryWhereItLands = (
  state: RegionalState,
  feature: AtlasFeature
): PoiCarried | null => {
  const cell = locatingCell(state, feature);
  return cell >= 0 && isContent(fieldOf(state).mesh, cell)
    ? { feature, cell, cells: coveredCells(state, feature, cell) }
    : null;
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
  (factor: number, reach: number | ((state: GenerationState, place: PoiPlace) => number) = 0) =>
  (state: GenerationState, place: PoiPlace): readonly PoiCost[] =>
    groundOf(state, place, typeof reach === "function" ? reach(state, place) : reach).map(
      (cell) => ({ cell, factor })
    );
/** Every cell of a place and those within `radius` metres of its anchor. */
export const groundOf = (state: GenerationState, place: PoiPlace, radius: number) =>
  radius > 0
    ? [...new Set([...place.cells, ...cellsWithin(state, place.anchor, radius)])]
    : place.cells;
export const parentSpanOf = (state: RegionalState) => state.regional.parentSpan;
export const fieldOfRegion = (state: RegionalState) => fieldOf(state);
