import { expect, it, vi } from "vitest";

// World-depth runs on a supplied country: longer than the suite's default per-test budget.
vi.setConfig({ testTimeout: 120_000 });
import { regionalFixture, runSchedule } from "./fixture";
import { isContent, positionOf } from "./lattice";
import type { RegionalState } from "./state";

/**
 * M1 shared media (plan: "Shared media and repairs"). Each check asserts an observable of the
 * developed country that only the medium explains: the sun side of a ridge is warmer, a
 * hollow is colder than its rim, strained weak rock is more fractured, a valley floor is
 * wetter than the ridge above it, and new high ground takes its precipitation as snow.
 */

const content = (state: RegionalState) => {
  const mesh = state.physical.map.mesh,
    cells: number[] = [];
  for (let i = 0; i < mesh.count; i++) if (isContent(mesh, i)) cells.push(i);
  return cells;
};
const mean = (values: number[]) => values.reduce((a, b) => a + b, 0) / Math.max(1, values.length);
/** Mean of a cell reading over the content cells a position predicate selects. */
function meanWhere(
  state: RegionalState,
  select: (x: number, y: number) => boolean,
  read: (i: number) => number
) {
  const mesh = state.physical.map.mesh;
  return mean(
    content(state)
      .filter((i) => {
        const p = positionOf(mesh, i);
        return select(p.x, p.y);
      })
      .map(read)
  );
}
const celsius = (state: RegionalState) => (i: number) =>
  state.physical.map.Temperature.get(i) / 10 - 30;

it("aspect: the equatorward flank of a ridge is warmer than the poleward flank", () => {
  // An east–west ridge in the northern hemisphere (the fixture's frame spans 10°–70° N).
  const { state } = regionalFixture(
    (_x, y) => 300 + 700 * Math.exp(-(((y - 20000) / 4000) ** 2)),
    40000,
    2
  );
  runSchedule(state, ["physical"]);
  const south = meanWhere(state, (_x, y) => y > 14000 && y < 19000, celsius(state)),
    north = meanWhere(state, (_x, y) => y > 21000 && y < 26000, celsius(state));
  expect(south).toBeGreaterThan(north + 0.3);
});

it("cold pooling: the floor of a closed hollow is colder than its rim", () => {
  const { state } = regionalFixture(
    (x, y) => 500 - 100 * Math.exp(-((Math.hypot(x - 20000, y - 20000) / 3000) ** 2)),
    40000,
    2
  );
  runSchedule(state, ["physical"]);
  const floor = meanWhere(state, (x, y) => Math.hypot(x - 20000, y - 20000) < 1200, celsius(state)),
    rim = meanWhere(
      state,
      (x, y) => Math.abs(Math.hypot(x - 20000, y - 20000) - 7000) < 800,
      celsius(state)
    );
  expect(floor).toBeLessThan(rim - 0.5);
});

it("fracture set: strained country is more fractured than unstrained country", () => {
  const conductance = [0, 0.9].map((strain) => {
    const { state } = regionalFixture((x, y) => 400 + x / 300 + y / 700, 40000, 2, {
      tectonicStrain: ["ratio", () => strain],
      structuralGrainX: ["ratio", () => 1],
      structuralGrainY: ["ratio", () => 0],
    });
    runSchedule(state, ["physical"]);
    return mean(content(state).map((i) => state.physical.map.FractureConductance.get(i)));
  });
  expect(conductance[1]).toBeGreaterThan(conductance[0] + 50);
});

it("wetness: a valley floor develops wetland cover the slopes above it do not", () => {
  // No captured wetland: what develops is the medium's doing.
  const { state } = regionalFixture((_x, y) => 200 + Math.abs(y - 20000) / 40, 40000, 2, {
    wetlandCover: ["ratio", () => 0],
  });
  runSchedule(state, ["physical"]);
  const wetland = (i: number) => state.physical.map.WetlandCover.get(i),
    floor = meanWhere(state, (_x, y) => Math.abs(y - 20000) < 1500, wetland),
    slopes = meanWhere(state, (_x, y) => Math.abs(y - 20000) > 12000, wetland);
  expect(floor).toBeGreaterThan(slopes + 0.1);
  // The slopes stay mostly dry; developed local flats on them may hold a little.
  expect(slopes).toBeLessThan(0.25);
});

it("snow: the poleward flank of a ridge takes a larger share of its precipitation as snow", () => {
  // The milestone's acceptance: the two sides of one relief differ in temperature and snow.
  const { state } = regionalFixture(
    (_x, y) => 300 + 700 * Math.exp(-(((y - 20000) / 4000) ** 2)),
    40000,
    2,
    { temperature: ["celsius", () => 3] }
  );
  runSchedule(state, ["physical"]);
  const map = state.physical.map,
    share = (i: number) =>
      map.Snowfall.get(i) / Math.max(1, map.Snowfall.get(i) + map.Rainfall.get(i)),
    south = meanWhere(state, (_x, y) => y > 14000 && y < 19000, share),
    north = meanWhere(state, (_x, y) => y > 21000 && y < 26000, share);
  expect(north).toBeGreaterThan(south + 0.02);
  expect(south).toBeGreaterThan(0);
});
