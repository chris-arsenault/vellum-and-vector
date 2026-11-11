import { expect, it } from "vitest";
import { MapScale, humanRemains } from "@atlas/domain";
import { runOperation } from "../processOperation";
import { createTestField } from "../rock/groundTestFixture";
import { createWorldMesh } from "../world/worldMesh";
import { humanLayersOf } from "./humanLayers";
import { compileLayerMix, fullStandingPerBuiltKm2, wayMemoryYears } from "./layerCatalogue";
import {
  buryHumanLayers,
  dwellOnLand,
  convertHumanLayer,
  layHumanLayer,
  moveHumanLayer,
  overlayIdentity,
  reExposeIdentity,
  reExposeRemains,
  wearHumanLayers,
} from "./layerOperations";

const field = () => createTestField(createWorldMesh([0, 0, 1000, 1000], 16, 0));
/** Per-cell values: the listed cells hold what is given and every other cell holds nothing. */
const at = (values: Record<number, number>) => ({ get: (cell: number) => values[cell] ?? 0 });
const everywhere = (value: number) => ({ get: () => value });
const tongue = (code: number) => ({ tongue: code, faith: 0, custom: 0, allegiance: 0 });
const tongues = (map: ReturnType<typeof field>, cell: number) =>
  humanLayersOf(map)
    .column(cell)
    .map((layer) => [layer.tongue, layer.people]);

it("lays an area layer only into the area nothing else has taken", () => {
  const map = field();
  runOperation(map, layHumanLayer, { map, kind: "farmland", amount: at({ 0: 0.7 }) });
  runOperation(map, layHumanLayer, { map, kind: "builtUp", amount: at({ 0: 0.5, 1: 0.5 }) });
  expect(map.Farmland.get(0)).toBeCloseTo(0.7);
  expect(map.BuiltUp.get(0)).toBeCloseTo(0.3);
  expect(map.BuiltUp.get(1)).toBeCloseTo(0.5);
  expect(humanLayersOf(map).freeArea(0)).toBeCloseTo(0);
});
it("moves people to their targets all at once, with the identities they hold", () => {
  const map = field();
  runOperation(map, layHumanLayer, { map, kind: "population", amount: at({ 0: 100, 1: 40 }) });
  runOperation(map, overlayIdentity, {
    map,
    traditions: tongue(1),
    people: at({ 0: 100 }),
    hardness: 0,
  });
  runOperation(map, overlayIdentity, {
    map,
    traditions: tongue(2),
    people: at({ 1: 40 }),
    hardness: 0,
  });
  runOperation(map, moveHumanLayer, {
    map,
    kind: "population",
    targets: at({ 0: 1, 1: 2 }),
    share: at({ 0: 0.5, 1: 0.25 }),
    years: 2,
  });
  // Cell 1 sends a quarter of what it held before anyone arrived.
  expect([0, 1, 2].map((cell) => map.Population.get(cell))).toEqual([50, 80, 10]);
  // Everyone who left or reached a cell wore the way there for the years they came and went.
  const km2 = MapScale.areaUnits(map.mesh.area(0), "m2", "km2");
  expect([0, 1, 2].map((cell) => map.WalkedRoute.get(cell) / km2)).toEqual([100, 120, 20]);
  expect(tongues(map, 0)).toEqual([[1, 50]]);
  expect(tongues(map, 1)).toEqual([
    [1, 50],
    [2, 30],
  ]);
  expect(tongues(map, 2)).toEqual([[2, 10]]);
});
it("keeps the years people have lived on the ground and forgets ways nobody walks", () => {
  const map = field(),
    km2 = MapScale.areaUnits(map.mesh.area(0), "m2", "km2");
  runOperation(map, layHumanLayer, { map, kind: "population", amount: at({ 0: 10 }) });
  map.WalkedRoute.set(3, 300);
  runOperation(map, dwellOnLand, { map, years: wayMemoryYears });
  expect(map.Tenure.get(0)).toBeCloseTo(10 * km2 * wayMemoryYears);
  expect(map.Tenure.get(1)).toBe(0);
  expect(map.WalkedRoute.get(3)).toBeCloseTo(300 / Math.E);
});
it("thins identities with the people lost, whether or not everyone held one", () => {
  const map = field();
  runOperation(map, layHumanLayer, { map, kind: "population", amount: at({ 0: 100 }) });
  runOperation(map, overlayIdentity, {
    map,
    traditions: tongue(1),
    people: at({ 0: 40 }),
    hardness: 0,
  });
  runOperation(map, buryHumanLayers, { map, share: at({ 0: 0.5 }) });
  expect(map.Population.get(0)).toBe(50);
  expect(tongues(map, 0)).toEqual([[1, 20]]);
});
it("ignores amounts that are not numbers and targets that are not ground", () => {
  const map = field();
  runOperation(map, layHumanLayer, { map, kind: "population", amount: at({ 0: NaN, 1: 10 }) });
  runOperation(map, moveHumanLayer, {
    map,
    kind: "population",
    targets: at({ 1: map.mesh.count + 5 }),
    share: at({ 1: 1 }),
    years: 1,
  });
  runOperation(map, buryHumanLayers, { map, share: at({ 1: NaN }) });
  expect(map.Population.get(0)).toBe(0);
  expect(map.Population.get(1)).toBe(10);
});
it("converts land from one use to another and nothing else", () => {
  const map = field();
  runOperation(map, layHumanLayer, { map, kind: "farmland", amount: at({ 0: 0.6 }) });
  runOperation(map, convertHumanLayer, {
    map,
    from: "farmland",
    to: "pasture",
    amount: at({ 0: 0.9 }),
  });
  expect(map.Farmland.get(0)).toBeCloseTo(0);
  expect(map.Pasture.get(0)).toBeCloseTo(0.6);
  expect(() =>
    runOperation(map, convertHumanLayer, { map, from: "population", to: "builtUp", amount: at({}) })
  ).toThrow("Only land in use converts");
});
it("lays one identity over another and re-exposes the older when the newer leaves", () => {
  const map = field();
  runOperation(map, layHumanLayer, { map, kind: "population", amount: at({ 0: 100 }) });
  runOperation(map, overlayIdentity, {
    map,
    traditions: tongue(1),
    people: at({ 0: 100 }),
    hardness: 0,
  });
  runOperation(map, overlayIdentity, {
    map,
    traditions: tongue(2),
    people: at({ 0: 30 }),
    hardness: 0,
  });
  expect(tongues(map, 0)).toEqual([
    [2, 30],
    [1, 70],
  ]);
  runOperation(map, reExposeIdentity, { map, people: at({ 0: 30 }) });
  expect(tongues(map, 0)).toEqual([[1, 100]]);
});
it("wears each layer by its own facts and leaves what a place was as remains in the open", () => {
  const map = field(),
    fire = compileLayerMix({ burn: 1 });
  runOperation(map, layHumanLayer, { map, kind: "population", amount: at({ 0: 100 }) });
  runOperation(map, overlayIdentity, {
    map,
    traditions: tongue(5),
    people: at({ 0: 100 }),
    hardness: 0,
  });
  runOperation(map, layHumanLayer, { map, kind: "builtUp", amount: at({ 0: 0.2 }) });
  runOperation(map, layHumanLayer, { map, kind: "pasture", amount: at({ 0: 0.4 }) });
  runOperation(map, wearHumanLayers, { map, mix: fire, intensity: at({ 0: 1 }) });
  const lost = (yielded: number) => 1 - Math.exp(-yielded);
  expect(map.Population.get(0)).toBeCloseTo(100 * (1 - lost(0.6)));
  // The dead are counted where they died.
  expect(map.MassDeath.get(0)).toBeCloseTo(
    100 * lost(0.6) * MapScale.areaUnits(map.mesh.area(0), "m2", "km2")
  );
  expect(map.Pasture.get(0)).toBeCloseTo(0.4 * (1 - lost(0.3)));
  expect(map.BuiltUp.get(0)).toBeCloseTo(0.2 * (1 - lost(0.6)));
  // Seven tenths of what burns stays where it stood, uncovered, in its builders' tongue.
  expect(map[humanRemains.builtUp].get(0)).toBeCloseTo(0.2 * lost(0.6) * 0.7);
  expect(map[humanRemains.cover].get(0)).toBe(0);
  expect(map[humanRemains.tongue].get(0)).toBe(5);
  expect(tongues(map, 0)[0][1]).toBeCloseTo(map.Population.get(0));
  expect(map.BuiltUp.get(1)).toBe(0);
});
it("holds a place of full standing against what wears a bare one", () => {
  const map = field(),
    flood = compileLayerMix({ scour: 1 });
  runOperation(map, layHumanLayer, { map, kind: "builtUp", amount: at({ 0: 0.2, 1: 0.2 }) });
  runOperation(map, layHumanLayer, {
    map,
    kind: "standing",
    amount: at({ 0: 0.2 * fullStandingPerBuiltKm2 }),
  });
  expect(humanLayersOf(map).standing(0)).toBeCloseTo(1);
  runOperation(map, wearHumanLayers, { map, mix: flood, intensity: everywhere(1) });
  expect(0.2 - map.BuiltUp.get(0)).toBeCloseTo((0.2 - map.BuiltUp.get(1)) / 2);
});
it("buries a covered share under the ground and re-exposes it when the cover goes", () => {
  const map = field();
  runOperation(map, layHumanLayer, { map, kind: "population", amount: at({ 0: 80 }) });
  runOperation(map, layHumanLayer, { map, kind: "builtUp", amount: at({ 0: 0.2 }) });
  runOperation(map, buryHumanLayers, { map, share: at({ 0: 0.5 }) });
  expect(map.Population.get(0)).toBe(40);
  expect(map.BuiltUp.get(0)).toBeCloseTo(0.1);
  expect(map[humanRemains.builtUp].get(0)).toBeCloseTo(0.1);
  expect(map[humanRemains.cover].get(0)).toBe(1);
  runOperation(map, reExposeRemains, { map, share: at({ 0: 0.25 }) });
  expect(map[humanRemains.cover].get(0)).toBeCloseTo(0.75);
});
