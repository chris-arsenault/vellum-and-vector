import { expect, it } from "vitest";
import { MapScale, createGrid, putChannel, rectangle, residentBand } from "@atlas/domain";
import { landscape } from "./mapFixtures";
import { rankSites } from "./siteRanking";

/**
 * A 20 × 9 km country at 1 km cells: a mountain wall across the middle with one col in it,
 * a river running from the wall down to a bay on the east coast, open plain elsewhere.
 */
function country() {
  const state = landscape();
  state.domain.scope.footprint = state.domain.world.areas.area.footprint = rectangle([
    0, 0, 20000, 9000,
  ]);
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
  putChannel(
    grid,
    "Elevation",
    "native-length",
    residentBand(
      "float64",
      elevation.map((m) => MapScale.inUnits(m, "native"))
    )
  );
  putChannel(grid, "WaterKindCodes", "category", residentBand("float64", water));
  putChannel(grid, "RiverOrders", "category", residentBand("float64", riverOrder));
  putChannel(grid, "FlowAccumulation", "cubic-metre/second", residentBand("float64", flow));
  putChannel(grid, "Slope", "gradient", residentBand("float64", slope));
  putChannel(
    grid,
    "WaterDepths",
    "native-length",
    residentBand(
      "float64",
      waterDepth.map((m) => MapScale.inUnits(m, "native"))
    )
  );
  putChannel(
    grid,
    "WaveExposure",
    "per-mille",
    residentBand(
      "float64",
      waveExposure.map((share) => share * 1000)
    )
  );
  state.surface = grid;
  return { state, grid, cell };
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
