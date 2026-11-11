import type { GenerationState } from "../process";
import { runMemory } from "../runMemory";

/**
 * The works people have raised on a map that the map's own mesh can show: today, the dams
 * that hold back water enough to be a lake. Like the places, this is the run's memory of what
 * was built and by whom; the water itself is the land's.
 */
export interface KnownWork {
  readonly id: string;
  readonly kind: "dam";
  /** The river cell it stands on, and the place whose people raised it. */
  readonly cell: number;
  readonly place: string;
  /** The era it was raised in, and the era it failed in once its people had gone. */
  readonly built: string;
  failed?: string;
  /** How many cells of lake it held when it was raised. */
  readonly holds: number;
}
interface Works {
  next: number;
  known: KnownWork[];
  /** River cells where a dam was tried and held too little water for this map to show. */
  tried: number[];
  /** Whether a dam has been raised or has failed since the map's water was last published. */
  moved: boolean;
}
const works = (state: GenerationState) =>
  runMemory<Works>(state, "human.works", () => ({ next: 0, known: [], tried: [], moved: false }));

/** The works still standing. */
export const standingWorks = (state: GenerationState): readonly KnownWork[] =>
  works(state).known.filter((work) => !work.failed);
/** Whether a dam has stood, or been tried and found wanting, on this cell. */
export const damTried = (state: GenerationState, cell: number) =>
  works(state).tried.includes(cell) || works(state).known.some((work) => work.cell === cell);

export function recordDam(
  state: GenerationState,
  dam: Pick<KnownWork, "cell" | "place" | "built" | "holds">
) {
  const memory = works(state),
    work: KnownWork = { id: `work:${memory.next++}`, kind: "dam", ...dam };
  memory.known.push(work);
  memory.moved = true;
  return work;
}
/** A dam whose people have gone fails, and the water it held goes with it. */
export function failDam(state: GenerationState, work: KnownWork, era: string) {
  work.failed = era;
  works(state).moved = true;
}
/** Something other than a remembered dam has moved the map's water: a dam a creator drew. */
export const noteWaterMoved = (state: GenerationState) => {
  works(state).moved = true;
};
/** Whether the map's water has moved since it was last published; asking settles it. */
export function takeWaterMoved(state: GenerationState) {
  const memory = works(state),
    moved = memory.moved;
  memory.moved = false;
  return moved;
}
/** A dam tried here held less than the map can show; it is not tried again. */
export const recordDryDam = (state: GenerationState, cell: number) => {
  works(state).tried.push(cell);
};
