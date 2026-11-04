import type { GenerationState } from "../../process";
import type { PoiFieldChange, PoiPlace } from "../poiContract";
import type { PoiKindId } from "../poiKinds";
import { namingCultureNear, settlementWithin } from "../poiPlaces";
import {
  adjacent,
  fieldOf,
  gap,
  heldFor,
  isLand,
  isSea,
  magicValue,
  metres,
  toNative,
  waveExposureAt,
} from "../poiReads";

/** What the sea group's entries read in common. Nothing here writes to the state. */

/** Pressure's intensity at a cell, in [0, 1]; none where the system is absent. */
export const pressureAt = (state: GenerationState, cell: number) =>
  magicValue(state, "pressure", "intensity", cell) / 1000;

type PressureLength =
  "rayDistance" | "coastalRayDistance" | "coastalSourceDistance" | "wakeDistance";
/** A length Pressure's own preset declares, in metres; `absent` where the system is absent. */
export function pressureLength(state: GenerationState, name: PressureLength, absent: number) {
  const field = state.physical?.magic?.fields.find((f) => f.definition.id === "pressure");
  return field?.definition.parameters[name] ?? absent;
}

/** The ground area of a place, in square metres. */
export const areaOf = (state: GenerationState, place: PoiPlace) => {
  const mesh = fieldOf(state).mesh;
  return place.cells.reduce((sum, cell) => sum + mesh.contentArea(cell), 0);
};
/** How far a place runs from its anchor, in metres. */
export const extentOf = (state: GenerationState, place: PoiPlace) =>
  heldFor(state, `extent:${place.id}`, () =>
    place.cells.reduce((most, cell) => Math.max(most, gap(state, place.anchor, cell)), 0)
  );

/** A carried place as a place on the child's lattice, for rules written over places. */
export const placeAt = (kind: PoiKindId, id: string, cell: number): PoiPlace => ({
  id,
  kind,
  cells: [cell],
  anchor: cell,
});

const besideSea = (state: GenerationState, cell: number) => {
  for (const next of adjacent(state, cell)) if (isSea(state, next)) return true;
  return false;
};
/** The cells of a place with sea beside them. */
export const seaFacing = (state: GenerationState, cells: readonly number[]) =>
  cells.filter((cell) => besideSea(state, cell));
/** The land cells beside a place's water. */
export function shoreOf(state: GenerationState, place: PoiPlace) {
  const shore = new Set<number>();
  for (const cell of place.cells)
    for (const next of adjacent(state, cell)) if (isLand(state, next)) shore.add(next);
  return [...shore];
}
/** The strongest wave exposure on a cell and the cells beside it, in [0, 1]. */
export function exposureBeside(state: GenerationState, cell: number) {
  let most = waveExposureAt(state, cell);
  for (const next of adjacent(state, cell)) most = Math.max(most, waveExposureAt(state, next));
  return most;
}
/** Sea-bed held at least `depth` metres under the water on each cell. */
export const heldUnder = (
  state: GenerationState,
  cells: readonly number[],
  depth: number
): PoiFieldChange[] => {
  const value = fieldOf(state).EffectiveSeaLevel - toNative(depth);
  return cells.map((cell) => ({ change: "atMost", band: "Elevation", cell, value }));
};
/** Water depth at a cell, in metres. */
export const depthAt = (state: GenerationState, cell: number) =>
  metres(fieldOf(state).WaterDepths.get(cell));

/** Sea life at a cell against what a good fishery holds, in [0, 1]: half at `typicalFauna`. */
const typicalFauna = 0.1;
export const faunaAt = (state: GenerationState, cell: number) => {
  const fauna = fieldOf(state).AquaticFauna.get(cell);
  return fauna / (fauna + typicalFauna);
};

/** The storm track at a cell, in [0, 1]. */
export const stormAt = (state: GenerationState, cell: number) =>
  fieldOf(state).StormTrack.get(cell) / 1000;

/**
 * Open water has a name only where someone sails to know it: the culture of the nearest
 * settlement if one stands within `reach` metres, otherwise none.
 */
export const namedFromShore =
  (reach: (state: GenerationState) => number) => (state: GenerationState, place: PoiPlace) =>
    settlementWithin(state, place.anchor, reach(state)) ? namingCultureNear(state, place) : null;
