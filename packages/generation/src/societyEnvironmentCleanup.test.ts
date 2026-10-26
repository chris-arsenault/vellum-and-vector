import { expect, it } from "vitest";
import { landscape } from "./mapFixtures";
import { generatedFeature } from "./mapFeatures";
import { dropReplaceableFeatures } from "./societyEnvironment";

it("retains landmark-owned magic geography while removing replaceable detected magic places", () => {
  const state = landscape(),
    world = state.domain.world;
  world.id = "bc07dcd0-7cba-46b1-8e56-5f7829dde8cb";
  const landmark = generatedFeature(
    state,
    "landmark",
    "Known wellspring",
    "landmark",
    "magic",
    { type: "Point", coordinates: [500, 500] },
    { landmarkKind: "fire-wellspring" }
  );
  const detected = generatedFeature(state, "detected", "Detected halo", "magicSite", "magic", {
    type: "Point",
    coordinates: [600, 500],
  });
  world.features = { [landmark.id]: landmark, [detected.id]: detected };
  world.landmarks = [
    {
      id: landmark.id,
      name: landmark.name,
      kind: "fire-wellspring",
      geometry: landmark.geometry,
      parameters: {},
      emplacedAtEpoch: 0,
      origin: "generated",
    },
  ];
  const records = structuredClone(world.landmarks),
    before = structuredClone(landmark);
  dropReplaceableFeatures(state);
  expect(world.features[detected.id]).toBeUndefined();
  expect(world.features[landmark.id]).toEqual(before);
  expect(world.landmarks).toEqual(records);
});
