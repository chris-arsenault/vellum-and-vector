import { expect, it } from "vitest";
import {
  evaporatedShare,
  flowYields,
  partitionSurplus,
  seasonWarmth,
  waterSurplus,
} from "./waterBalance";

it("splits a year into a warm and a cold half around its mean", () => {
  const { warm, cold } = seasonWarmth(10, 15);
  expect(warm).toBeGreaterThan(10);
  expect((warm + cold) / 2).toBeCloseTo(10, 9);
  expect(seasonWarmth(10, 0)).toEqual({ warm: 10, cold: 10 });
});

it("evaporates nearly all of a little water under a great demand, and little of much water under a small one", () => {
  expect(evaporatedShare(0, 500)).toBe(0);
  expect(evaporatedShare(1500, 0)).toBe(0);
  // A desert: demand ten times the rain.
  expect(evaporatedShare(2000, 200)).toBeGreaterThan(0.97);
  // A cool wet coast: demand a quarter of the rain.
  expect(evaporatedShare(400, 1600)).toBeLessThan(0.3);
  // More demand on the same water never evaporates less.
  expect(evaporatedShare(900, 600)).toBeGreaterThan(evaporatedShare(600, 600));
  expect(evaporatedShare(1e9, 1)).toBeLessThanOrEqual(1);
});

it("accounts for every drop: surplus, evaporation and kept snow make up what fell", () => {
  const year = { rain: 800, snow: 300, warmDemand: 900, coldDemand: 200, meltCapacity: 250 },
    left = waterSurplus(year);
  expect(left.warm + left.cold + left.evaporated + left.keptSnow).toBeCloseTo(1100, 9);
  expect(left.keptSnow).toBe(50);
});

it("leaves a dry hot cell almost no surplus and a wet cool one most of its rain", () => {
  const desert = waterSurplus({
      rain: 150,
      snow: 0,
      warmDemand: 2200,
      coldDemand: 1200,
      meltCapacity: 0,
    }),
    coast = waterSurplus({
      rain: 1800,
      snow: 0,
      warmDemand: 600,
      coldDemand: 250,
      meltCapacity: 0,
    });
  expect((desert.warm + desert.cold) / 150).toBeLessThan(0.03);
  expect((coast.warm + coast.cold) / 1800).toBeGreaterThan(0.7);
});

it("releases a winter's snow as the warm season's water", () => {
  const snowy = waterSurplus({
      rain: 200,
      snow: 600,
      warmDemand: 400,
      coldDemand: 50,
      meltCapacity: 5000,
    }),
    rainy = waterSurplus({ rain: 800, snow: 0, warmDemand: 400, coldDemand: 50, meltCapacity: 0 });
  expect(snowy.keptSnow).toBe(0);
  // The same year's water, but the snowy cell's comes in a flood when it thaws.
  expect(snowy.warm).toBeGreaterThan(rainy.warm);
  expect(snowy.cold).toBeLessThan(rainy.cold);
});

it("moves surplus from the surface into the ground as the ground takes more, and loses none", () => {
  const tight = partitionSurplus(400, 0.1),
    open = partitionSurplus(400, 0.8);
  expect(tight.quick + tight.recharge).toBe(400);
  expect(open.quick + open.recharge).toBe(400);
  expect(open.recharge).toBeGreaterThan(tight.recharge);
  expect(partitionSurplus(-5, 0.5)).toEqual({ quick: 0, recharge: 0 });
});

it("orders a cell's year-round flow, mean flow and flood", () => {
  const yields = flowYields(300, 40, 100);
  expect(yields.perennial).toBe(180);
  expect(yields.mean).toBe(440);
  expect(yields.flood).toBe(700);
  expect(yields.perennial).toBeLessThanOrEqual(yields.mean);
  expect(yields.mean).toBeLessThanOrEqual(yields.flood);
  // Ground that takes all its water gives a steady river with no flood.
  expect(flowYields(0, 0, 250)).toEqual({ perennial: 250, mean: 250, flood: 250 });
  // A cell whose water all runs off in one season has no river the rest of the year.
  expect(flowYields(500, 0, 0).perennial).toBe(0);
});
