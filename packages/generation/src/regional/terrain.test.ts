import { expect, it, vi } from "vitest";

// World-depth runs on a supplied country: longer than the suite's default per-test budget.
vi.setConfig({ testTimeout: 120_000 });
import { point, type Landmark } from "@atlas/domain";
import { Landform } from "../canonry/codes";
import { landmarkKinds } from "../canonry/landmarkKinds";
import { placeLandmark } from "../canonry/landmarks";
import { networkDivides } from "./divides";
import { regionalFixture, runSchedule, suppliedFeature } from "./fixture";
import { isContent, neighborsOf, positionOf } from "./lattice";
import type { RegionalState } from "./state";

/**
 * M2 terrain at depth (plan: "Terrain and water at depth"). Each check asserts an observable
 * of the developed country: ridgelines with cols between catchments, sediment stopping at
 * the foot of a mountain front, channels starting earlier on steep ground.
 */

const content = (state: RegionalState) => {
  const mesh = state.physical.map.mesh,
    cells: number[] = [];
  for (let i = 0; i < mesh.count; i++) if (isContent(mesh, i)) cells.push(i);
  return cells;
};
const mean = (values: number[]) => values.reduce((a, b) => a + b, 0) / Math.max(1, values.length);
const clamp = (v: number) => Math.max(0, Math.min(1, v));
const mountain = (x: number, y: number) => 100 + x / 25 + Math.abs(y - 20000) / 12;

it("divide network: the country has ridges and cols, and divide cells stand above their flanks", () => {
  const { state } = regionalFixture(mountain, 40000, 2);
  runSchedule(state, ["physical"]);
  const map = state.physical.map,
    cells = content(state),
    codes = cells.map((i) => map.LandformCodes.get(i));
  expect(codes.filter((code) => code === Landform.Ridge).length).toBeGreaterThan(0);
  expect(codes.filter((code) => code === Landform.Pass).length).toBeGreaterThan(0);
  const crest = networkDivides(state),
    height = (i: number) => map.Elevation.get(i) / 1024,
    around = new Int32Array(map.mesh.stride),
    divides = cells.filter((i) => crest[i] > 0);
  // A divide is a crest: it stands above the ground on either side that drains away from it.
  let standing = 0;
  for (const i of divides) {
    const m = neighborsOf(map.mesh, i, around),
      flanks: number[] = [];
    for (let k = 0; k < m; k++) if (!crest[around[k]]) flanks.push(height(around[k]));
    if (flanks.length && height(i) > mean(flanks)) standing++;
  }
  expect(divides.length).toBeGreaterThan(100);
  // Most divide cells are crests on this lattice; a few lie in cols or on rounded interfluves.
  expect(standing / divides.length).toBeGreaterThan(0.6);
});

it("sediment: the foot of a mountain front holds more sediment than the slope above it", () => {
  const { state } = regionalFixture((_x, y) => 200 + 1000 * clamp((y - 15000) / 10000), 40000, 2);
  runSchedule(state, ["physical"]);
  const map = state.physical.map,
    mesh = map.mesh,
    thickness = (select: (y: number) => boolean) =>
      mean(
        content(state)
          .filter((i) => select(positionOf(mesh, i).y) && map.WaterKindCodes.get(i) === 0)
          .map((i) => map.SedimentThickness.get(i) / 1024)
      ),
    // The parent samples the front over five kilometres, so its base ramps down to about
    // five kilometres south of the drawn foot: the fan lies on that lower ground.
    foot = thickness((y) => y > 5000 && y < 15000),
    slope = thickness((y) => y > 17000 && y < 25000);
  expect(foot).toBeGreaterThan(0.02);
  expect(foot).toBeGreaterThan(3 * slope);
});

it("slope factor: channels start at a smaller catchment on steep ground than on a plain", () => {
  const smallest = [200, 20].map((divisor) => {
    const { state } = regionalFixture((_x, y) => 100 + y / divisor, 40000, 2);
    runSchedule(state, ["physical"]);
    const network = state.regional.network!;
    let least = Infinity;
    for (const i of content(state))
      if (network.channel[i]) least = Math.min(least, network.area[i]);
    return least;
  });
  expect(smallest[1]).toBeLessThan(smallest[0] * 0.8);
});

it("persistence: dry, fractured country holds network valleys with their incision and no drawn river", () => {
  const dryness = { runoff: 0.05, rainfall: 0.25, temperature: 26, fracture: 0.8 },
    humid = { runoff: 0.6, rainfall: 1.2, temperature: 16, fracture: 0.2 },
    rivers = [dryness, humid].map((climate) => {
      const { state } = regionalFixture(mountain, 40000, 2, {
        runoff: ["metre/year", () => climate.runoff],
        rainfall: ["metre/year", () => climate.rainfall],
        temperature: ["celsius", () => climate.temperature],
        fracture: ["ratio", () => climate.fracture],
      });
      runSchedule(state, ["physical"]);
      const map = state.physical.map,
        network = state.regional.network!;
      let drawn = 0,
        valleys = 0,
        dryValleys = 0;
      for (const i of content(state)) {
        if (map.RiverOrders.get(i) > 0) drawn++;
        if (!network.channel[i] || map.WaterKindCodes.get(i) !== 0) continue;
        valleys++;
        if (map.RiverOrders.get(i) === 0 && map.CumulativeFluvialErosion.get(i) > 0) dryValleys++;
      }
      // Dry country has sparser valleys to begin with; the share of them left without a
      // river is what persistence decides.
      return { drawn, dryShare: dryValleys / Math.max(1, valleys), dryValleys };
    });
  expect(rivers[0].dryValleys).toBeGreaterThan(0);
  expect(rivers[0].dryShare).toBeGreaterThan(rivers[1].dryShare + 0.1);
  expect(rivers[0].drawn).toBeLessThan(rivers[1].drawn);
});

it("dam: a captured dam on the trunk holds a reservoir behind it", () => {
  // A gently falling valley (half a percent along its axis): a crest a few tens of metres
  // high backs water up for kilometres, as a reservoir does.
  const { state } = regionalFixture((x, y) => 100 + x / 200 + Math.abs(y - 20000) / 12, 40000, 2);
  // The trunk runs west down the valley axis; the dam record stands on it toward the lower end.
  suppliedFeature(state, "dam-1", "dam", "waterworks", point({ x: 30000, y: 20000, z: 0 }), {
    workKind: "dam",
  });
  runSchedule(state, ["physical"]);
  const map = state.physical.map,
    mesh = map.mesh,
    reservoir = content(state).filter((i) => {
      const p = positionOf(mesh, i);
      return (
        map.WaterKindCodes.get(i) === 2 &&
        // The valley rises eastward, so the water backs up east of the dam.
        p.x > 29000 &&
        p.x < 40000 &&
        Math.abs(p.y - 20000) < 3000
      );
    });
  expect(reservoir.length).toBeGreaterThan(3);
});

it("landmark: an escarpment keeps its throw on the developed relief and a river crossing it falls", () => {
  const scarp: Landmark = {
    id: "scarp-1",
    name: "The Scarp",
    kind: "escarpment",
    geometry: {
      type: "LineString",
      coordinates: [
        [-5000, 25000],
        [45000, 25000],
      ],
    },
    parameters: { throw: 300, scarpWidth: 2 },
    emplacedAtEpoch: 0,
  };
  // Country rising gently northward with the scarp already in the captured ground, as a
  // parent publishes it; the landmark holds the throw and rivers running south cross it.
  const { state } = regionalFixture(
    (_x, y) => 100 + y / 200 + 300 * clamp((y - 24000) / 2000),
    40000,
    2,
    {},
    [scarp]
  );
  runSchedule(state, ["physical"]);
  const map = state.physical.map,
    measured = landmarkKinds.escarpment.measure(map, placeLandmark(map, scarp)!);
  expect(Math.abs(measured.throw - 300)).toBeLessThan(30);
  const falls = content(state).filter((i) => map.LandformCodes.get(i) === Landform.Waterfall);
  expect(falls.length).toBeGreaterThan(0);
});
