import { mappedRiverCells } from "../../area/riverCourses";
import type { GenerationState } from "../../process";
import type { PoiPlace } from "../poiContract";
import { adjacent, cellSpan, cellsWithin, fieldOf, moistureAt } from "../poiReads";

/** What the water group's entries read in common. Nothing here computes geography or writes. */

/** Whether a cell is on a river this map draws: the one test a place standing on a river uses. */
export const onMappedRiver = (state: GenerationState, cell: number) =>
  mappedRiverCells(state).has(cell);

/** The cell a cell drains to, or -1 where its water leaves the network. */
export const flowTarget = (state: GenerationState, cell: number) =>
  fieldOf(state).FlowTargets.get(cell);

/** The neighbours draining into a cell. */
export function* inflows(state: GenerationState, cell: number) {
  for (const next of adjacent(state, cell)) if (flowTarget(state, next) === cell) yield next;
}

/** A place's ground area in square metres, counting only the cells this map owns. */
export const areaOf = (state: GenerationState, place: PoiPlace) => {
  const mesh = fieldOf(state).mesh;
  return place.cells.reduce((sum, cell) => sum + mesh.contentArea(cell), 0);
};

/** A reach of this many of the map's cell spans. */
export const spans = (count: number) => (state: GenerationState) => count * cellSpan(state);

/** How dry the country around a place is, in [0, 1]: a water source counts for more there. */
export const drynessAround = (radius: (state: GenerationState) => number) => {
  return (state: GenerationState, place: PoiPlace) => {
    const around = cellsWithin(state, place.anchor, radius(state)),
      wet = around.reduce((sum, cell) => sum + moistureAt(state, cell), 0) / around.length;
    return Math.max(0, Math.min(1, 1 - wet));
  };
};

/** Whether a place's cells hold another's anchor, read from the other side of `holds`. */
export const standsIn = (_state: GenerationState, a: PoiPlace, b: PoiPlace) =>
  b.cells.includes(a.anchor);
