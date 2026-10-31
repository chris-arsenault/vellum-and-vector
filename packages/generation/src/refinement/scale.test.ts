import { expect, it } from "vitest";
import { putChannel, rectangle } from "@atlas/domain";
import { regionalFixture } from "./refinementFixture";
import { createRefinementState, refinementResolution } from "./inputs";

it("samples fractional magic coverage beside its material amounts without altering captured inputs", () => {
  const { source, input, grid } = regionalFixture();
  const coverage = "magic:fire:coverage:vein",
    stock = "magic:fire:stock:vein/held";
  putChannel(
    grid,
    coverage,
    "ratio",
    grid.coverage.scratch("float64", coverage, grid.active.length).fill(0.08)
  );
  putChannel(
    grid,
    stock,
    "intensity-square-metre",
    grid.coverage.scratch("float64", stock, grid.active.length).fill(100_000_000),
    "extensive"
  );
  source.world.fields[0].channels!.push(coverage, stock);
  const { surface } = createRefinementState(source, input);
  expect(surface.channels[coverage]).toBeDefined();
  for (const value of surface.channels[coverage]) expect(value).toBeCloseTo(0.08, 12);
  expect(surface.channels[stock].get(0) / surface.measures.get(0)).toBeCloseTo(
    100_000_000 / grid.measures.get(0),
    8
  );
  expect(grid.channels[coverage].get(0)).toBe(0.08);
  expect(grid.channels[stock].get(0)).toBe(100_000_000);
});

it("calibrates the first Standard region from 35 percent of the default world divided twelve ways", () => {
  const { source, input } = regionalFixture();
  const regionArea = (4_000_000 * 3_000_000 * 0.35) / 12;
  expect(refinementResolution(source, input).cellArea).toBeCloseTo(regionArea / 60_000, 6);
});

it("uses the captured refinement level without consulting a live parent scale", () => {
  const { source, input } = regionalFixture();
  source.world.areas.area.map = { ...source.world.areas.area.map!, refinementLevel: 2 };
  const expected = (4_000_000 * 3_000_000 * 0.35) / 12 / 60_000 / 12;
  expect(refinementResolution(source, input).cellArea).toBeCloseTo(expected, 6);
  delete source.world.areas.parent;
  expect(refinementResolution(source, input).cellArea).toBeCloseTo(expected, 6);
});

it("keeps ordinary same-level physical spacing fixed when the chosen extent changes", () => {
  const { source, input } = regionalFixture();
  source.world.reference.domain = rectangle([0, 0, 1_000_000, 1_000_000]);
  source.world.areas.area.footprint = rectangle([0, 0, 100_000, 100_000]);
  const first = refinementResolution(source, input);
  source.world.areas.area.footprint = rectangle([0, 0, 300_000, 300_000]);
  expect(refinementResolution(source, input).cellSpan).toBe(first.cellSpan);
  expect(first.cellSpan).toBeCloseTo(2415.22946, 4);
});
