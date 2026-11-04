import { heldCharge } from "../../canonry/magicFeedback";
import type { MagicField } from "../../canonry/magicState";
import type { GenerationState } from "../../process";
import type { PoiPlace } from "../poiContract";
import { cellSpan, fieldOf, magicValue } from "../poiReads";

/**
 * A place's country, `metres` around it. A place is read against its country, which takes at
 * least the cells beside it to see, whatever the map's cell size.
 */
export const countryOf = (metres: number) => (state: GenerationState) =>
  Math.max(2 * cellSpan(state), metres);

/** One system's whole field, for the channels and parameters `magicValue` does not name. */
export const magicFieldOf = (state: GenerationState, system: string): MagicField | undefined =>
  state.physical?.magic?.fields.find((field) => field.definition.id === system);

/** A system's intensity at a cell, per mille. */
export const intensityOf = (system: string) => (state: GenerationState, cell: number) =>
  magicValue(state, system, "intensity", cell);

/** The greatest of a reading across a place's cells. */
export const peakOf = (
  state: GenerationState,
  place: PoiPlace,
  read: (state: GenerationState, cell: number) => number
) => place.cells.reduce((peak, cell) => Math.max(peak, read(state, cell)), 0);

/** A place's ground area in square metres, each cell weighted by a share in [0, 1]. */
export const weightedArea = (
  state: GenerationState,
  place: PoiPlace,
  share: (cell: number) => number
) => {
  const mesh = fieldOf(state).mesh;
  return place.cells.reduce((sum, cell) => sum + mesh.area(cell) * share(cell), 0);
};

/** Whether one place's anchor lies among the cells of the other place. */
export const standsIn = (_state: GenerationState, place: PoiPlace, other: PoiPlace) =>
  other.cells.includes(place.anchor);

export const auroraAt = intensityOf("aurora");
const auroraOf = (state: GenerationState) => magicFieldOf(state, "aurora");

/**
 * How far a cell's ice or relict ground actually holds Aurora's charge, in [0, 1]: the
 * generator's own `heldCharge`, which is what its cooling and stillness are scaled by.
 */
export const chargeHeldAt = (state: GenerationState, cell: number) => {
  const field = auroraOf(state);
  return field ? heldCharge(fieldOf(state), field, cell) : 0;
};
