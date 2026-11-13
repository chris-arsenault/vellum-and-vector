import { expect, it } from "vitest";
import { MapScale } from "@atlas/domain";
import { gathered, riverSizes } from "./riverSize";

it("asks the same share of the map for a river whatever the size of its cells", () => {
  const frame: [number, number, number, number] = [0, 0, 4_000_000, 3_000_000],
    coarse = riverSizes(MapScale.fromBounds(frame, 28_000)),
    fine = riverSizes(MapScale.fromBounds(frame, 7_000));
  // More cells on the same country change nothing about what is a river there.
  expect(fine.discharge).toBeCloseTo(coarse.discharge, 9);
  expect(fine.catchment).toBeCloseTo(coarse.catchment, 3);
});

it("asks less of a river on a map of a smaller country", () => {
  const world = riverSizes(MapScale.fromBounds([0, 0, 4_000_000, 3_000_000], 28_000)),
    region = riverSizes(MapScale.fromBounds([0, 0, 1_000_000, 750_000], 7_000));
  expect(region.discharge).toBeLessThan(world.discharge);
  expect(region.catchment).toBeLessThan(world.catchment);
});

it("calls water a river's only when it was gathered from ground the map shows", () => {
  const sizes = { catchment: 1000 };
  // One very wet cell sheds a great deal and is still wet ground.
  expect(gathered(50, sizes, 50)).toBe(false);
  expect(gathered(1000, sizes, 50)).toBe(true);
  expect(gathered(100_000, sizes, 100_000)).toBe(false);
});
