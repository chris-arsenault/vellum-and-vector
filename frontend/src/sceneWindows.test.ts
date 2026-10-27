import { expect, it } from "vitest";
import { createWorldSnapshot } from "./worldCreation";
import { sceneWindows, displayTolerance } from "./sceneWindows";

it("reads both sides of the cylindrical seam once, including translated and whole-world views", () => {
  const { world } = createWorldSnapshot({
    name: "Cylinder",
    seed: 7,
    width: 1000,
    height: 500,
    boundaryMode: "cylinder",
  });
  expect(sceneWindows(world, [900, 10, 1100, 90])).toEqual([
    [900, 10, 1000, 90],
    [0, 10, 100, 90],
  ]);
  expect(sceneWindows(world, [-100, 10, 100, 90])).toEqual([
    [900, 10, 1000, 90],
    [0, 10, 100, 90],
  ]);
  expect(sceneWindows(world, [-100, 0, 1900, 500])).toEqual([[0, 0, 1000, 500]]);
  expect(sceneWindows(world, [2100, 20, 2200, 30])).toEqual([[100, 20, 200, 30]]);
  expect(displayTolerance(40)).toBe(16);
  expect(displayTolerance(0)).toBe(0);
});
