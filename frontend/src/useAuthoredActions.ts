import { useCallback, useRef, useState } from "react";
import type {
  EditCommand,
  EditOutcome,
  EditStep,
  MapDescriptor,
  MapEditing,
  TerrainEdit,
  TerrainOutcome,
} from "@atlas/map";
import {
  afterRedo,
  afterUndo,
  emptyStack,
  nextRedo,
  nextUndo,
  recordAction,
  runStep,
  type ActionKind,
  type ActionStack,
} from "./authoredUndo";

type Perform = (work: () => Promise<EditOutcome>) => Promise<EditOutcome | undefined>;
export type Guard = <T>(work: () => Promise<T>) => Promise<T | undefined>;
interface Inputs {
  map: MapDescriptor;
  editing: MapEditing;
  perform: Perform;
  guard: Guard;
  steps: EditStep[];
}
/** A command that creates something outside the coasts leaves the terrain as it was. */
export const touchesTerrain = (command: EditCommand) =>
  command.command !== "create" || command.layerId.endsWith("landmasses");

/** The ordered actions of an authored map: feature edits and terrain edits share one Undo
 * and one Redo (ADR 0019). `stamp` counts terrain rewrites; the viewer reloads the raster
 * when it changes. */
export function useAuthoredActions({ map, editing, perform, guard, steps }: Inputs) {
  const reference = map.reference;
  const [stack, setStack] = useState<ActionStack>(emptyStack);
  const held = useRef(stack);
  const [stamp, setStamp] = useState(0);
  const [terrainRange, setRange] = useState({ undo: false, redo: false });
  const move = useCallback((next: ActionStack) => {
    held.current = next;
    setStack(next);
  }, []);
  const reload = useCallback(() => setStamp((value) => value + 1), []);
  const nextOf = (kind: ActionKind | undefined, fallback: boolean) =>
    kind ?? (fallback ? "f" : undefined);
  const undoKind = nextOf(
    nextUndo(stack),
    steps.some((step) => !step.undone)
  );
  const redoKind = nextOf(
    nextRedo(stack),
    steps.some((step) => step.undone)
  );
  const run = useCallback(
    async (command: EditCommand) => {
      const outcome = await perform(() => editing.edit(reference, command));
      if (outcome) {
        move(recordAction(held.current, "f"));
        if (touchesTerrain(command)) reload();
      }
      return outcome;
    },
    [perform, editing, reference, move, reload]
  );
  const terrain = useCallback(
    async (edit: TerrainEdit): Promise<TerrainOutcome | undefined> => {
      const outcome = await guard(() => editing.terrain(reference, edit));
      if (outcome) {
        move(recordAction(held.current, "t"));
        setRange({ undo: outcome.canUndo, redo: outcome.canRedo });
        reload();
      }
      return outcome;
    },
    [guard, editing, reference, move, reload]
  );
  const step = useCallback(
    async (direction: "undo" | "redo") => {
      const kind = direction === "undo" ? nextUndo(held.current) : nextRedo(held.current);
      const done = await runStep({ kind, direction, editing, reference, perform, guard });
      if (!done) return;
      if (kind) move((direction === "undo" ? afterUndo : afterRedo)(held.current));
      if ("canUndo" in done) setRange({ undo: done.canUndo, redo: done.canRedo });
      reload();
    },
    [perform, guard, editing, reference, move, reload]
  );
  return {
    run,
    terrain,
    stamp,
    undo: useCallback(() => step("undo"), [step]),
    redo: useCallback(() => step("redo"), [step]),
    canUndo: !!undoKind || terrainRange.undo,
    canRedo: !!redoKind || terrainRange.redo,
    /** The action the next Undo reaches, for the button's tooltip. */
    undoKind,
    redoKind,
  };
}
