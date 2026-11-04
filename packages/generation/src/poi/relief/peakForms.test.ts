import { expect, it } from "vitest";
import { peakForm, peakShape, type PeakForm, type PeakReadings } from "./peakForms";

const ground: PeakReadings = {
  hardness: 0,
  fracture: 0,
  ice: 0,
  cold: 0,
  wet: 0,
  steep: 0,
  bedded: 0,
};
const tally = (readings: PeakReadings) => {
  const counts: Partial<Record<PeakForm, number>> = {};
  for (let i = 0; i < 1000; i++) {
    const form = peakForm(readings, i / 1000);
    counts[form] = (counts[form] ?? 0) + 1;
  }
  return counts;
};
const most = (counts: Partial<Record<PeakForm, number>>) =>
  Object.entries(counts).sort((a, b) => b[1] - a[1])[0][0];

it("lets rock and ice weigh the form", () => {
  expect(most(tally({ ...ground, hardness: 1, fracture: 1 }))).toBe("crag");
  expect(most(tally({ ...ground, hardness: 1, ice: 1 }))).toBe("horn");
  expect(most(tally({ ...ground, fracture: 1 }))).toBe("shattered");
  expect(most(tally({ ...ground, hardness: 0.5, bedded: 1 }))).toBe("table");
  expect(most(tally({ ...ground, hardness: 0.8, fracture: 0.1 }))).toBe("dome");
  expect(most(tally({ ...ground, steep: 1, cold: 1, wet: 1, hardness: 0.3 }))).toBe("scarred");
});

it("leaves every form possible on any ground", () => {
  expect(Object.keys(tally({ ...ground, hardness: 1, ice: 1 }))).toHaveLength(6);
});

it("never lowers a peak's own top", () => {
  for (const form of ["horn", "crag", "scarred", "dome", "shattered", "table"] as const)
    expect(peakShape(form, { reach: 0, bearing: 0, face: 0 }).ground).toBeGreaterThanOrEqual(0);
});

it("cuts one side of an avalanche-scarred peak and heaps the debris below it", () => {
  const at = (bearing: number, reach: number) => peakShape("scarred", { reach, bearing, face: 0 });
  expect(at(0, 0.4).ground).toBeLessThan(0);
  expect(at(Math.PI, 0.4).ground).toBeGreaterThan(0);
  expect(at(0, 0.8).debris).toBeGreaterThan(0);
  expect(at(Math.PI, 0.8).debris).toBe(0);
});

it("stands a crag proud of the ground around it", () => {
  const at = (reach: number) => peakShape("crag", { reach, bearing: 0, face: 0 }).ground;
  expect(at(0.1)).toBe(1);
  expect(at(0.5)).toBe(0);
});

it("does nothing beyond a peak's reach", () => {
  expect(peakShape("dome", { reach: 1, bearing: 0, face: 0 })).toEqual({
    ground: 0,
    debris: 0,
    bare: false,
  });
});
