import { heldCharge } from "../../canonry/magicFeedback";
import type { MagicField } from "../../canonry/magicState";
import type { GenerationState } from "../../process";
import type { PoiFieldChange, PoiPlace } from "../poiContract";
import { fieldOf, magicValue } from "../poiReads";

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

/** Charged ground weakens the rock under it, in proportion to the field. */
export const softening = (state: GenerationState, place: PoiPlace): PoiFieldChange[] => {
  const effect = auroraOf(state)?.definition.effects.rockResistance ?? 0;
  return place.cells.map((cell) => ({
    change: "add",
    band: "RockResistance",
    cell,
    amount: (auroraAt(state, cell) / 1000) * effect,
  }));
};
/** Charge held in the ground exhales cold, in the Temperature band's native units. */
export const cooling = (state: GenerationState, place: PoiPlace): PoiFieldChange[] => {
  const effect = auroraOf(state)?.definition.effects.heat ?? 0;
  return place.cells.map((cell) => ({
    change: "add",
    band: "Temperature",
    cell,
    amount: Math.round(auroraAt(state, cell) * effect * chargeHeldAt(state, cell)),
  }));
};
/** Charge held in ice takes a share of its ablation away, so the ice outlasts its climate. */
export const holdingIce = (state: GenerationState, place: PoiPlace): PoiFieldChange[] => {
  const effect = auroraOf(state)?.definition.effects.icePersistence ?? 0;
  return place.cells.map((cell) => ({
    change: "atLeast",
    band: "IcePersistence",
    cell,
    value: effect * chargeHeldAt(state, cell),
  }));
};
/** Charge held in the ground slows growth and decay; ecology's rime and glow classes read it. */
export const stilling = (state: GenerationState, place: PoiPlace): PoiFieldChange[] => {
  const effect = auroraOf(state)?.definition.effects.stillness ?? 0;
  return place.cells.map((cell) => ({
    change: "atLeast",
    band: "Stillness",
    cell,
    value: Math.min(1, (auroraAt(state, cell) / 1000) * effect * chargeHeldAt(state, cell)),
  }));
};
/** The concentration of charge in a place's ice, held at what it has gathered. */
export const storingCharge = (state: GenerationState, place: PoiPlace): PoiFieldChange[] =>
  place.cells.map((cell) => ({
    change: "atLeast",
    band: "IceCharge",
    cell,
    value: fieldOf(state).IceCharge.get(cell),
  }));
