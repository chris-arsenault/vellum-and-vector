import { expect, it } from "vitest";
import "../coupling/responders";
import { ask, explainAnswer } from "../coupling/answers";
import { linksOf, offerLinks } from "../coupling/links";
import { invalidateProcesses, runOperation } from "../processOperation";
import type { PhysicalField } from "../world/field";
import { craftOf, holding, practised } from "./craftCatalogue";
import { learnCrafts } from "./craftPass";
import { travelFrom } from "./hinterlands";
import { at, fertileLand, landContext } from "./landTestFixture";
import { layHumanLayer, overlayIdentity } from "./layerOperations";

const fire = craftOf("fire"),
  vow = craftOf("hallowed");
/** A land with people on two cells, both holding the given craft. */
function peopled(code: number) {
  const map = fertileLand();
  runOperation(map, layHumanLayer, { map, kind: "population", amount: at({ 0: 10, 1: 10 }) });
  runOperation(map, overlayIdentity, {
    map,
    traditions: { craft: { get: () => code } },
    people: at({ 0: 10, 1: 10 }),
    hardness: 0,
  });
  return map;
}

it("is learned only where the medium lies, by as much of a cell's people as its ground teaches", () => {
  const map = fertileLand();
  runOperation(map, layHumanLayer, { map, kind: "population", amount: at({ 0: 10, 1: 10 }) });
  map.Quickening.set(0, 0.5);
  // Long enough for everyone the ground can teach to have learned, and learned again: the
  // share who hold it stays the share of the ground that teaches it.
  runOperation(map, learnCrafts, { map, years: 100_000 });
  runOperation(map, learnCrafts, { map, years: 100_000 });
  expect(holding(map, fire, 0)).toBeCloseTo(0.5);
  expect(holding(map, fire, 1)).toBe(0);
});

it("is practised only by those who hold it, on ground the medium reaches", () => {
  const map = peopled(fire.code);
  map.Quickening.set(0, 0.4);
  expect(practised(map, fire, 0)).toBeCloseTo(0.4);
  // Carried off its medium, the craft is held and does nothing.
  expect(holding(map, fire, 1)).toBeCloseTo(1);
  expect(practised(map, fire, 1)).toBe(0);
});

it("sets a rule aside on the share of a cell where it is practised, and nowhere else", () => {
  const map = peopled(vow.code),
    context = landContext();
  map.Warding.set(0, 0.75);
  invalidateProcesses(map);
  const harm = ask(map, "harm", context);
  // Inside the vow nothing is harmed, over the share of the cell the vow holds.
  expect(harm.get(0)).toBeCloseTo(0.25);
  // What was turned away lands beside it: the rim takes its own share and the vow's.
  expect(harm.get(1)).toBeCloseTo(1.75);
  expect(harm.get(map.mesh.count - 1)).toBe(1);
  expect(
    explainAnswer(map, "harm", 0, context).contributions.find((one) => one.by === vow.name)
  ).toMatchObject({ operation: "break", share: 0.75, value: 0 });
});

it("replaces what others said about the rule instead of adding to it", () => {
  const map = peopled(fire.code),
    context = landContext();
  map.Temperature.fill(300);
  map.Quickening.set(0, 1);
  invalidateProcesses(map);
  const season = ask(map, "season", context);
  // The climate gives almost no season here; inside a kept hearth it is the best there is.
  expect(season.get(1)).toBeLessThan(0.6);
  expect(season.get(0)).toBe(1);
});

it("takes an offered step between cells that do not touch like any other step", () => {
  const map = fertileLand(),
    far = map.mesh.count - 1,
    level = (from: number, to: number) =>
      Math.hypot(map.mesh.x(to) - map.mesh.x(from), map.mesh.y(to) - map.mesh.y(from)),
    without = travelFrom(map, 0, level, Infinity)[far];
  // The step exists on this land only.
  const withdraw = offerLinks("a test door", (on: PhysicalField) =>
    on === map ? [{ a: 0, b: far, cost: 1 }] : []
  );
  expect(linksOf(map)).toHaveLength(1);
  const through = travelFrom(map, 0, level, Infinity);
  withdraw();
  expect(linksOf(map)).toHaveLength(0);
  expect(through[far]).toBe(1);
  expect(through[far]).toBeLessThan(without);
  // What lies beside the far end is reached through it too.
  const beside = map.mesh.neighbor(far, 0) >= 0 ? map.mesh.neighbor(far, 0) : far - 1;
  expect(through[beside]).toBeLessThan(travelFrom(fertileLand(), 0, level, Infinity)[beside]);
});
