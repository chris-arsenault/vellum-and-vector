import { afterEach, expect, it, vi } from "vitest";
import { applyNativeStep, observeNativeSteps } from "./physicalSteps";
import type { NativeStep } from "./sequence";
import type { PhysicalField } from "./field";
import type { PhysicalContext } from "./context";

vi.mock("./layerValidation", async (original) => ({
  ...(await original<typeof import("./layerValidation")>()),
  validateNativeLayer: vi.fn(),
}));
afterEach(() => observeNativeSteps(null));

// Observer contracts use inert callbacks; no physical process or fixture world runs.
const map = {} as PhysicalField;
const context = { EpochIndex: 0 } as PhysicalContext;
const step = (name: string, run = () => {}): NativeStep => [name, 0, run, []];

it("distinguishes embedded completions from their outer operation", () => {
  const seen: { name: string; depth: number }[] = [];
  observeNativeSteps((name, _map, _context, { depth }) => seen.push({ name, depth }));
  applyNativeStep(
    map,
    context,
    step("outer", () => applyNativeStep(map, context, step("inner")))
  );
  expect(seen).toEqual([
    { name: "inner", depth: 1 },
    { name: "outer", depth: 0 },
  ]);
});

it("clears nesting after an operation fails", () => {
  const seen: number[] = [];
  observeNativeSteps((_name, _map, _context, { depth }) => seen.push(depth));
  expect(() =>
    applyNativeStep(
      map,
      context,
      step("failure", () => {
        throw new Error("supplied failure");
      })
    )
  ).toThrow("supplied failure");
  applyNativeStep(map, context, step("next"));
  expect(seen).toEqual([0]);
});
