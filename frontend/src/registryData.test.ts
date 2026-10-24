import { expect, it } from "vitest";
import { rectangle } from "@atlas/domain";
import { createWorld } from "./atlasState";
import { registryRows, matchesRegistry, sortRegistry, type RegistryQuery } from "./registryData";
import type { AtlasFeature } from "./types";
const query: RegistryQuery = {
  search: "",
  type: "",
  status: "",
  state: "",
  profile: "",
  space: "",
  named: true,
  protectedOnly: false,
  attributes: [],
};
function fixture() {
  const world = createWorld({ name: "Registry", seed: 1, width: 1000, height: 1000 }),
    areaId = Object.keys(world.areas)[0];
  const town = (id: string, people: number | null): AtlasFeature => ({
    id,
    name: id,
    areaId,
    kind: "settlement",
    layerId: "settlements",
    geometry: { type: "Point", coordinates: [100, 100] },
    detail: {},
    attributes: { population: people, communityPopulation: 9000 },
    relations: [],
    causes: [],
    actor: "generator",
    state: "generated",
    protected: false,
    generationId: null,
  });
  world.features = {
    large: town("large", 900),
    small: town("small", 20),
    unknown: town("unknown", null),
  };
  return { world, areaId };
}
it("sorts numerically, keeps unknown values last and filters town residents rather than catchment population", () => {
  const { world } = fixture(),
    rows = registryRows(world);
  expect(sortRegistry(rows, "population", true).map((r) => r.feature.id)).toEqual([
    "large",
    "small",
    "unknown",
  ]);
  expect(
    rows
      .filter((r) =>
        matchesRegistry(r, {
          ...query,
          attributes: [{ key: "population", min: "100", max: "", text: "" }],
        })
      )
      .map((r) => r.feature.id)
  ).toEqual(["large"]);
});
it("discovers a crossing feature by intersection and keeps finer/floor features out of a World map read", () => {
  const { world, areaId } = fixture(),
    root = world.areas[areaId];
  world.features.road = {
    ...world.features.large,
    id: "road",
    kind: "road",
    layerId: "roads",
    geometry: {
      type: "LineString",
      coordinates: [
        [0, 500],
        [1000, 500],
      ],
    },
  };
  world.areas.child = {
    ...root,
    id: "child",
    parentId: areaId,
    profile: "region",
    footprint: rectangle([400, 400, 600, 600]),
  };
  world.areas.floor = {
    ...root,
    id: "floor",
    spaceId: "floor",
    parentId: areaId,
    profile: "interior",
  };
  world.features.local = {
    ...world.features.large,
    id: "local",
    areaId: "child",
    geometry: { type: "Point", coordinates: [500, 500] },
  };
  world.features.door = {
    ...world.features.large,
    id: "door",
    areaId: "floor",
    kind: "door",
    attributes: { nameStatus: "label" },
  };
  expect(registryRows(world, "child").some((r) => r.feature.id === "road")).toBe(true);
  expect(registryRows(world, areaId).some((r) => ["local", "door"].includes(r.feature.id))).toBe(
    false
  );
  expect(registryRows(world).some((r) => r.feature.id === "local")).toBe(true);
  expect(
    registryRows(world)
      .filter((r) => matchesRegistry(r, query))
      .some((r) => r.feature.id === "door")
  ).toBe(false);
});
it("includes separately owned authored magic sources without duplicating their identity", () => {
  const { world, areaId } = fixture(),
    id = crypto.randomUUID();
  world.magic.push({
    id,
    name: "Authored Fire",
    areaId,
    systemId: "fire",
    source: { x: 100, y: 100, z: 0 },
    radius: 50,
    strength: 300,
    propagation: "fracture",
    effect: "heat",
    decay: 0.1,
    storage: 0,
    dependsOn: null,
    startsAtEpoch: 0,
  });
  const rows = registryRows(world);
  expect(rows.filter((r) => r.feature.id === id)).toHaveLength(1);
  expect(rows.find((r) => r.feature.id === id)?.type.path).toEqual([
    "Magic",
    "Fire",
    "Authored sources",
  ]);
});
