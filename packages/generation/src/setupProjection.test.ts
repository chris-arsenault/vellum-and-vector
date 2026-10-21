import { expect, it } from "vitest";
import { builtinLayers, putChannel, rectangle } from "@atlas/domain";
import { atlasFeatureDefinitions, prepareAtlasGeneration } from "./atlasWorkflow";
import { atlasGenerationModules } from "./atlasModules";
import { landscape, source as locatedSource } from "./mapFixtures";
import { projectGenerationSetup } from "./setupProjection";
import type { FeatureSelection } from "./features";
import type { GenerationModule } from "./generationModules";
import { sequenceStages } from "./sequence";

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

it("places every current capability once and projects its actual operations and output bindings", () => {
  const resolved = prepared(),
    view = projectGenerationSetup(resolved);
  expect(resolved.diagnostics).toEqual([]);
  expect(view.features).toHaveLength(32);
  expect(new Set(view.features.map((item) => item.id)).size).toBe(32);
  expect(atlasFeatureDefinitions.every((item) => item.presentation)).toBe(true);
  expect(new Set(view.features.map((item) => item.presentation.stage))).toEqual(
    new Set(["world", "land", "environment", "magic", "people"])
  );
  const sculpting = feature(view, "physical.glacial-sculpting");
  expect(sculpting.invocations.map((item) => item.process)).toEqual([
    "canonry.glacial-erosion",
    "canonry.glacial-deposition",
    "canonry.glacial-landforms",
  ]);
  expect(sculpting.invocations[0].behavior).toBe("material-transformation");
  expect(sculpting.invocations[0].inputs.map((item) => item.product)).toContain("canonry:LandIce");
  expect(
    sculpting.publications.some(
      (item) => item.kind === "field" && item.channel === "glacialErosion"
    )
  ).toBe(true);
  expect(feature(view, "water.routing").requiredBy).toContain("physical.river-networks");
  expect(
    feature(view, "built.layout").publications.some((item) => item.layer.id === "settlements")
  ).toBe(true);
  expect(
    feature(view, "built.layout").publications.some((item) => item.layer.id === "structures")
  ).toBe(false);
});

it("retains occurrence identity and separates elapsed responses from present classification", () => {
  const state = world();
  state.domain.world.epochs.push({ ...state.domain.world.epochs[0], id: "Later", duration: 2000 });
  const view = projectGenerationSetup(
    prepareAtlasGeneration(state.domain, {
      areaId: "area",
      seed: 73,
      quality: "draft",
      domains: ["physical"],
    })
  );
  const ecology = feature(view, "ecology.living").invocations;
  expect(ecology.find((item) => item.process === "atlas.ecology-evolve")).toMatchObject({
    behavior: "elapsed",
    durationYears: 500,
    boundDurationYears: 500,
    epochs: [{ id: "Formation", duration: 1000 }],
  });
  expect(ecology.find((item) => item.process === "atlas.ecology-respond")?.durationYears).toBe(500);
  expect(ecology.find((item) => item.process === "atlas.ecology-present")).toMatchObject({
    behavior: "model-pass",
    durationYears: null,
  });
  const ice = feature(view, "physical.land-ice").invocations.filter(
    (item) => item.process === "canonry.land-ice-mass-balance"
  );
  expect(ice.length).toBeGreaterThan(1);
  expect(new Set(ice.map((item) => item.key)).size).toBe(ice.length);
  expect(new Set(ice.map((item) => item.path.join("/"))).size).toBeLessThan(ice.length);
  expect(ice.every((item) => item.durationYears === null)).toBe(true);
});

it("keeps disabled choices and owned values visible without classifying them as unavailable", () => {
  const resolved = prepared({
    "physical.glacial-sculpting": { enabled: false, settings: { glaciers: 2.7 } },
  });
  const panel = feature(projectGenerationSetup(resolved), "physical.glacial-sculpting");
  expect(panel.status).toBe("off");
  expect(panel.settings[0]).toMatchObject({ key: "glaciers", value: 2.7, active: false });
  expect(panel.invocations).toEqual([]);
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
    reason: null,
  });
  expect(seaLevel.consumers.length).toBeGreaterThan(0);
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
  expect(climate.settings.find((item) => item.key === "temperature")?.active).toBe(true);
  expect(climate.settings.find((item) => item.key === "rainfall")?.active).toBe(true);
  expect(climate.settings.find((item) => item.key === "seaLevel")).toMatchObject({
    owner: "physical.climate",
    controlFeature: "ocean.geography",
    active: false,
  });
  expect(feature(view, "ecology.living").configurationEditable).toBe(false);
  expect(feature(view, "ecology.living").settings.every((item) => !item.active)).toBe(true);
  const response = view.invocations.find((item) => item.process === "atlas.ecology-evolve")!;
  expect(response).toMatchObject({ durationYears: 0, boundDurationYears: 500 });
  expect(response.durationNote).toContain("retains its age");
  const child = view.invocations.find((item) => item.reconciliation)!;
  expect(child.conditional).toBe(true);
  expect(child.path).toContain("reconciliation");
  expect(
    view.invocations.some((item) =>
      item.reconciliationContract?.guarantees.includes("canonry:IceFlow")
    )
  ).toBe(true);
});

it("marks reconciliation children skipped when their parent's condition does not match", () => {
  const resolved = region();
  for (const stage of sequenceStages(resolved.input.configuration!.sequence))
    if (stage.invocation?.process === "canonry.refine-water")
      stage.invocation.when = { variable: "requestedRepair", equals: true };
  const view = projectGenerationSetup(resolved),
    children = view.invocations.filter(
      (item) => item.reconciliation && item.path.includes("canonry.refine-water")
    );
  expect(children.length).toBeGreaterThan(0);
  expect(children.every((item) => !item.scheduled)).toBe(true);
  expect(view.invocations.find((item) => item.process === "canonry.refine-water")?.scheduled).toBe(
    false
  );
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
    expect(panel.presentation).toMatchObject({ stage: "world", family: "Additional capabilities" });
    expect(panel.settings[0]).toMatchObject({
      owner: panel.id,
      controlFeature: panel.id,
      value: 0.3,
      active: true,
    });
    expect(panel.requires).toEqual(["water.routing"]);
    expect(panel.invocations[0]).toMatchObject({
      feature: panel.id,
      behavior: "extract",
      parameters: { threshold: 0.3 },
      outputs: ["test:survey"],
    });
    expect(panel.publications[0].layer.id).toBe("survey");
    expect(feature(view, "water.routing").requiredBy).toContain(panel.id);
    panel.settings[0].value = 0.9;
    panel.invocations[0].inputs[0].product = "changed-view";
    expect(resolved.input.configuration).toEqual(before);
    const conflict = projectGenerationSetup(prepared({ "water.routing": { enabled: false } }));
    expect(feature(conflict, panel.id).diagnostics).toContainEqual(
      expect.objectContaining({ code: "feature_dependency", resource: "water.routing" })
    );
    expect(feature(conflict, "water.routing").diagnostics).toContainEqual(
      expect.objectContaining({ code: "feature_dependency", invocation: panel.id })
    );
  } finally {
    atlasGenerationModules.unregister(survey.id);
  }
});
