import { expect, it } from "vitest";
import { floodWetness } from "./ecologyEnvironment";
import { livingFloodplainSupport } from "./floodplains";

it("combines overlapping floodplain and delta classifications without counting ground twice", () => {
  expect(floodWetness(600, 700)).toBe(0.7);
  expect(floodWetness(600, 0)).toBe(0.6);
  expect(floodWetness(0, 700)).toBe(0.7);
});

it("requires a current dry river reach for living floodplain support", () => {
  expect(livingFloodplainSupport(0.8, 2, 0)).toBe(480);
  expect(livingFloodplainSupport(0.8, 0, 0)).toBe(0);
  expect(livingFloodplainSupport(0.8, 2, 1)).toBe(0);
  expect(livingFloodplainSupport(0.8, 2, 2)).toBe(0);
  expect(livingFloodplainSupport(0, 2, 0)).toBe(0);
});
