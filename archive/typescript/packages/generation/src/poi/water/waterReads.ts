import { mappedRiverCells } from "../../area/riverCourses";
import type { GenerationState } from "../../process";
import type { PoiPlace } from "../poiContract";
import { adjacent, cellsWithin, fieldOf, moistureAt } from "../poiReads";
import { riverSuccessor } from "../../water/riverKeeping";

/** What the water group's entries read in common. Nothing here computes geography or writes. */

/** Whether a cell is on a river this map draws: the one test a place standing on a river uses. */
export const onMappedRiver = (state: GenerationState, cell: number) =>
  mappedRiverCells(state).has(cell);

/** The next cell of the owned river, or -1 at an unrepresented end. */
export const flowTarget = (state: GenerationState, cell: number) =>
  riverSuccessor(fieldOf(state), cell);

/** Terrain drainage includes water too small to be an owned river. */
export function* inflows(state: GenerationState, cell: number) {
  for (const next of adjacent(state, cell))
    if (fieldOf(state).FlowTargets.get(next) === cell) yield next;
}

/** A place's ground area in square metres, counting only the cells this map owns. */
export const areaOf = (state: GenerationState, place: PoiPlace) => {
  const mesh = fieldOf(state).mesh;
  return place.cells.reduce((sum, cell) => sum + mesh.contentArea(cell), 0);
};

/** A reach of this many of the map's cell spans. */
export const spans = (count: number) => (state: GenerationState) =>
  fieldOf(state).scale.cells(count);

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
