import { expect, it } from "vitest";
import { enteringFlow } from "./inflow";

/** A year where the entered ground sheds little in six months and much in the other six. */
const shed = [2, 2, 2, 2, 2, 2, 10, 10, 10, 10, 10, 10],
  driest = Math.min(...shed),
  average = shed.reduce((total, month) => total + month, 0) / shed.length,
  year = (mean: number, least: number) =>
    shed.map((month) => enteringFlow(mean, least, month, driest, average));

it("brings in over the year what the other map said, lowest in the dry season", () => {
  const flows = year(60, 15),
    mean = flows.reduce((total, flow) => total + flow, 0) / flows.length;
  expect(mean).toBeCloseTo(60, 9);
  expect(Math.min(...flows)).toBeCloseTo(15, 9);
  expect(flows[6]).toBeGreaterThan(flows[0]);
});

it("runs evenly where the river has no dry season or the ground no seasons", () => {
  expect(year(60, 60)).toEqual(shed.map(() => 60));
  expect(enteringFlow(60, 15, 5, 5, 5)).toBe(60);
});

it("can run dry in its dry season and never brings less than nothing", () => {
  const flows = year(60, 0);
  expect(Math.min(...flows)).toBe(0);
  expect(year(60, -5).every((flow) => flow >= 0)).toBe(true);
});
