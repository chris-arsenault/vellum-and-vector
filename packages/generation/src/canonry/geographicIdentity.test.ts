import { expect, it } from "vitest";
import { rectangle, type AtlasFeature } from "@atlas/domain";
import { landscape } from "../mapFixtures";
import { generatedFeature, putGeneratedNetwork } from "../mapFeatures";
import { retainGeographicIdentities } from "./geographicIdentity";

function river(state: ReturnType<typeof landscape>, key: string, coordinates: number[][]) {
  state.domain.world.id = "00000000-0000-4000-8000-000000000001";
  return generatedFeature(
    state,
    key,
    key,
    "river",
    "rivers",
    { type: "LineString", coordinates },
    {
      sourceAlgorithm: "canonry-0f62584c",
      discharge: 10,
      discharges: [10, 10],
      widths: [5, 5],
      depths: [1, 1],
      elevations: [0, 0],
    }
  );
}
function pair() {
  const state = landscape(),
    old = river(state, "semantic-river", [
      [0, 500],
      [4000, 500],
    ]);
  old.name = "Established river";
  old.relations = [{ kind: "related", targetId: "a-place" }];
  state.domain.world.features[old.id] = old;
  return { state, old, original: structuredClone(state.domain) };
}

it("retains ecological polygon identity, name and relationships when resampling moves its contour", () => {
  const state = landscape();
  state.domain.world.id = "00000000-0000-4000-8000-000000000001";
  const old = generatedFeature(
    state,
    "old-forest",
    "Named woodland",
    "forest",
    "ecology",
    rectangle([0, 0, 1000, 1000]),
    { sourceAlgorithm: "atlas-ecology-1", biome: "Temperate forest" }
  );
  old.relations = [{ kind: "related", targetId: "a-place" }];
  state.domain.world.features = { [old.id]: old };
  const original = structuredClone(state.domain);
  const next = generatedFeature(
    state,
    "new-forest",
    "New samples",
    "forest",
    "ecology",
    rectangle([1, 0, 1001, 1000]),
    { sourceAlgorithm: "atlas-ecology-1", biome: "Temperate forest" }
  );
  state.domain.world.features = { [next.id]: next };
  retainGeographicIdentities(state, original, 50, new Set([next.id]));
  expect(Object.keys(state.domain.world.features)).toEqual([old.id]);
  expect(state.domain.world.features[old.id]).toMatchObject({
    name: old.name,
    relations: old.relations,
    geometry: next.geometry,
  });
});

it("retains semantic identity and metadata when resampling moves and adds vertices", () => {
  const { state, old, original } = pair();
  const next = river(state, "new-samples", [
    [0, 510],
    [2000, 490],
    [4000, 510],
  ]);
  state.domain.world.features = { [next.id]: next };
  retainGeographicIdentities(state, original, 50, new Set([next.id]));
  expect(Object.keys(state.domain.world.features)).toEqual([old.id]);
  expect(state.domain.world.features[old.id]).toMatchObject({
    name: old.name,
    relations: old.relations,
    geometry: next.geometry,
  });
});

it("reserves exact identities and retains their names and relationships", () => {
  const { state, old, original } = pair();
  const exact = {
    ...river(state, "regenerated", [
      [0, 500],
      [4000, 500],
    ]),
    id: old.id,
  };
  const added = river(state, "new-tributary", [
    [0, 520],
    [4000, 520],
  ]);
  state.domain.world.features = { [exact.id]: exact, [added.id]: added };
  retainGeographicIdentities(state, original, 50, new Set([exact.id, added.id]));
  expect(Object.keys(state.domain.world.features)).toHaveLength(2);
  expect(state.domain.world.features[old.id]).toMatchObject({
    name: old.name,
    relations: old.relations,
    geometry: exact.geometry,
  });
  expect(state.domain.world.features[added.id]).toEqual(added);
});

it("does not confuse directed rivers that only share a bounding box", () => {
  const state = landscape(),
    old = river(state, "old", [
      [0, 0],
      [4000, 1000],
    ]);
  state.domain.world.features[old.id] = old;
  const original = structuredClone(state.domain);
  const next = river(state, "crossing", [
    [0, 1000],
    [4000, 0],
  ]);
  state.domain.world.features = { [next.id]: next };
  retainGeographicIdentities(state, original, 50, new Set([next.id]));
  expect(state.domain.world.features[next.id]).toEqual(next);
  expect(state.domain.world.features[old.id]).toBeUndefined();
});

it("keeps tributaries connected to the original junction when a protected river is retained", () => {
  const { state, old } = pair();
  putGeneratedNetwork(state, old);
  old.protected = true;
  const original = structuredClone(state.domain);
  const next = river(state, "resampled-main", [
    [20, 510],
    [4020, 510],
  ]);
  const tributary = river(state, "tributary", [
    [3000, 1000],
    [4020, 510],
  ]);
  putGeneratedNetwork(state, next);
  putGeneratedNetwork(state, tributary);
  retainGeographicIdentities(state, original, 50, new Set([next.id, tributary.id]));
  expect(state.domain.world.features[old.id]).toEqual(old);
  const reaches = Object.values(state.domain.world.networkReaches!);
  const main = reaches.find((reach) => reach.featureId === old.id)!;
  const branch = reaches.find((reach) => reach.featureId === tributary.id)!;
  expect(branch.end).toBe(main.end);
  expect(
    (
      state.domain.world.features[tributary.id].geometry as AtlasFeature["geometry"] & {
        coordinates: number[][];
      }
    ).coordinates.at(-1)
  ).toEqual([4000, 500]);
});

it("anchors tributary heights to retained junctions without redistributing their flow", () => {
  const { state, old } = pair();
  old.attributes.elevations = [120, 100];
  putGeneratedNetwork(state, old);
  old.protected = true;
  const original = structuredClone(state.domain);
  const next = river(state, "resampled-main", [
    [20, 510],
    [4020, 510],
  ]);
  const tributary = river(state, "height-bearing-tributary", [
    [3000, 1000, 150],
    [4020, 510, 80],
  ]);
  tributary.attributes.elevations = [150, 80];
  tributary.attributes.discharge = 3;
  tributary.attributes.discharges = [3, 4];
  putGeneratedNetwork(state, next);
  putGeneratedNetwork(state, tributary);
  retainGeographicIdentities(state, original, 50, new Set([next.id, tributary.id]));
  const feature = state.domain.world.features[tributary.id];
  const reach = Object.values(state.domain.world.networkReaches!).find(
    (value) => value.featureId === tributary.id
  )!;
  expect(feature.geometry).toEqual({
    type: "LineString",
    coordinates: [
      [3000, 1000, 150],
      [4000, 500, 100],
    ],
  });
  expect(reach.geometry).toEqual(feature.geometry);
  expect(feature.attributes.elevations).toEqual([150, 100]);
  expect(state.domain.world.networkNodes![reach.end].position).toEqual({ x: 4000, y: 500, z: 100 });
  expect(feature.attributes.discharges).toEqual([3, 4]);
  expect(reach.flow).toBe(3);
  expect(reach.endFlow).toBe(4);
  expect(state.domain.world.features[old.id]).toEqual(old);
});
