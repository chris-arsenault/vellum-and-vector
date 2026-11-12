import { expect, it } from "vitest";
import {
  evaporatedShare,
  flowThroughYear,
  monthlyWarmth,
  months,
  waterYear,
  type WaterGround,
} from "./waterBalance";

const even = (value: number) => Array.from({ length: months }, () => value / months);
const sum = (values: readonly number[]) => values.reduce((total, value) => total + value, 0);
const ground = (over: Partial<WaterGround>): WaterGround => ({
  rain: even(800),
  snow: even(0),
  demand: even(600),
  melt: even(0),
  soilCapacity: 150,
  sinking: 0.3,
  stormShare: 0,
  ...over,
});

it("swings a year's warmth about its mean, coldest first", () => {
  const year = monthlyWarmth(10, 12);
  expect(year).toHaveLength(months);
  expect(year[0]).toBeCloseTo(-2, 9);
  expect(year[6]).toBeCloseTo(22, 9);
  expect(sum(year) / months).toBeCloseTo(10, 9);
  expect(monthlyWarmth(10, 0).every((value) => value === 10)).toBe(true);
});

it("accounts for every drop: runoff, recharge, evaporation and kept snow make up what fell", () => {
  const year = waterYear(
    ground({ rain: even(700), snow: even(300), melt: even(200), demand: even(500) })
  );
  expect(sum(year.quick) + year.recharge + year.evaporated + year.keptSnow).toBeCloseTo(1000, 6);
});

it("sheds almost nothing where the air wants far more than falls, and most of the rain where it wants little", () => {
  const desert = waterYear(ground({ rain: even(150), demand: even(2200) })),
    coast = waterYear(ground({ rain: even(1800), demand: even(500) }));
  expect(sum(desert.quick) + desert.recharge).toBe(0);
  expect((sum(coast.quick) + coast.recharge) / 1800).toBeGreaterThan(0.7);
});

it("stays near the long-run evaporation curve for its climate", () => {
  // A year whose rain and demand are out of step, so the soil carries water between seasons.
  const warmth = monthlyWarmth(12, 10),
    demand = warmth.map((degrees) => Math.max(0, degrees) * 8),
    rain = warmth.map((degrees) => 90 - 3 * (degrees - 12)),
    year = waterYear(ground({ rain, demand, soilCapacity: 150 })),
    evaporated = year.evaporated / sum(rain);
  expect(Math.abs(evaporated - evaporatedShare(sum(demand), sum(rain)))).toBeLessThan(0.15);
});

it("cuts washes in dry country: a share of each rain runs off before the soil can take it", () => {
  const desert = waterYear(ground({ rain: even(150), demand: even(2200), stormShare: 0.05 }));
  expect(sum(desert.quick)).toBeCloseTo(7.5, 6);
  expect(desert.recharge).toBe(0);
});

it("holds a winter's snow and releases it as the thaw's flood", () => {
  const warmth = monthlyWarmth(4, 12),
    cold = warmth.map((degrees) => degrees <= 0),
    year = waterYear(
      ground({
        rain: cold.map((frozen) => (frozen ? 0 : 60)),
        snow: cold.map((frozen) => (frozen ? 60 : 0)),
        melt: warmth.map((degrees) => Math.max(0, degrees) * 60),
        demand: warmth.map((degrees) => Math.max(0, degrees) * 4),
        soilCapacity: 100,
      })
    ),
    thaw = year.quick.indexOf(Math.max(...year.quick));
  expect(year.keptSnow).toBe(0);
  // Nothing runs while it is frozen, and the greatest month comes as the cold ends.
  expect(year.quick[0]).toBe(0);
  expect(cold[thaw]).toBe(false);
  expect(cold[thaw - 1]).toBe(true);
});

it("keeps as ice the snow no summer melts", () => {
  const year = waterYear(ground({ rain: even(0), snow: even(900), melt: even(300) }));
  expect(year.keptSnow).toBeCloseTo(600, 6);
});

it("turns flashy runoff into steady groundwater as the ground takes more", () => {
  const tight = waterYear(ground({ sinking: 0.1 })),
    open = waterYear(ground({ sinking: 0.8 }));
  expect(sum(tight.quick) + tight.recharge).toBeCloseTo(sum(open.quick) + open.recharge, 6);
  expect(open.recharge).toBeGreaterThan(tight.recharge);
});

it("reads a river's year from its months: least, greatest, mean and months in flow", () => {
  const snowmelt = [2, 2, 3, 40, 120, 90, 30, 10, 5, 4, 3, 2],
    year = flowThroughYear(snowmelt, 20);
  expect(year.perennial).toBe(2);
  expect(year.flood).toBe(120);
  expect(year.mean).toBeCloseTo(sum(snowmelt) / 12, 9);
  expect(year.flowing).toBe(4);
  expect(flowThroughYear(even(600), 20).flowing).toBe(12);
  expect(flowThroughYear([], 20)).toEqual({ perennial: 0, flood: 0, mean: 0, flowing: 0 });
});
