import { expect, it } from "vitest";
import { putChannel, rectangle, residentBand } from "@atlas/domain";
import type { Geometry } from "geojson";
import { worldGeographyFixture } from "./canonry/worldGeographyFixtures";
import { initializeMagic } from "./canonry/magicState";
import { generatedFeature } from "./mapFeatures";
import { defaultAtlasParameters } from "./atlasParameters";
import { generationSettingsSchema } from "./generationSettings";
import { serializableBindings } from "./generationBindings";
import { configuration, invoke, options, registry } from "./mapFixtures";
import { MapRunner } from "./mapRunner";
import { societyPresent } from "./societyProcesses";
import type { GenerationState } from "./process";

function regionalFixture() {
  const footprint: Geometry = {
      type: "Polygon",
      coordinates: [
        [
          [0, 0],
          [4000, 0],
          [0, 1000],
          [0, 0],
        ],
      ],
    },
    state = worldGeographyFixture([0, 0, 4000, 1000], 250, footprint),
    world = state.domain.world,
    count = state.surface.active.length;
  state.domain.scope.worldId = world.id;
  state.surface.scope.worldId = world.id;
  world.areas.parent = { ...world.areas.area, id: "parent" };
  world.areas.area = {
    ...world.areas.area,
    parentId: "parent",
    profile: "region",
    map: { sourceAreaId: "parent", sourceRevision: 1 },
  };
  initializeMagic(state, false);
  const forest = generatedFeature(
    state,
    "forest",
    "Local forest",
    "forest",
    "ecology",
    rectangle([3500, 500, 4500, 1000])
  );
  world.features[forest.id] = forest;
  for (const [name, value] of [
    ["elevation", 100],
    ["treeCover", 0.5],
  ] as const)
    putChannel(
      state.surface,
      name,
      name === "elevation" ? "metre" : "ratio",
      residentBand("float64", new Float64Array(count).fill(value))
    );
  state.facts.add("population");
  supplyWorks(state, count);
  return { state, forest, world };
}
function supplyWorks(state: GenerationState, count: number) {
  state.society = {
    region: {
      areaId: "area",
      spaceId: "surface",
      communities: [],
      connections: [],
      events: [],
      magic: [],
      history: [],
      works: [
        {
          id: "inherited-clearance",
          communityId: "community",
          kind: "clearance",
          position: { x: 500, y: 250, z: 0 },
          radius: 500,
          magnitude: 1,
          condition: 1,
          maintained: true,
          authored: false,
          built: "Earlier history",
          applied: 0,
          realizedAt: "area",
          causes: [],
        },
      ],
    },
    owner: residentBand("int32", new Int32Array(count).fill(-1)),
    river: residentBand("float64", new Float64Array(count)),
    coast: residentBand("float64", new Float64Array(count)),
    inherited: true,
    changed: new Set(),
    mediumChanged: new Set(),
  };
}
it("lets inherited works replace the child's own geography outside its initial selection", async () => {
  const { state, forest, world } = regionalFixture();
  const configured = configuration([invoke(societyPresent)]);
  configured.inputs = serializableBindings({
    seed: 42,
    quality: "draft",
    domains: ["physical", "magic", "built"],
    parameters: defaultAtlasParameters,
    settings: generationSettingsSchema.parse({
      epochs: [
        {
          id: "Supplied",
          duration: 1,
          tectonics: 0,
          hydrology: 0,
          ice: 0,
          coasts: 0,
          temperature: 15,
          seaLevel: 0,
        },
      ],
      humanEras: [],
      magicSystems: [],
    }),
    features: { selection: {}, diagnostics: [], parameters: defaultAtlasParameters },
  });
  const result = await new MapRunner(configured, registry(societyPresent)).run(state, options);
  expect(result.state.domain.world.features[forest.id]).toBeUndefined();
  expect(result.state.society!.region.works[0].applied).toBe(1);
  expect(world.areas.parent).toEqual(result.state.domain.world.areas.parent);
});
