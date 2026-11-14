import { expect, it } from "vitest";
import { interactionKey } from "./interactionLifetime";

it("keeps region tool interactions across unrelated world revisions", () => {
  expect(interactionKey("regionOutline", null, "primary", 3)).toBe(
    interactionKey("regionOutline", null, "primary", 4)
  );
  expect(interactionKey("regionCut", "r1", "primary", 3)).not.toBe(
    interactionKey("regionCut", "r2", "primary", 3)
  );
  expect(interactionKey("regionPick", null, "primary", 1)).not.toBe(
    interactionKey("regionOutline", null, "primary", 1)
  );
});

it("still reinstalls editing tools when the world revision changes", () => {
  expect(interactionKey("reshape", "f", "primary", 3)).not.toBe(
    interactionKey("reshape", "f", "primary", 4)
  );
});

it("reinstalls region sketches when navigation changes the active map", () => {
  expect(interactionKey("regionOutline", null, "primary", 3, "parent")).not.toBe(
    interactionKey("regionOutline", null, "primary", 3, "child")
  );
});
