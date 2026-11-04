import { expect, it } from "vitest";
import { fallForm, fallShapes, type FallReadings } from "./waterfallForms";

const readings = (over: Partial<FallReadings>): FallReadings => ({
  hardness: 0,
  fracture: 0,
  tall: 0,
  broad: 0,
  ...over,
});
const shareOf = (r: FallReadings, form: string) => {
  let count = 0;
  for (let i = 0; i < 1000; i++) if (fallForm(r, i / 1000) === form) count++;
  return count / 1000;
};

it("makes a great river over hard rock mostly a cataract", () => {
  expect(shareOf(readings({ hardness: 1, broad: 1 }), "cataract")).toBeGreaterThan(0.7);
});

it("makes broken rock mostly a cascade, and a tall thin fall mostly a ribbon", () => {
  expect(shareOf(readings({ fracture: 1 }), "cascade")).toBeGreaterThan(0.7);
  expect(shareOf(readings({ tall: 1 }), "ribbon")).toBeGreaterThan(0.5);
});

it("leaves every form some chance on any ground", () => {
  for (const form of Object.keys(fallShapes))
    expect(shareOf(readings({ hardness: 1, broad: 1 }), form)).toBeGreaterThan(0);
});

it("never stands a bank above the lip, and lowers banks going downstream", () => {
  for (const { banks } of Object.values(fallShapes))
    banks.forEach((bank, k) => {
      expect(bank).toBeLessThanOrEqual(1);
      if (k > 1) expect(bank).toBeLessThanOrEqual(banks[k - 1]);
    });
});
