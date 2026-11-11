import { expect, it } from "vitest";
import "../coupling/responders";
import { landscape } from "../mapFixtures";
import type { GenerationState } from "../process";
import { runOperation } from "../processOperation";
import { humanLayersOf } from "./humanLayers";
import { foundIdentities, shareIdentities, type IdentityEra } from "./identityPass";
import { leadingOf } from "./identityReads";
import { at, farthestFrom, fertileLand, neighbourOf, type TestLand } from "./landTestFixture";
import { hardenIdentity, layHumanLayer, overlayIdentity } from "./layerOperations";
import { recordPlaces } from "./placeRegistry";
import { passage } from "./reach";
import { liveRealms, type RealmEra } from "./realmPass";
import { knownTraditions } from "./traditions";

/** A run with a world to name things in, living on the given land. */
function runOn(map: TestLand) {
  const state = { ...landscape(), physical: { map } } as unknown as GenerationState;
  // Named things take their identity from the world's, which is a UUID.
  state.domain.world.id = "6f1c2f0e-6c1a-4a57-9a0e-3f5b8f1d2c10";
  return state;
}
const level = (map: TestLand) => (from: number, to: number) =>
  Math.hypot(map.mesh.x(to) - map.mesh.x(from), map.mesh.y(to) - map.mesh.y(from));
function era(state: GenerationState, map: TestLand, more: Partial<IdentityEra> = {}): IdentityEra {
  const step = level(map);
  return {
    state,
    map,
    step,
    going: passage(map, step, 200_000),
    era: "first",
    years: 100,
    mobility: 1,
    founders: 2,
    ...more,
  };
}
const settle = (map: TestLand, values: Record<number, number>) =>
  runOperation(map, layHumanLayer, { map, kind: "population", amount: at(values) });
const tongueOf = (map: TestLand, cell: number) => leadingOf(map, "tongue").code[cell];

it("founds separate peoples at the most peopled places and gives each cell the nearer one's ways", () => {
  const map = fertileLand(),
    state = runOn(map),
    far = farthestFrom(map, 0);
  settle(map, { 0: 50, [neighbourOf(map, 0)]: 5, [far]: 40, [neighbourOf(map, far)]: 5 });
  runOperation(map, foundIdentities, era(state, map));
  const kinds = knownTraditions(state).map((tradition) => tradition.kind);
  expect(kinds.filter((kind) => kind === "tongue")).toHaveLength(2);
  expect(kinds.filter((kind) => kind === "faith")).toHaveLength(2);
  expect(tongueOf(map, 0)).not.toBe(tongueOf(map, far));
  expect(tongueOf(map, neighbourOf(map, 0))).toBe(tongueOf(map, 0));
  expect(tongueOf(map, neighbourOf(map, far))).toBe(tongueOf(map, far));
  // Everyone holds what was founded, and it is founded only once.
  expect(humanLayersOf(map).column(0)[0].people).toBeCloseTo(50);
  runOperation(map, foundIdentities, era(state, map));
  expect(knownTraditions(state)).toHaveLength(6);
});
it("lets a few take up the ways of the many beside them, and the hardened fewer", () => {
  const takenUp = (hardened: boolean) => {
    const map = fertileLand(),
      state = runOn(map),
      town = 0,
      village = neighbourOf(map, town);
    settle(map, { [town]: 500, [village]: 10 });
    for (const [cell, code] of [
      [town, 1],
      [village, 2],
    ])
      runOperation(map, overlayIdentity, {
        map,
        traditions: { tongue: { get: () => code } },
        people: at({ [cell]: 1e9 }),
        hardness: 0,
      });
    if (hardened) runOperation(map, hardenIdentity, { map, years: 5000, settling: 300 });
    runOperation(map, shareIdentities, era(state, map));
    const column = humanLayersOf(map).column(village);
    return column.find((layer) => layer.tongue === 1)?.people ?? 0;
  };
  const open = takenUp(false);
  expect(open).toBeGreaterThan(0);
  expect(open).toBeLessThan(10);
  expect(takenUp(true)).toBeLessThan(open);
});
it("founds realms at towns and gives each the land it reaches most cheaply", () => {
  const map = fertileLand(),
    state = runOn(map),
    west = 0,
    east = farthestFrom(map, 0);
  settle(map, Object.fromEntries(Array.from({ length: map.mesh.count }, (_, cell) => [cell, 10])));
  recordPlaces(
    state,
    [west, east].map((anchor) => ({
      anchor,
      cells: [anchor],
      townPeople: 9000,
      people: 9000,
      builtKm2: 1,
      works: 0,
    })),
    "first",
    5000
  );
  const realms: RealmEra = {
    state,
    map,
    step: level(map),
    era: "first",
    years: 300,
    reach: 2_000_000,
    capacity: 1,
    realms: 2,
  };
  runOperation(map, liveRealms, realms);
  const allegiance = leadingOf(map, "allegiance"),
    seats = knownTraditions(state).filter((tradition) => tradition.kind === "allegiance");
  expect(seats).toHaveLength(2);
  expect(allegiance.code[west]).not.toBe(allegiance.code[east]);
  expect(allegiance.code[neighbourOf(map, west)]).toBe(allegiance.code[west]);
  expect(allegiance.code[neighbourOf(map, east)]).toBe(allegiance.code[east]);
  // A second era founds nothing new: no free town lies beyond both reaches.
  runOperation(map, liveRealms, { ...realms, era: "second" });
  expect(
    knownTraditions(state).filter((tradition) => tradition.kind === "allegiance")
  ).toHaveLength(2);
});
