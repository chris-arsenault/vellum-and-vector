import { expect, it } from "vitest";
import {
  builtinLayers,
  putChannel,
  rectangle,
  canonryMagicPresets,
  spatial,
  type Landmark,
} from "@atlas/domain";
import { landmarksInExtent } from "./featureDependencies";
import { atlasFeatureDefinitions, prepareAtlasGeneration } from "./atlasWorkflow";
import { atlasGenerationModules } from "./atlasModules";
import { landscape, source as locatedSource } from "./mapFixtures";
import { projectGenerationSetup } from "./setupProjection";
import type { FeatureSelection } from "./features";
import type { GenerationModule } from "./generationModules";
import { z } from "zod";

function world() {
  const state = landscape();
  state.domain.world.magicSystems = [];
  state.domain.world.humanEras = [];
  state.domain.world.epochs = [
    {
      id: "Formation",
      duration: 1000,
      tectonics: 1,
      hydrology: 1,
      ice: 1,
      coasts: 1,
      temperature: 15,
      seaLevel: 0,
    },
  ];
  return state;
}
function prepared(features: FeatureSelection = {}) {
  const state = world();
  return prepareAtlasGeneration(state.domain, {
    areaId: "area",
    seed: 73,
    quality: "draft",
    domains: ["physical", "magic", "cultural", "political", "built"],
    features,
  });
}
function feature(view: ReturnType<typeof projectGenerationSetup>, id: string) {
  return view.features.find((item) => item.id === id)!;
}

it("projects each capability's operative controls and diagnostic ownership without a display catalogue", () => {
  const resolved = prepared(),
    view = projectGenerationSetup(resolved);
  expect(resolved.diagnostics).toEqual([]);
  expect(view.features).toHaveLength(33);
  expect(new Set(view.features.map((item) => item.id)).size).toBe(33);
  expect(
    atlasFeatureDefinitions.flatMap((item) => item.cartography ?? []).map((item) => item.id)
  ).toContain("terrain");
  const sculpting = feature(view, "physical.glacial-sculpting");
  expect(sculpting.invocationIds).toEqual([
    expect.stringContaining("glacial-erosion"),
    expect.stringContaining("glacial-deposition"),
    expect.stringContaining("glacial-landforms"),
  ]);
});

it("keeps disabled choices and owned values visible without classifying them as unavailable", () => {
  const resolved = prepared({
    "physical.glacial-sculpting": { enabled: false, settings: { glaciers: 2.7 } },
  });
  const panel = feature(projectGenerationSetup(resolved), "physical.glacial-sculpting");
  expect(panel.status).toBe("off");
  expect(panel.settings[0]).toMatchObject({ key: "glaciers", value: 2.7, active: false });
  expect(panel.invocationIds).toEqual([]);
  expect(resolved.input.resolvedFeatures!.selection[panel.id].settings.glaciers).toBe(2.7);
});

it("places the shared sea-level control with its scheduled ocean consumer while climate is off", () => {
  const resolved = prepared({
    "physical.climate": { enabled: false, settings: { seaLevel: 125 } },
  });
  const view = projectGenerationSetup(resolved),
    climate = feature(view, "physical.climate"),
    seaLevel = climate.settings.find((setting) => setting.key === "seaLevel")!;
  expect(climate.status).toBe("off");
  expect(feature(view, "ocean.geography").enabled).toBe(true);
  expect(seaLevel).toMatchObject({
    owner: "physical.climate",
    controlFeature: "ocean.geography",
    active: true,
    value: 125,
  });
  expect(climate.settings.find((setting) => setting.key === "temperature")?.active).toBe(false);
  expect(resolved.input.parameters?.seaLevel).toBe(125);
  expect(resolved.input.configuration!.inputs?.parameters).toMatchObject({ seaLevel: 125 });
  expect(
    feature(view, "ocean.geography").settings.some((setting) => setting.key === "seaLevel")
  ).toBe(false);
});

function region() {
  const state = world(),
    domain = state.domain;
  domain.world.areas.region = {
    ...structuredClone(domain.world.areas.area),
    id: "region",
    name: "New region",
    parentId: "area",
    profile: "region",
    footprint: rectangle([1000, 0, 3000, 1000]),
  };
  putChannel(state.surface, "impactExcavation", "metre", new Float64Array(10));
  putChannel(state.surface, "province", "category", new Float64Array(10));
  domain.world.fields.push({
    id: "parent",
    areaId: "area",
    layerId: "physical",
    algorithm: "generation",
    source: { kind: "run", id: "parent-run" },
    samples: 10,
    channels: Object.keys(state.surface.channels),
    resourceId: state.surface.id,
    state: "generated",
    footprint: domain.scope.footprint,
    spaceId: "surface",
  });
  domain.numerical.parent = state.surface;
  return prepareAtlasGeneration(domain, {
    areaId: "region",
    seed: 73,
    quality: "draft",
    domains: ["physical", "magic"],
  });
}
it("uses actual regional consumers and inherited fields rather than blanket geological labels", () => {
  const resolved = region(),
    view = projectGenerationSetup(resolved);
  expect(resolved.diagnostics).toEqual([]);
  expect(view.context.inherited).toBe(true);
  expect(feature(view, "physical.impacts").status).toBe("inherited");
  expect(feature(view, "physical.impacts").settings.every((item) => !item.active)).toBe(true);
  expect(feature(view, "physical.foundation").settings.every((item) => !item.active)).toBe(true);
  const climate = feature(view, "physical.climate");
  expect(climate.status).toBe("active");
  // Regional climate adapts inherited present fields; global baseline controls do not rerun.
  expect(climate.settings.find((item) => item.key === "temperature")?.active).toBe(false);
  expect(climate.settings.find((item) => item.key === "rainfall")?.active).toBe(false);
  expect(climate.settings.find((item) => item.key === "seaLevel")).toMatchObject({
    owner: "physical.climate",
    controlFeature: "ocean.geography",
    active: false,
  });
  for (const key of ["southLatitude", "northLatitude", "latitudeProjection"])
    expect(climate.settings.find((item) => item.key === key)?.active).toBe(false);
  expect(climate.settings.some((item) => item.key === "wrapLongitude")).toBe(false);
  expect(
    feature(view, "physical.foundation").settings.find((item) => item.key === "mapBoundary")?.active
  ).toBe(false);
  expect(feature(view, "ecology.living").configurationEditable).toBe(false);
  expect(feature(view, "ecology.living").settings.every((item) => !item.active)).toBe(true);
});

it("reports only located sources affecting this extent and does not imply that setup creates sources", () => {
  const empty = projectGenerationSetup(prepared());
  expect(feature(empty, "magic.local").status).toBe("unavailable");
  const state = world();
  state.domain.world.magic = [
    locatedSource(),
    locatedSource({ id: "other-space", spaceId: "elsewhere" }),
  ];
  const resolved = prepareAtlasGeneration(state.domain, {
    areaId: "area",
    seed: 73,
    quality: "draft",
    domains: ["physical", "magic"],
  });
  const view = projectGenerationSetup(resolved);
  expect(view.context.locatedSources).toBe(1);
  expect(feature(view, "magic.local").status).toBe("active");
});

it("counts the landmarks this extent already carries and keeps the generator's count control", () => {
  const empty = projectGenerationSetup(prepared());
  expect(empty.context.landmarks).toBe(0);
  expect(feature(empty, "physical.landmarks")).toMatchObject({ status: "active" });
  expect(
    feature(empty, "physical.landmarks").settings.map((setting) => [setting.key, setting.active])
  ).toEqual([
    ["landscapeLandmarks", true],
    ["magicLandmarks", true],
  ]);
  const state = world();
  const [x0, y0, x1, y1] = spatial.bounds(state.domain.world.areas.area.footprint);
  const landmark = (overrides: Partial<Landmark>): Landmark => ({
    id: crypto.randomUUID(),
    name: "Kibo",
    kind: "volcanic-mountain",
    geometry: { type: "Point", coordinates: [(x0 + x1) / 2, (y0 + y1) / 2] },
    parameters: { summit: 5900, prominence: 4000, baseRadius: 30 },
    emplacedAtEpoch: 0,
    ...overrides,
  });
  state.domain.world.landmarks = [
    landmark({}),
    landmark({ emplacedAtEpoch: 3 }),
    landmark({ geometry: { type: "Point", coordinates: [x1 + 1e6, y1 + 1e6] } }),
  ];
  const resolved = prepareAtlasGeneration(state.domain, {
    areaId: "area",
    seed: 73,
    quality: "draft",
    domains: ["physical"],
  });
  const view = projectGenerationSetup(resolved);
  expect(view.context.landmarks).toBe(1);
  expect(landmarksInExtent(resolved.source, resolved.input).map((l) => l.name)).toEqual(["Kibo"]);
});

const survey: GenerationModule = {
  id: "test.projection-survey",
  features: [
    {
      id: "test.projection-survey",
      label: "Survey",
      domains: ["physical"],
      defaultEnabled: true,
      settings: {
        threshold: {
          label: "Threshold",
          unit: "ratio",
          minimum: 0,
          maximum: 1,
          default: 0.5,
          step: 0.1,
          group: "water",
        },
      },
      requires: ["water.routing"],
      processes: ["test.measure"],
      slots: ["present.products"],
      contribute: (slot) =>
        slot === "present.products"
          ? [{ kind: "process", id: "measure", process: "test.measure", version: "1" }]
          : [],
    },
  ],
  processes: () => [
    {
      contract: {
        id: "test.measure",
        version: "1",
        parameters: { threshold: { type: "number", unit: "ratio", required: true } },
        requires: ["canonry:Elevation"],
        produces: ["test:survey"],
        invalidates: [],
      },
      behavior: { kind: "extract", extract() {} },
      validate: () => [],
    },
  ],
  publications: () => [
    {
      kind: "field",
      owners: ["test.projection-survey"],
      channel: "survey",
      unit: "ratio",
      quantity: "intensive",
      layer: {
        ...builtinLayers().find((layer) => layer.id === "climate")!,
        id: "survey",
        name: "Survey",
      },
    },
  ],
};
it("projects an independently registered scalar feature, prerequisites, diagnostics and outputs without alias edits", () => {
  atlasGenerationModules.register(survey);
  try {
    const resolved = prepared({ "test.projection-survey": { settings: { threshold: 0.3 } } });
    const before = structuredClone(resolved.input.configuration),
      view = projectGenerationSetup(resolved);
    const panel = feature(view, "test.projection-survey");
    expect(panel.settings[0]).toMatchObject({
      owner: panel.id,
      controlFeature: panel.id,
      value: 0.3,
      active: true,
    });
    expect(panel.invocationIds).toContainEqual(expect.stringContaining("measure"));
    panel.settings[0].value = 0.9;
    panel.invocationIds[0] = "changed-view";
    expect(resolved.input.configuration).toEqual(before);
    const conflict = prepared({ "water.routing": { enabled: false } });
    expect(conflict.diagnostics).toContainEqual(
      expect.objectContaining({ code: "feature_dependency", resource: "water.routing" })
    );
    expect(conflict.diagnostics).toContainEqual(
      expect.objectContaining({ code: "feature_dependency", invocation: panel.id })
    );
  } finally {
    atlasGenerationModules.unregister(survey.id);
  }
});

it("uses declared nested applicability and conditional prerequisites in inherited setup", () => {
  const module: GenerationModule = {
    ...survey,
    features: [
      {
        ...survey.features[0],
        configuration: z.object({ threshold: z.number() }),
        configurationFromLegacy: () => ({ threshold: 0.5 }),
        configurationPresentation: { applicability: "any" },
      },
    ],
  };
  atlasGenerationModules.register(module);
  try {
    const view = projectGenerationSetup(region());
    expect(feature(view, survey.id)).toMatchObject({
      configuration: { threshold: 0.5 },
      configurationPresentation: { applicability: "any" },
      configurationEditable: true,
    });
    expect(feature(view, "physical.lifecycle").configurationEditable).toBe(false);
  } finally {
    atlasGenerationModules.unregister(module.id);
  }
  const resolved = prepared({
    "physical.coastal-evolution": { enabled: false },
    "magic.configured": {
      configuration: { magicSystems: JSON.parse(JSON.stringify(canonryMagicPresets())) },
    },
  });
  expect(resolved.diagnostics).toContainEqual(
    expect.objectContaining({ code: "feature_dependency", resource: "physical.coastal-evolution" })
  );
});
