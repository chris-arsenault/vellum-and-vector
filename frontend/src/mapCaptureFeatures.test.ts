import { expect, it } from "vitest";
import { rectangle, spatial, type Area, type AtlasFeature } from "@atlas/domain";
import { capturedFeature, capturedFeatureIds } from "./mapCapture";

function records() {
  const worldId = crypto.randomUUID(),
    area = { id: crypto.randomUUID(), footprint: rectangle([0, 0, 100, 100]) } as Area,
    placeId = crypto.randomUUID(),
    source = (dry: boolean): AtlasFeature => ({
      id: crypto.randomUUID(),
      name: "Captured River",
      placeId,
      areaId: "parent",
      kind: "river",
      layerId: "rivers",
      geometry: {
        type: "LineString",
        coordinates: [
          [10, 10],
          [90, 90],
        ],
      },
      attributes: { riverId: "same-river", developedBy: "regional", dryMember: dry },
      relations: [],
      detail: {},
      state: "generated",
      protected: false,
      actor: "generator",
      generationId: null,
      causes: [],
    }),
    features = [source(false), source(true)],
    ids = capturedFeatureIds(worldId, area.id, features),
    clip = spatial.intersectionWith(area.footprint);
  return { worldId, area, features, ids, clip };
}

it("preserves separate current records of one place when they become child inputs", () => {
  const { area, features, ids, clip } = records(),
    captured = features.map((feature) => capturedFeature(feature, area, ids, false, clip)!);
  expect(captured[0].id).not.toBe(captured[1].id);
  expect(captured.map((feature) => feature.placeId)).toEqual(
    features.map((feature) => feature.placeId)
  );
  expect(captured.map((feature) => feature.attributes.dryMember)).toEqual([false, true]);
  expect(captured.every((feature) => feature.attributes.developedBy === undefined)).toBe(true);
  expect(features.every((feature) => feature.attributes.developedBy === "regional")).toBe(true);
});

it("keeps product identity and regeneration role when capturing the same map", () => {
  const { worldId, area, features, clip } = records(),
    feature = { ...features[0], areaId: area.id },
    ids = capturedFeatureIds(worldId, area.id, [feature]),
    captured = capturedFeature(feature, area, ids, true, clip)!;
  expect(captured.id).toBe(feature.id);
  expect(captured.attributes.developedBy).toBe("regional");
});
