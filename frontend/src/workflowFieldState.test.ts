import { expect, it } from "vitest";
import {
  removeWorkflowIndex,
  validateWorkflowCodes,
  validateWorkflowNumber,
} from "./workflowFieldState";

it("keeps empty and incomplete required edits invalid without coercing them to zero", () => {
  for (const text of ["", " ", "-", ".", "1e", "Infinity", "NaN"])
    expect(validateWorkflowNumber(text, {})).toHaveProperty("error");
  expect(validateWorkflowNumber("0", {})).toEqual({ value: 0 });
  expect(validateWorkflowNumber("-0.6", {})).toEqual({ value: -0.6 });
});

it("enforces declared bounds and increment origins without floating point step artifacts", () => {
  expect(validateWorkflowNumber("-1", { min: 0 })).toHaveProperty("error");
  expect(validateWorkflowNumber("2", { max: 1 })).toHaveProperty("error");
  expect(validateWorkflowNumber("1.5", { step: 1 })).toHaveProperty("error");
  expect(validateWorkflowNumber("0.3", { step: 0.1 })).toEqual({ value: 0.3 });
  expect(validateWorkflowNumber("0.25", { min: 0.05, step: 0.1 })).toEqual({ value: 0.25 });
  expect(validateWorkflowNumber("0.25", { step: "any" })).toEqual({ value: 0.25 });
});

it("represents a blank optional condition as absence while preserving zero as a real bound", () => {
  expect(validateWorkflowNumber("", { optional: true })).toEqual({ value: undefined });
  expect(validateWorkflowNumber("0", { optional: true })).toEqual({ value: 0 });
  expect(validateWorkflowNumber("-", { optional: true })).toHaveProperty("error");
});

it("retains malformed numeric lists instead of turning empty codes into zero", () => {
  for (const raw of ["1,", "1,,2", "bad", "1,Infinity"])
    expect(validateWorkflowCodes(raw)).toHaveProperty("error");
  expect(validateWorkflowCodes("0, 2, -3.5")).toEqual({ values: [0, 2, -3.5] });
  expect(validateWorkflowCodes("")).toEqual({ values: undefined });
});

it("removes only deleted conditions and rekeys retained invalid text without touching other fields", () => {
  const entry = { raw: "-", committedValue: 2, error: "Enter a number." };
  const entries = {
    "magic.fire.rules.a.seeds.0.0.min": entry,
    "magic.fire.rules.a.seeds.0.1.min": { ...entry, raw: "1e" },
    "magic.aurora.strength": entry,
  };
  expect(removeWorkflowIndex(entries, "magic.fire.rules.a.seeds.0", 0)).toEqual({
    "magic.fire.rules.a.seeds.0.0.min": { ...entry, raw: "1e" },
    "magic.aurora.strength": entry,
  });
});
