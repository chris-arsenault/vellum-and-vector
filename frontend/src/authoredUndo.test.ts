import { describe, expect, it, vi } from "vitest";
import type { MapEditing } from "@atlas/map";
import {
  afterRedo,
  afterUndo,
  emptyStack,
  nextRedo,
  nextUndo,
  recordAction,
  runStep,
} from "./authoredUndo";
import { authoredMap } from "./testSupport/authoredMap";

describe("the action stack", () => {
  it("undoes and redoes in the order things were done, across both kinds", () => {
    let stack = recordAction(recordAction(recordAction(emptyStack, "f"), "t"), "t");
    expect(nextUndo(stack)).toBe("t");
    stack = afterUndo(stack);
    stack = afterUndo(stack);
    expect(nextUndo(stack)).toBe("f");
    expect(nextRedo(stack)).toBe("t");
    stack = afterRedo(stack);
    expect(stack.done).toEqual(["f", "t"]);
  });
  it("ends the redo line when something new is done", () => {
    const stack = recordAction(afterUndo(recordAction(emptyStack, "f")), "t");
    expect(stack).toEqual({ done: ["t"], undone: [] });
  });
  it("does nothing on an empty stack", () => {
    expect(afterUndo(emptyStack)).toBe(emptyStack);
    expect(afterRedo(emptyStack)).toBe(emptyStack);
    expect(nextUndo(emptyStack)).toBeUndefined();
  });
});
describe("undo routing", () => {
  const editing = {
    undo: vi.fn(async () => ({ feature: true })),
    redo: vi.fn(async () => ({ feature: true })),
    undoTerrain: vi.fn(async () => ({ terrain: true })),
    redoTerrain: vi.fn(async () => ({ terrain: true })),
  };
  const reference = authoredMap.reference;
  const run = (kind: "f" | "t" | undefined, direction: "undo" | "redo") =>
    runStep({
      kind,
      direction,
      editing: editing as unknown as MapEditing,
      reference,
      perform: (work) => work() as never,
      guard: (work) => work() as never,
    });
  it("sends a terrain action to the terrain history", async () => {
    await run("t", "undo");
    await run("t", "redo");
    expect(editing.undoTerrain).toHaveBeenCalledWith(reference);
    expect(editing.redoTerrain).toHaveBeenCalledWith(reference);
    expect(editing.undo).not.toHaveBeenCalled();
  });
  it("sends a feature action, or an unrecorded one, to the feature history", async () => {
    await run("f", "undo");
    await run(undefined, "redo");
    expect(editing.undo).toHaveBeenCalledWith(reference);
    expect(editing.redo).toHaveBeenCalledWith(reference);
  });
});
