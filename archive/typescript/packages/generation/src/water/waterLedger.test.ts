import { expect, it } from "vitest";
import type { PhysicalField } from "../world/field";
import { airDemand, dayLength, evaporated } from "./waterBalance";
import { moveDepth, moveFlow, moveWater, waterAccount } from "./waterLedger";

const map = () => ({}) as PhysicalField;

it("enters each move between its two stores and nets what every store gained and lost", () => {
  const land = map();
  moveWater(land, "rain", 100);
  moveWater(land, "evaporation", 60);
  moveWater(land, "runoff", 30);
  moveWater(land, "recharge", 10);
  moveWater(land, "mouth", 30);
  const { moves, net } = waterAccount(land);
  expect(moves[0]).toEqual({ cause: "rain", from: "air", to: "soil", volume: 100 });
  // The soil passed on all it was given; the air lost what fell less what it took back.
  expect(net.soil).toBe(0);
  expect(net.air).toBe(-40);
  expect(net.river).toBe(0);
  expect(net.sea).toBe(30);
  expect(net.ground).toBe(10);
  // Water is only moved: the stores' gains and losses cancel.
  expect(Object.values(net).reduce((total, value) => total + value, 0)).toBe(0);
});

it("takes depths and flows as a year's volume, and a move stated again replaces the last", () => {
  const land = map();
  moveDepth(land, "rain", 500, 1e6);
  moveFlow(land, "spill", 1);
  moveWater(land, "bedLoss", 0);
  moveWater(land, "bedLoss", -5);
  const { moves } = waterAccount(land);
  expect(moves.map((move) => move.cause).sort()).toEqual(["rain", "spill"]);
  expect(moves.find((move) => move.cause === "rain")!.volume).toBe(5e5);
  expect(moves.find((move) => move.cause === "spill")!.volume).toBeCloseTo(31_557_600, 0);
  // The ledger is the typical year as last worked out, not a sum over passes.
  moveDepth(land, "rain", 200, 1e6);
  moveFlow(land, "spill", 0);
  expect(waterAccount(land).moves).toEqual([
    { cause: "rain", from: "air", to: "soil", volume: 2e5 },
  ]);
});

it("asks more of the air the warmer the month, and nothing of a frozen one", () => {
  expect(airDemand(-5)).toBe(0);
  expect(airDemand(0)).toBe(0);
  // About 29, 64 and 100 mm a month at 5, 18 and 25 degrees.
  expect(airDemand(5)).toBeCloseTo(28.7, 0);
  expect(airDemand(18)).toBeCloseTo(64.2, 0);
  expect(airDemand(25)).toBeCloseTo(99.1, 0);
});

it("asks more of the air through long days and nothing through the polar night", () => {
  expect(dayLength(0, 23.5)).toBeCloseTo(1, 12);
  expect(dayLength(50, 0)).toBeCloseTo(1, 12);
  // About eighteen and a half hours at 60 degrees in midsummer, five and a half in midwinter.
  expect(dayLength(60, 23.5) * 12).toBeCloseTo(18.5, 0);
  expect(dayLength(-60, -23.5) * 12).toBeCloseTo(5.5, 0);
  expect(dayLength(80, 23.5)).toBe(2);
  expect(dayLength(80, -23.5)).toBe(0);
  expect(airDemand(18, 1.5)).toBeCloseTo(airDemand(18) * 2.25, 9);
});

it("draws a drying soil down towards empty, giving less for the same demand each time", () => {
  // Water that fell this month is taken first and in full.
  expect(evaporated(50, 80, 100, 150)).toBe(50);
  // What the month lacks comes from the soil, and never all of it at once.
  const first = evaporated(100, 0, 150, 150),
    second = evaporated(100, 0, 150 - first, 150);
  expect(first).toBeGreaterThan(0);
  expect(first).toBeLessThan(100);
  expect(second).toBeLessThan(first);
  expect(evaporated(1e6, 0, 150, 150)).toBeCloseTo(150, 6);
  expect(evaporated(100, 0, 0, 150)).toBe(0);
});
