import { expect, it, vi } from "vitest";
import { rectangle } from "@atlas/domain";
import { landscape } from "../../generation/src/mapFixtures";
import { generatedFeature, putGeneratedDetail } from "../../generation/src/mapFeatures";
import { SqliteFeatureWorkspace } from "./featureWorkspace";
import { fixture, scope } from "./catalogFixture";

async function working() {
  const state = landscape();
  state.domain.world.id = scope.worldId;
  let features!: SqliteFeatureWorkspace;
  await fixture((db) => {
    features = new SqliteFeatureWorkspace(db);
  });
  state.features = features;
  return { state, features };
}
function road(state: ReturnType<typeof landscape>, key: string) {
  return generatedFeature(
    state,
    key,
    key,
    "road",
    "roads",
    {
      type: "LineString",
      coordinates: [
        [0, 0],
        [100, 100],
      ],
    },
    { fromPlace: "a", toPlace: "b" }
  );
}
it("filters unrelated catalog records before decoding while retaining local identity and name", async () => {
  const { state, features } = await working(),
    original = road(state, "Old road");
  features.put(
    generatedFeature(state, "ocean", "Ocean", "ocean", "physical", rectangle([0, 0, 4000, 1000]))
  );
  features.put({ ...road(state, "Other map"), areaId: "other" });
  features.put(original);
  const read = vi.spyOn(features, "get"),
    replacement = road(state, "New road");
  replacement.geometry = {
    type: "LineString",
    coordinates: [
      [0, 0],
      [200, 200],
    ],
  };
  expect(putGeneratedDetail(state, replacement, () => true, { kind: "road" })).toBe(true);
  expect(read.mock.calls.map(([id]) => id)).toEqual([original.id]);
  expect(features.get(original.id)).toMatchObject({
    name: original.name,
    geometry: replacement.geometry,
    placeId: original.id,
  });
  expect(features.get(replacement.id)).toBeUndefined();
});
it("preserves protected local records and does not narrow callers without a kind selection", async () => {
  const { state, features } = await working(),
    original = { ...road(state, "Protected"), protected: true };
  features.put(original);
  expect(putGeneratedDetail(state, road(state, "Replacement"), () => true, { kind: "road" })).toBe(
    true
  );
  expect(features.get(original.id)).toMatchObject({ name: "Protected", protected: true });
  expect(
    putGeneratedDetail(
      state,
      { ...road(state, "Different kind"), kind: "lane" },
      (f) => f.id === original.id
    )
  ).toBe(true);
});
it("retains ancestor detail identity and protected detail when a scoped query crosses areas", async () => {
  const { state, features } = await working(),
    world = state.domain.world,
    original = road(state, "Parent road");
  world.areas.child = { ...world.areas.area, id: "child", parentId: "area", profile: "region" };
  world.areas.sibling = { ...world.areas.area, id: "sibling", parentId: "area", profile: "region" };
  features.put({ ...road(state, "Sibling road"), areaId: "sibling" });
  features.put(original);
  state.domain.scope.areaId = "child";
  const detail = road(state, "Child drawing");
  expect(putGeneratedDetail(state, detail, () => true, { kind: "road" })).toBe(true);
  const updated = features.get(original.id)!;
  expect(updated.areaId).toBe("area");
  expect(updated.detail.child.geometry).toEqual(detail.geometry);
  expect(features.get(detail.id)).toBeUndefined();
  updated.detail.child.protected = true;
  features.put(updated);
  const next = road(state, "Later drawing");
  next.geometry = {
    type: "LineString",
    coordinates: [
      [0, 0],
      [500, 200],
    ],
  };
  expect(putGeneratedDetail(state, next, () => true, { kind: "road" })).toBe(true);
  expect(features.get(original.id)!.detail.child.geometry).toEqual(detail.geometry);
});
