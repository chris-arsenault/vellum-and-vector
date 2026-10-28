import { expect, it } from "vitest";
import { createGrid, putChannel, rectangle, residentBand } from "@atlas/domain";
import { landscape } from "./mapFixtures";
import { chooseSettlementSites, rankSites } from "./societySites";
import type { MapProcessContext } from "./process";

/**
 * A 20 × 9 km country at 1 km cells: a mountain wall across the middle with one col in it,
 * a river running from the wall down to a bay on the east coast, open plain elsewhere.
 */
function country() {
  const state = landscape();
  state.domain.scope.footprint = rectangle([0, 0, 20000, 9000]);
  state.domain.world.areas.area.footprint = state.domain.scope.footprint;
  const grid = createGrid("sites", state.domain.scope, 21, 10),
    n = grid.active.length,
    cell = (x: number, y: number) => y * 21 + x;
  const elevation = new Float64Array(n).fill(100),
    water = new Float64Array(n),
    riverOrder = new Float64Array(n),
    flow = new Float64Array(n),
    slope = new Float64Array(n).fill(0.002),
    waterDepth = new Float64Array(n),
    waveExposure = new Float64Array(n);
  // The wall is column 10, 900 m high, with its col at row 4.
  for (let y = 0; y < 10; y++) elevation[cell(10, y)] = y === 4 ? 350 : 900;
  // The sea is the eastern strip; the bay is a sheltered notch at rows 3-5 of column 17.
  const sea = Array.from({ length: n }, (_, i) => i).filter(
    (i) => i % 21 >= 18 || (i % 21 === 17 && Math.floor(i / 21) >= 3 && Math.floor(i / 21) <= 5)
  );
  for (const i of sea) {
    water[i] = 1;
    elevation[i] = -20;
    waterDepth[i] = 25;
    waveExposure[i] = i % 21 === 17 ? 0.15 : 0.7;
  }
  // The river runs from the col east along row 4 into the bay.
  for (let x = 11; x <= 16; x++) {
    riverOrder[cell(x, 4)] = 2;
    flow[cell(x, 4)] = 50 * (x - 10);
  }
  // A tributary joins at column 14 from the north, making a junction there.
  riverOrder[cell(14, 3)] = 1;
  riverOrder[cell(14, 2)] = 1;
  putChannel(grid, "elevation", "metre", residentBand("float64", elevation));
  putChannel(grid, "water", "category", residentBand("float64", water));
  putChannel(grid, "riverOrder", "category", residentBand("float64", riverOrder));
  putChannel(grid, "flow", "cubic-metre/second", residentBand("float64", flow));
  putChannel(grid, "slope", "gradient", residentBand("float64", slope));
  putChannel(grid, "waterDepth", "metre", residentBand("float64", waterDepth));
  putChannel(grid, "waveExposure", "ratio", residentBand("float64", waveExposure));
  state.surface = grid;
  const context = {
    scope: state.domain.scope,
    invocation: [],
    parameters: {},
    epochs: [],
    epochIndices: [0],
    causes: [],
    recordCause() {},
    random: () => 0.5,
    cancelled: () => false,
    progress() {},
  } as unknown as MapProcessContext;
  return { state, grid, cell, context };
}

it("ranks passes, river nodes and sheltered harbours above the open plain", () => {
  const { state, cell } = country();
  const sites = rankSites(state);
  expect(sites[cell(10, 4)]?.kind).toBe("pass");
  expect(sites[cell(10, 2)]).toBeNull();
  expect(sites[cell(14, 4)]?.kind).toBe("river-node");
  expect(sites[cell(14, 4)]?.reason).toContain("junction");
  // The bay head is a harbour at a river mouth; the straight exposed coast is not.
  expect(sites[cell(16, 4)]?.kind).toBe("harbour");
  expect(sites[cell(16, 4)]?.reason).toContain("river mouth");
  expect(sites[cell(17, 1)]).toBeNull();
  // A river cell that is neither a junction nor a mouth is only a crossing on the plain.
  expect(sites[cell(12, 4)]?.kind).toBe("plain-node");
  expect(sites[cell(3, 7)]).toBeNull();
});

it("moves each unit's settlement to its best site and keeps the draw where there is only plain", () => {
  const { state, grid, cell, context } = country();
  // Two units: the west of the wall and the east of it, each drawn in open country.
  const seeds = [cell(4, 7), cell(13, 7)];
  const owner = new Int32Array(grid.active.length);
  for (let i = 0; i < owner.length; i++) owner[i] = i % 21 <= 10 ? 0 : 1;
  const river = residentBand("float64", new Float64Array(owner.length)),
    coast = residentBand("float64", new Float64Array(owner.length));
  const chosen = chooseSettlementSites(
    state,
    context,
    residentBand("int32", owner),
    seeds,
    river,
    coast
  );
  // The western unit owns the col, the best class there is; the town sits at its foot on
  // the unit's own side, on the flat ground nearest the people who settled it.
  expect(chosen[0].cell).toBe(cell(9, 5));
  expect(chosen[0].site?.kind).toBe("pass");
  expect(chosen[0].site?.fortress).toBe(false);
  expect(chosen[0].site?.reason).toContain("at the foot of the pass");
  // The eastern unit has a river junction and a harbour; the junction ranks higher.
  expect(chosen[1].cell).toBe(cell(14, 4));
  expect(chosen[1].site?.kind).toBe("river-node");
  // A unit of nothing but plain keeps its draw and carries no site.
  const plainOwner = new Int32Array(owner.length).fill(-1);
  for (let y = 6; y < 10; y++) for (let x = 0; x < 9; x++) plainOwner[cell(x, y)] = 0;
  const plain = chooseSettlementSites(
    state,
    context,
    residentBand("int32", plainOwner),
    [cell(4, 7)],
    river,
    coast
  );
  expect(plain[0].cell).toBe(cell(4, 7));
  expect(plain[0].site).toBeNull();
});

it("holds a pass from a spur only when a hazard lies below it", () => {
  const { state, grid, cell, context } = country();
  const owner = residentBand("int32", new Int32Array(grid.active.length));
  const river = residentBand("float64", new Float64Array(owner.length)),
    coast = residentBand("float64", new Float64Array(owner.length));
  // A reachable spur beside the col, 300 m above it, on a moderate slope.
  state.surface.channels.elevation.set(cell(9, 3), 650);
  state.surface.channels.slope.set(cell(9, 3), 0.02);
  const quiet = chooseSettlementSites(state, context, owner, [cell(4, 7)], river, coast);
  expect(quiet[0].site?.fortress).toBe(false);
  // A Fire halo in the valley below gives a reason to hold it.
  putChannel(
    state.surface,
    "quickening",
    "ratio",
    residentBand(
      "float64",
      Float64Array.from({ length: owner.length }, (_, i) => (i === cell(11, 4) ? 0.3 : 0))
    )
  );
  const held = chooseSettlementSites(state, context, owner, [cell(4, 7)], river, coast);
  expect(held[0].site?.kind).toBe("pass");
  expect(held[0].site?.fortress).toBe(true);
  expect(held[0].cell).toBe(cell(9, 3));
  expect(held[0].site?.reason).toContain("Fire halo");
});

it("seats a necropolis on a Salt killing ground where the plain offered nothing", () => {
  const { state, grid, cell } = country();
  expect(rankSites(state)[cell(3, 7)]).toBeNull();
  putChannel(
    state.surface,
    "magic:salt:feature:ground",
    "category",
    residentBand(
      "float64",
      Float64Array.from({ length: grid.active.length }, (_, i) => (i === cell(3, 7) ? 1 : 0))
    )
  );
  const sites = rankSites(state);
  expect(sites[cell(3, 7)]?.kind).toBe("necropolis");
  expect(sites[cell(3, 7)]?.reason).toContain("killing ground");
  expect(sites[cell(3, 8)]).toBeNull();
  // A Hallowed ring is a sanctuary, and a surer seat than a killing ground.
  putChannel(
    state.surface,
    "magic:hallowed:feature:ring",
    "category",
    residentBand(
      "float64",
      Float64Array.from({ length: grid.active.length }, (_, i) => (i === cell(3, 7) ? 1 : 0))
    )
  );
  expect(rankSites(state)[cell(3, 7)]?.kind).toBe("sanctuary");
});
