import type { EditOutcome, MapEditing, MapRef, TerrainOutcome } from "@atlas/map";

/** Which family an editing action belonged to: a feature edit or a terrain edit. */
export type ActionKind = "f" | "t";
/** What one Undo and one Redo reach, in the order the creator did things. */
export interface ActionStack {
  done: ActionKind[];
  undone: ActionKind[];
}
export const emptyStack: ActionStack = { done: [], undone: [] };
/** A new action ends the redo line. */
export const recordAction = (stack: ActionStack, kind: ActionKind): ActionStack => ({
  done: [...stack.done, kind],
  undone: [],
});
export const nextUndo = (stack: ActionStack): ActionKind | undefined => stack.done.at(-1);
export const nextRedo = (stack: ActionStack): ActionKind | undefined => stack.undone.at(-1);
export const afterUndo = (stack: ActionStack): ActionStack =>
  stack.done.length
    ? { done: stack.done.slice(0, -1), undone: [...stack.undone, stack.done.at(-1)!] }
    : stack;
export const afterRedo = (stack: ActionStack): ActionStack =>
  stack.undone.length
    ? { done: [...stack.done, stack.undone.at(-1)!], undone: stack.undone.slice(0, -1) }
    : stack;

/** Run one undo or redo against the service that holds the action: a terrain action goes to
 * the terrain history, anything else (or nothing recorded this visit) to the feature history.
 * `perform` settles feature outcomes; `guard` reports errors for terrain ones. */
export function runStep(input: {
  kind: ActionKind | undefined;
  direction: "undo" | "redo";
  editing: MapEditing;
  reference: MapRef;
  perform(work: () => Promise<EditOutcome>): Promise<EditOutcome | undefined>;
  guard(work: () => Promise<TerrainOutcome>): Promise<TerrainOutcome | undefined>;
}): Promise<EditOutcome | TerrainOutcome | undefined> {
  const { kind, direction, editing, reference } = input;
  if (kind === "t")
    return input.guard(() =>
      direction === "undo" ? editing.undoTerrain(reference) : editing.redoTerrain(reference)
    );
  return input.perform(() => editing[direction](reference));
}
