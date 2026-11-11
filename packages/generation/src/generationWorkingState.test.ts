import { expect, it } from "vitest";
import { putChannel, requireChannel } from "@atlas/domain";
import { landscape } from "./mapFixtures";
import { numericalProcessLifetime, withNumericalLifetime } from "./generationWorkingState";

it("releases replaced channels between feedback cycles inside an unfinished process", () => {
  const state = landscape(),
    grid = state.surface,
    baseline = grid.coverage.cache.bytes,
    finishProcess = numericalProcessLifetime(state);
  for (let cycle = 0; cycle < 20; cycle++) {
    const previous = requireChannel(grid, "Elevation");
    withNumericalLifetime(state, () => {
      const next = grid.coverage.scratch("float64", "projection", grid.active.length).fill(cycle);
      putChannel(grid, "Elevation", "native-length", next);
    });
    expect(previous.released).toBe(true);
    expect(requireChannel(grid, "Elevation").get(0)).toBe(cycle);
    expect(grid.coverage.cache.bytes).toBe(baseline);
  }
  finishProcess();
  expect(requireChannel(grid, "Elevation").released).toBe(false);
});

it("keeps a replaced channel while another grid still owns it", () => {
  const state = landscape(),
    grid = state.surface,
    previous = requireChannel(grid, "Elevation");
  state.domain.numerical.captured = { ...grid, channels: { ...grid.channels } };
  withNumericalLifetime(state, () => {
    putChannel(
      grid,
      "Elevation",
      "native-length",
      grid.coverage.scratch("float64", "replacement", grid.active.length).fill(50)
    );
  });
  expect(previous.released).toBe(false);
  expect(requireChannel(state.domain.numerical.captured, "Elevation").get(0)).toBe(-10 * 1024);
  withNumericalLifetime(state, () => {
    delete state.domain.numerical.captured;
  });
  expect(previous.released).toBe(true);
  expect(requireChannel(grid, "Elevation").get(0)).toBe(50);
});

it("cleans failed cycles without releasing outer scratch or private retained owner bands", () => {
  const state = landscape(),
    coverage = state.surface.coverage,
    outer = coverage.scratch("float64", "outer").fill(3),
    owner = coverage.scratch("float64", "private-owner").fill(7);
  owner.retain();
  let scratch = outer;
  expect(() =>
    withNumericalLifetime(state, () => {
      scratch = coverage.scratch("float64", "cycle").fill(4);
      throw new Error("interrupted cycle");
    })
  ).toThrow("interrupted cycle");
  expect(scratch.released).toBe(true);
  expect(outer.get(0)).toBe(3);
  expect(owner.get(0)).toBe(7);
  coverage.release(outer);
  coverage.release(owner);
});
