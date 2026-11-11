import { expect, it } from "vitest";
import { humanRemains } from "@atlas/domain";
import { ask } from "../coupling/answers";
import "../coupling/responders";
import { runOperation } from "../processOperation";
import { units } from "../world/math";
import { feedPlaces } from "./landFeed";
import { gatherPeople } from "./landGather";
import { foundPeople, growPeople } from "./landGrow";
import { hardenPlaces } from "./landHarden";
import { meetLand, watchLand } from "./landHistory";
import { advanceHumanLand } from "./landPass";
import { at, fertileLand, landContext, neighbourOf, withWork } from "./landTestFixture";
import { layHumanLayer } from "./layerOperations";
import { founders, loosePass, peoplePerBuiltKm2, settledPass } from "./passFacts";
import { passedOn } from "./reach";

const settle = (map: ReturnType<typeof fertileLand>, values: Record<number, number>) =>
  runOperation(map, layHumanLayer, { map, kind: "population", amount: at(values) });

it("founds the first people thinly on everything the wild feeds, and only once", () => {
  const map = fertileLand(),
    context = landContext(),
    pass = { map, context, facts: loosePass(200) };
  map.WaterKindCodes.set(3, 1);
  runOperation(map, foundPeople, pass);
  expect(map.Population.get(0)).toBeCloseTo(founders * ask(map, "wildYield", context).get(0));
  expect(map.Population.get(3)).toBe(0);
  const first = map.Population.get(0);
  runOperation(map, foundPeople, pass);
  expect(map.Population.get(0)).toBe(first);
});
it("grows people into what feeds them and loses those it cannot feed", () => {
  const map = fertileLand(),
    fed = ask(map, "support", landContext()).get(0);
  settle(map, { 0: fed / 10, 1: fed * 3 });
  withWork(map, { years: 1000 }, (work) => runOperation(map, growPeople, work));
  expect(map.Population.get(0)).toBeCloseTo(fed, 3);
  expect(map.Population.get(1)).toBeCloseTo(fed, 3);
  expect(map.Population.get(2)).toBe(0);
  expect(map.MassDeath.get(1)).toBeGreaterThan(0);
});
it("spills people from full land onto land with room", () => {
  const map = fertileLand(),
    fed = ask(map, "support", landContext()).get(0);
  settle(map, { 0: fed });
  withWork(map, { sweeps: 1, mobility: 0.5 }, (work) => runOperation(map, gatherPeople, work));
  expect(map.Population.get(0)).toBeLessThan(fed);
  let spread = 0;
  for (let cell = 1; cell < map.mesh.count; cell++) spread += map.Population.get(cell);
  expect(spread).toBeCloseTo(fed - map.Population.get(0));
});
it("drains people toward the larger crowd they can reach, and not without mobility", () => {
  const map = fertileLand(),
    town = 0,
    village = neighbourOf(map, town),
    fed = ask(map, "support", landContext()).get(0),
    gather = (mobility: number) => {
      const before = map.Population.get(village);
      withWork(map, { sweeps: 1, mobility }, (work) => {
        // Spare food can be had at the town, so it can hold more than its own land feeds.
        work.market.set(town, 1e9);
        runOperation(map, gatherPeople, work);
      });
      return before - map.Population.get(village);
    };
  // Neither is near full, so nobody spills: what moves is drawn.
  settle(map, { [town]: fed * 0.5, [village]: fed * 0.1 });
  expect(gather(0)).toBe(0);
  expect(gather(0.5)).toBeGreaterThan(0);
  expect(map.Population.get(town)).toBeGreaterThan(fed * 0.5);
});
it("puts land under crops where hunger is felt, and shares spare food with the hungry", () => {
  const map = fertileLand(),
    context = landContext(),
    town = 0,
    village = neighbourOf(map, town),
    empty = neighbourOf(map, village) === town ? 5 : neighbourOf(map, village),
    fed = ask(map, "support", context).get(town),
    crops = ask(map, "cropYield", context).get(town);
  // More people than the town's own land could feed even fully under crops.
  settle(map, { [town]: crops * 2, [village]: fed / 2 });
  const [brought, sent] = withWork(map, {}, (work) => {
    runOperation(map, feedPlaces, work);
    return [work.imports.get(town), work.imports.get(village)];
  });
  expect(map.Farmland.get(town)).toBeGreaterThan(0.5);
  expect(map.Farmland.get(village)).toBeGreaterThan(0);
  // Nobody lives on the empty cell, so nobody clears it.
  expect(map.Population.get(empty)).toBe(0);
  expect(map.Farmland.get(empty)).toBe(0);
  expect(ask(map, "support", context).get(town)).toBeGreaterThan(fed);
  expect(brought).toBeGreaterThan(0);
  expect(sent).toBeLessThan(0);
  const loose = fertileLand();
  settle(loose, { [town]: fed * 4 });
  withWork(loose, { farms: false }, (work) => runOperation(loose, feedPlaces, work));
  expect(loose.Farmland.get(town)).toBe(0);
});
it("builds for the people a place houses and lets what nobody keeps fall to ruin", () => {
  const map = fertileLand();
  settle(map, { 0: peoplePerBuiltKm2 / 10 });
  withWork(map, { years: 10_000 }, (work) => runOperation(map, hardenPlaces, work));
  expect(map.BuiltUp.get(0)).toBeCloseTo(0.1, 3);
  expect(map.Standing.get(0)).toBeGreaterThan(0);
  expect(map.BuiltUp.get(1)).toBe(0);
  const emptied = fertileLand();
  runOperation(emptied, layHumanLayer, { map: emptied, kind: "builtUp", amount: at({ 0: 0.1 }) });
  withWork(emptied, { years: 200 }, (work) => runOperation(emptied, hardenPlaces, work));
  expect(emptied.BuiltUp.get(0)).toBeLessThan(0.1);
  expect(emptied[humanRemains.builtUp].get(0)).toBeGreaterThan(0);
});
it("buries what the sea or new ground covers and bares it when the ground is stripped", () => {
  const map = fertileLand();
  runOperation(map, layHumanLayer, {
    map,
    kind: "builtUp",
    amount: at({ 0: 0.1, 1: 0.1, 2: 0.1 }),
  });
  runOperation(map, watchLand, { map });
  map.WaterKindCodes.set(0, 1);
  map.CumulativeDeposition.set(1, units(30));
  runOperation(map, meetLand, { map });
  expect(map.BuiltUp.get(0)).toBe(0);
  expect(map[humanRemains.builtUp].get(0)).toBeCloseTo(0.1);
  expect(map[humanRemains.cover].get(0)).toBe(1);
  expect(map.BuiltUp.get(1)).toBeCloseTo(0, 4);
  expect(map[humanRemains.cover].get(1)).toBeCloseTo(1);
  expect(map.BuiltUp.get(2)).toBeCloseTo(0.1);
  map.CumulativeCoastalErosion.set(1, units(30));
  runOperation(map, meetLand, { map });
  expect(map[humanRemains.cover].get(1)).toBeCloseTo(0, 4);
});
it("passes on less across costly steps, the same at any cell size", () => {
  expect(passedOn(0, 100)).toBe(1);
  expect(passedOn(100, 100)).toBe(0.5);
  expect(passedOn(Infinity, 100)).toBe(0);
});
it("runs a whole pass without leaving more land in use than there is", () => {
  const map = fertileLand(8),
    context = landContext();
  for (let pass = 0; pass < 3; pass++)
    runOperation(map, advanceHumanLand, { map, context, facts: settledPass(100, 1) });
  for (let cell = 0; cell < map.mesh.count; cell++) {
    const used = map.Farmland.get(cell) + map.Pasture.get(cell) + map.BuiltUp.get(cell);
    expect(used).toBeLessThanOrEqual(1 + 1e-9);
    expect(map.Population.get(cell)).toBeGreaterThanOrEqual(0);
    expect(Number.isFinite(map.Population.get(cell))).toBe(true);
  }
});
