import { expect, it } from "vitest";
import { putChannel } from "@atlas/domain";
import { landscape } from "./mapFixtures";
import { numericalProcessLifetime, withNumericalLifetime } from "./generationWorkingState";

it("releases replaced channels between feedback cycles inside an unfinished process", () => {
  const state = landscape(),
    grid = state.surface,
    baseline = grid.coverage.cache.bytes,
    finishProcess = numericalProcessLifetime(state);
  for (let cycle = 0; cycle < 20; cycle++) {
    const previous = grid.channels.elevation;
    withNumericalLifetime(state, () => {
      const next = grid.coverage.scratch("float64", "projection", grid.active.length).fill(cycle);
      putChannel(grid, "elevation", "metre", next);
    });
    expect(previous.released).toBe(true);
    expect(grid.channels.elevation.get(0)).toBe(cycle);
    expect(grid.coverage.cache.bytes).toBe(baseline);
  }
  finishProcess();
  expect(grid.channels.elevation.released).toBe(false);
});

it("keeps a replaced channel while another grid still owns it", () => {
  const state = landscape(),
    grid = state.surface,
    previous = grid.channels.elevation;
  state.domain.numerical.captured = { ...grid, channels: { ...grid.channels } };
  withNumericalLifetime(state, () => {
    putChannel(
      grid,
      "elevation",
      "metre",
      grid.coverage.scratch("float64", "replacement", grid.active.length).fill(50)
    );
  });
  expect(previous.released).toBe(false);
  expect(state.domain.numerical.captured.channels.elevation.get(0)).toBe(-10);
  withNumericalLifetime(state, () => {
    delete state.domain.numerical.captured;
  });
  expect(previous.released).toBe(true);
  expect(grid.channels.elevation.get(0)).toBe(50);
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

it("releases a finished round's final workspace while preserving shared surface data", () => {
  const state = landscape(),
    grid = state.surface,
    finishProcess = numericalProcessLifetime(state),
    owner = grid.coverage.scratch("int32", "society-owner").fill(0),
    river = grid.coverage.scratch("float64", "society-river").fill(2),
    coast = grid.coverage.scratch("float64", "society-coast").fill(3);
  for (const band of [owner, river, coast]) band.retain();
  state.society = {
    owner,
    river,
    coast,
    inherited: false,
    changed: new Set(),
    mediumChanged: new Set(),
    region: {
      areaId: "area",
      spaceId: "surface",
      communities: [],
      connections: [],
      history: [],
      works: [],
      events: [],
      magic: [],
    },
  };
  putChannel(grid, "sharedRiver", "ratio", river);
  withNumericalLifetime(state, () => {
    delete state.society;
  });
  finishProcess();
  expect(owner.released).toBe(true);
  expect(coast.released).toBe(true);
  expect(river.get(0)).toBe(2);
});
