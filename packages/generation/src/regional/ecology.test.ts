import { expect, it, vi } from "vitest";

// World-depth runs on a supplied country: longer than the suite's default per-test budget.
vi.setConfig({ testTimeout: 120_000 });
import { regionalFixture, runSchedule } from "./fixture";
import { isContent } from "./lattice";
import { naturalBand, type RegionalState } from "./state";

/**
 * M4 ecology at depth (plan: "Ecology at depth"). The world ecology engine runs on the
 * regional field; each check asserts an observable of the developed living landscape: the
 * cohorts a cold or warm capture becomes, young regrowth on burned ground that sheds more
 * water than its captured budget, and peat on wet flats.
 */

const content = (state: RegionalState) => {
  const mesh = state.physical.map.mesh,
    cells: number[] = [];
  for (let i = 0; i < mesh.count; i++) if (isContent(mesh, i)) cells.push(i);
  return cells;
};
const mean = (values: number[]) => values.reduce((a, b) => a + b, 0) / Math.max(1, values.length);
const mountain = (x: number, y: number) => 100 + x / 25 + Math.abs(y - 20000) / 12;
const climate = (rainfall: number, runoff: number, temperature: number) => ({
  rainfall: ["metre/year", () => rainfall] as [string, () => number],
  runoff: ["metre/year", () => runoff] as [string, () => number],
  temperature: ["celsius", () => temperature] as [string, () => number],
  treeCover: ["ratio", () => 0.12] as [string, () => number],
});
/** Dry country burns. */
const dry = climate(0.35, 0.08, 19);

it("cohorts: cold captured country is conifer country and warm country broadleaf, from the capture on", () => {
  const share = (temperature: number) => {
    const { state } = regionalFixture(mountain, 40000, 2, {
      temperature: ["celsius", () => temperature],
    });
    runSchedule(state, ["physical"]);
    const map = state.physical.map;
    let conifer = 0,
      trees = 0;
    for (const i of content(state)) {
      conifer += map.ConiferCover.get(i);
      trees += map.ConiferCover.get(i) + map.BroadleafCover.get(i);
    }
    return trees > 0 ? conifer / trees : 0;
  };
  expect(share(1)).toBeGreaterThan(0.7);
  expect(share(15)).toBeLessThan(0.3);
});

it("fire: dry country burns, burned ground has more saplings than mature cover, and it sheds more water", () => {
  const { state } = regionalFixture(mountain, 40000, 2, dry);
  runSchedule(state, ["physical"]);
  const map = state.physical.map,
    runoff = naturalBand(state, "Runoff"),
    burned = content(state).filter(
      (i) => map.WaterKindCodes.get(i) === 0 && map.FireActivity.get(i) >= 0.9
    );
  // One keyed draw per ten-kilometre block: a few of sixteen blocks burn in the last round.
  expect(burned.length).toBeGreaterThan(2);
  const saplings = mean(
      burned.map((i) => map.BroadleafSaplings.get(i) + map.ConiferSaplings.get(i))
    ),
    mature = mean(burned.map((i) => map.BroadleafCover.get(i) + map.ConiferCover.get(i)));
  expect(saplings).toBeGreaterThan(mature);
  // Burned ground sheds more than its captured budget more often than unburned ground does
  // (the wind's exposure changes runoff both ways everywhere; the cleared cover only one way).
  const sheds = (cells: number[]) =>
      cells.filter((i) => map.Runoff.get(i) > runoff.get(i) * 1.02).length /
      Math.max(1, cells.length),
    unburned = content(state).filter(
      (i) => map.WaterKindCodes.get(i) === 0 && map.FireActivity.get(i) === 0
    );
  expect(sheds(burned)).toBeGreaterThan(sheds(unburned));
});

it("peat: wet flats hold more peat than dry ground", () => {
  const { state } = regionalFixture((_x, y) => 200 + Math.abs(y - 20000) / 40, 40000, 2, {
    wetlandCover: ["ratio", () => 0],
    peatCarbon: ["kg-carbon/square-metre", () => 0],
  });
  runSchedule(state, ["physical"]);
  const map = state.physical.map,
    land = content(state).filter((i) => map.WaterKindCodes.get(i) === 0),
    wet = land.filter((i) => map.WetlandCover.get(i) > 0.3),
    dryGround = land.filter((i) => map.WetlandCover.get(i) < 0.05);
  expect(wet.length).toBeGreaterThan(5);
  expect(mean(wet.map((i) => map.PeatCarbon.get(i)))).toBeGreaterThan(
    mean(dryGround.map((i) => map.PeatCarbon.get(i)))
  );
});
