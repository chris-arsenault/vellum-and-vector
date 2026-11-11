import { expect, it } from "vitest";
import "../coupling/responders";
import type { GenerationState } from "../process";
import { runOperation } from "../processOperation";
import { countryOf } from "./hinterlands";
import { at, fertileLand } from "./landTestFixture";
import { buryHumanLayers, layHumanLayer } from "./layerOperations";
import { denseZones, ruinSites, type DenseZone } from "./placeClassifier";
import { knownPlaces, recordPlaces, recordRemains } from "./placeRegistry";

const zone = (anchor: number, cells: number[], townPeople: number): DenseZone => ({
  anchor,
  cells,
  townPeople,
  people: townPeople * 2,
  builtKm2: 1,
  works: 0,
});
const names = (state: GenerationState) =>
  knownPlaces(state).map((place) => [place.id, place.anchor, place.abandoned ?? "living"]);

it("reads a town as the cells where people live beyond what their land feeds", () => {
  const map = fertileLand(),
    neighbour = map.mesh.neighbor(0, 0) >= 0 ? map.mesh.neighbor(0, 0) : map.mesh.neighbor(0, 2),
    fed = { get: () => 10 };
  runOperation(map, layHumanLayer, {
    map,
    kind: "population",
    // Two crowded cells side by side, the first the denser; country everywhere else.
    amount: { get: (cell) => (cell === 0 ? 50 : cell === neighbour ? 30 : 8) },
  });
  const zones = denseZones(map, fed, 1);
  expect(zones).toHaveLength(1);
  expect(zones[0].anchor).toBe(0);
  expect([...zones[0].cells].sort((a, b) => a - b)).toEqual([0, neighbour].sort((a, b) => a - b));
  expect(zones[0].townPeople).toBeGreaterThan(0);
  expect(zones[0].people).toBeGreaterThan(zones[0].townPeople);
  expect(denseZones(map, fed, 1e12)).toEqual([]);
});
it("reads a ruin where remains outlast what stands, with how far it is covered", () => {
  const map = fertileLand();
  runOperation(map, layHumanLayer, { map, kind: "builtUp", amount: at({ 0: 0.1, 5: 0.1 }) });
  runOperation(map, buryHumanLayers, { map, share: at({ 0: 1 }) });
  const sites = ruinSites(map, 0);
  expect(sites.map((site) => site.anchor)).toEqual([0]);
  expect(sites[0].covered).toBe(1);
});
it("keeps a place's name while its zone moves, and marks it empty when no zone continues it", () => {
  const state = {} as GenerationState;
  recordPlaces(state, [zone(4, [3, 4, 5], 9000), zone(20, [20], 6000)], "first", 5000);
  expect(names(state)).toEqual([
    ["place:0", 4, "living"],
    ["place:1", 20, "living"],
  ]);
  // The first town's peak moves to a neighbouring cell; the second falls below a town.
  recordPlaces(state, [zone(5, [4, 5, 6], 12000)], "second", 5000);
  expect(names(state)).toEqual([
    ["place:0", 5, "living"],
    ["place:1", 20, "second"],
  ]);
  // Too few return to the second town's ground to be a town again: it stays empty.
  recordPlaces(state, [zone(5, [4, 5, 6], 12000), zone(21, [20, 21], 3000)], "third", 5000);
  expect(names(state)[1]).toEqual(["place:1", 20, "second"]);
  // A town's people return: it is the same place, not a new one, and its zone has moved.
  recordPlaces(state, [zone(5, [4, 5, 6], 12000), zone(21, [20, 21], 5500)], "fourth", 5000);
  expect(names(state)).toEqual([
    ["place:0", 5, "living"],
    ["place:1", 21, "living"],
  ]);
  expect(knownPlaces(state)[1].peak).toBe(6000);
});
it("keeps a place whose zone drifts off its old peak, by the ground the two share", () => {
  const state = {} as GenerationState;
  recordPlaces(state, [zone(4, [3, 4, 5], 9000)], "first", 5000);
  recordPlaces(state, [zone(6, [5, 6, 7], 9000)], "second", 5000);
  expect(names(state)).toEqual([["place:0", 6, "living"]]);
});
it("makes one place of two whose zones grow together, without leaving a ruin", () => {
  const state = {} as GenerationState;
  recordPlaces(state, [zone(4, [4], 9000), zone(6, [6], 6000)], "first", 5000);
  recordPlaces(state, [zone(4, [4, 5, 6], 16000)], "second", 5000);
  const [greater, lesser] = knownPlaces(state);
  expect(greater.abandoned).toBeUndefined();
  expect(lesser.absorbedBy).toBe(greater.id);
  expect(lesser.abandoned).toBeUndefined();
});
it("records old remains on ground no known place stands on as a ruin, and no others", () => {
  const state = {} as GenerationState;
  recordPlaces(state, [zone(4, [3, 4, 5], 9000)], "first", 5000);
  recordRemains(
    state,
    [
      { anchor: 5, cells: [5], works: 1 },
      { anchor: 30, cells: [30, 31], works: 2 },
    ],
    "first"
  );
  expect(names(state)).toEqual([
    ["place:0", 4, "living"],
    ["place:1", 30, "first"],
  ]);
});
it("gives each place the country that reaches it most cheaply and one way to its neighbour", () => {
  const map = fertileLand(),
    far = map.mesh.count - 1,
    level = (from: number, to: number) =>
      Math.hypot(map.mesh.x(to) - map.mesh.x(from), map.mesh.y(to) - map.mesh.y(from)),
    country = countryOf(map, [0, far], level, Infinity);
  expect(country.owner[0]).toBe(0);
  expect(country.owner[far]).toBe(1);
  expect([...country.owner].every((owner) => owner >= 0)).toBe(true);
  expect(country.ways).toHaveLength(1);
  const [way] = country.ways;
  expect([way.from, way.to]).toEqual([0, 1]);
  expect(way.cells[0]).toBe(0);
  expect(way.cells.at(-1)).toBe(far);
  expect(way.afloat).toBe(0);
  let land = 0;
  for (let cell = 0; cell < map.mesh.count; cell++) land += map.mesh.area(cell) / 1e6;
  expect(country.hinterlands[0].km2 + country.hinterlands[1].km2).toBeCloseTo(land, 3);
  // A reach too short to meet leaves no way between them.
  expect(countryOf(map, [0, far], level, 1).ways).toEqual([]);
});
it("founds a place only for a zone that holds a town's people", () => {
  const state = {} as GenerationState;
  recordPlaces(state, [zone(1, [1], 4000)], "first", 5000);
  expect(knownPlaces(state)).toEqual([]);
});
