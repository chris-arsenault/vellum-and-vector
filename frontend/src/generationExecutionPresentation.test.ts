import { expect, it } from "vitest";
import {
  executionGroups,
  executionStatus,
  executionTiming,
} from "./generationExecutionPresentation";
import type { SetupInvocation } from "@atlas/generation";

function invocation(key: string, epochs: SetupInvocation["epochs"] = []): SetupInvocation {
  return {
    key,
    id: "pass",
    path: ["pass"],
    process: "test.pass",
    version: "1",
    feature: null,
    epochs,
    behavior: "model-pass",
    durationYears: null,
    boundDurationYears: null,
    durationNote: null,
    parameters: {},
    inputs: [],
    outputs: [],
    invalidates: [],
    conditional: false,
    reconciliation: false,
    scheduled: true,
  };
}
it("retains causal order, shared operations and repeated passes while eliminating duplicate occurrence keys", () => {
  const first = invocation("shared-initial"),
    age = [{ id: "Formation", duration: 1000 }];
  const groups = executionGroups([
    first,
    first,
    invocation("pass-a", age),
    invocation("pass-b", age),
    invocation("shared-final"),
  ]);
  expect(groups.map((group) => group.label)).toEqual([
    "Initial formation",
    "Formation · 1,000 years epoch",
    "Present geography and publication",
  ]);
  expect(
    groups.flatMap((group) => group.occurrences.map((item) => [item.invocation.key, item.position]))
  ).toEqual([
    ["shared-initial", 1],
    ["pass-a", 2],
    ["pass-b", 3],
    ["shared-final", 4],
  ]);
});
it("distinguishes effective elapsed time, repeated model passes and conditional repairs", () => {
  const entry = invocation("ecology");
  expect(executionTiming(entry)).toBe("Per pass");
  entry.behavior = "elapsed";
  entry.durationYears = 500;
  expect(executionTiming(entry)).toBe("500 years");
  entry.durationYears = 0;
  entry.boundDurationYears = 500;
  expect(executionTiming(entry)).toBe("0 years");
  entry.reconciliation = entry.conditional = true;
  expect(executionStatus(entry)).toBe("Conditional repair");
  entry.scheduled = false;
  expect(executionStatus(entry)).toBe("Skipped by condition");
});
it("does not invent a physical epoch when a request has none", () => {
  expect(executionGroups([invocation("initial"), invocation("final")])[0].label).toBe(
    "Generation and publication"
  );
});
