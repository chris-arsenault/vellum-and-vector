import { expect, it } from "vitest";
import { landscape } from "./mapFixtures";
import { generatedFeature, putGeneratedNetwork } from "./mapFeatures";
import { rectangle, readAtlasFeatures } from "@atlas/domain";
import { validateWorkingMap } from "./mapValidation";

it("presents complete child geometry beyond the starting outline without exposing parent records", () => {
  const state = landscape(),
    world = state.domain.world;
  world.id = "df8d14c5-4f19-4f11-aa7c-fba42fbde872";
  const parent = generatedFeature(
    state,
    "parent",
    "Parent forest",
    "forest",
    "ecology",
    rectangle([0, 0, 2000, 1000])
  );
  world.features[parent.id] = parent;
  world.areas.child = {
    ...world.areas.area,
    id: "child",
    parentId: "area",
    profile: "region",
    regionId: "selection",
    footprint: rectangle([1000, 100, 2000, 900]),
    map: { sourceAreaId: "area", sourceRevision: 1 },
  };
  state.domain.scope.areaId = "child";
  const local = [rectangle([1500, 500, 2500, 1000]), rectangle([3000, 1500, 5000, 2500])].map(
    (geometry, index) => {
      const feature = generatedFeature(
        state,
        `local:${index}`,
        "Child forest",
        "forest",
        "ecology",
        geometry
      );
      feature.footprint = rectangle([0, 0, 6000, 3000]);
      world.features[feature.id] = feature;
      return feature;
    }
  );
  expect(readAtlasFeatures(world, "child")).toEqual(local);
  expect(readAtlasFeatures(world, "area")).toEqual([parent]);
});

it.each(["add", "move", "remove"] as const)(
  "allows a map to %s its own geography beyond the starting outline",
  (operation) => {
    const state = landscape(),
      world = state.domain.world;
    world.id = "df8d14c5-4f19-4f11-aa7c-fba42fbde872";
    world.areas.parent = { ...world.areas.area, id: "parent" };
    world.areas.area = {
      ...world.areas.area,
      parentId: "parent",
      profile: "region",
      map: { sourceAreaId: "parent", sourceRevision: 1 },
    };
    const feature = generatedFeature(
      state,
      "forest",
      "Forest",
      "forest",
      "ecology",
      rectangle([5000, 2000, 6000, 3000])
    );
    feature.footprint = rectangle([4500, 1500, 6500, 3500]);
    if (operation !== "add") world.features[feature.id] = feature;
    const original = structuredClone(state.domain);
    if (operation === "remove") delete world.features[feature.id];
    else
      world.features[feature.id] = {
        ...feature,
        geometry: rectangle([7000, 4000, 8000, 5000]),
        footprint: rectangle([6500, 3500, 8500, 5500]),
      };
    expect(() => validateWorkingMap(state, original)).not.toThrow();
    if (operation !== "remove")
      expect(world.features[feature.id].geometry).toEqual(rectangle([7000, 4000, 8000, 5000]));
  }
);

it.each(["add", "move", "remove", "transfer"] as const)(
  "rejects %s of another map's geography even inside the active outline",
  (operation) => {
    const state = landscape();
    state.domain.world.id = "df8d14c5-4f19-4f11-aa7c-fba42fbde872";
    const feature = generatedFeature(
      state,
      "foreign",
      "Other map forest",
      "forest",
      "ecology",
      rectangle([100, 100, 200, 200])
    );
    feature.areaId = operation === "transfer" ? "area" : "another-map";
    if (operation !== "add") state.domain.world.features[feature.id] = feature;
    const original = structuredClone(state.domain);
    if (operation === "remove") delete state.domain.world.features[feature.id];
    else
      state.domain.world.features[feature.id] = {
        ...feature,
        areaId: "another-map",
        geometry: rectangle([200, 200, 300, 300]),
      };
    expect(() => validateWorkingMap(state, original)).toThrow("owned by the active map");
  }
);

it("keeps junction elevations separate for maps with the same horizontal coordinates", () => {
  const state = landscape(),
    world = state.domain.world;
  world.id = "df8d14c5-4f19-4f11-aa7c-fba42fbde872";
  const geometry = {
    type: "LineString" as const,
    coordinates: [
      [1000, 500],
      [2000, 500],
    ],
  };
  const parent = generatedFeature(state, "river", "Parent river", "river", "rivers", geometry, {
    elevations: [100, 50],
  });
  putGeneratedNetwork(state, parent);
  const before = structuredClone(world.networkNodes);
  world.areas.child = {
    ...world.areas.area,
    id: "child",
    parentId: "area",
    map: { sourceAreaId: "area", sourceRevision: 1 },
  };
  state.domain.scope = { ...state.domain.scope, areaId: "child" };
  putGeneratedNetwork(
    state,
    generatedFeature(state, "river", "Child river", "river", "rivers", geometry, {
      elevations: [900, 800],
    })
  );
  for (const [id, node] of Object.entries(before!)) expect(world.networkNodes![id]).toEqual(node);
  expect(Object.values(world.networkNodes!)).toHaveLength(4);
});
