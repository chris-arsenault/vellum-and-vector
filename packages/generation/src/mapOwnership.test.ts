import { expect, it } from "vitest";
import { landscape } from "./mapFixtures";
import { generatedFeature, putGeneratedNetwork } from "./mapFeatures";

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
