import { expect, it } from "vitest";
import { composeAuthoredSamples, validateAuthoredInputs } from "./mapAuthored";
import {
  putChannel,
  replaceChannel,
  overlayField,
  fieldInterpolator,
  createGrid,
  rectangle,
  type Layer,
} from "@atlas/domain";
import { landscape } from "./mapFixtures";
import { MapRunner } from "./mapRunner";
import { MapProcessRegistry, type MapProcess } from "./process";
import { resolveGenerationFeatures, type GenerationFeature } from "./features";
import { generatedFeature, putGenerated } from "./mapFeatures";
import {
  preparePublicationLayers,
  publishGenerationProducts,
  type FieldPublicationDefinition,
} from "./publication";

const layer: Layer = {
  id: "survey-analysis",
  name: "Survey analysis",
  family: "custom",
  representation: "field",
  representations: ["field"],
  color: "#9186a1",
  profiles: ["world", "region"],
  schema: {},
  generator: "test.survey",
  facts: ["surveyAccuracy"],
};
const output: FieldPublicationDefinition = {
  kind: "field",
  channel: "surveyAccuracy",
  unit: "ratio",
  quantity: "intensive",
  layer,
};

function initial() {
  const state = landscape(),
    id = "2f6e0134-6017-4e80-9196-052a12218500";
  state.domain.world.id = state.domain.scope.worldId = state.surface.scope.worldId = id;
  state.surface.channels = {};
  state.surface.units = {};
  state.facts.clear();
  state.publications = [structuredClone(output)];
  return state;
}
it("retains unchanged composed inputs but does not resurrect them after replacement", () => {
  const state = initial(),
    n = state.surface.active.length;
  putChannel(state.surface, "surveyAccuracy", "ratio", new Float64Array(n).fill(0.25));
  const inherited = structuredClone(state.surface);
  state.surface.channels.surveyAccuracy.fill(0);
  overlayField(state.surface, inherited, ["surveyAccuracy"], true);
  publishGenerationProducts(state, "first");
  const id = state.domain.world.fields[0].id;
  const p = { x: state.surface.bounds[0], y: state.surface.bounds[1], z: 0 };
  expect(fieldInterpolator(state.domain.numerical[id], "surveyAccuracy")(p)).toBe(0.25);
  replaceChannel(state.surface, "surveyAccuracy", "ratio", new Float64Array(n).fill(0.9));
  publishGenerationProducts(state, "second");
  expect(fieldInterpolator(state.domain.numerical[id], "surveyAccuracy")(p)).toBe(0.9);
  const authored = structuredClone(inherited);
  authored.channels.surveyAccuracy.fill(0.7);
  overlayField(state.domain.numerical[id], authored, ["surveyAccuracy"]);
  publishGenerationProducts(state, "third");
  expect(fieldInterpolator(state.domain.numerical[id], "surveyAccuracy")(p)).toBe(0.7);
});

it("keeps a protected parent patch between child samples in fresh published fields", () => {
  const state = initial(),
    name = "surveyAccuracy";
  putChannel(state.surface, name, "ratio", new Float64Array(10).fill(1));
  const parent = structuredClone(state.surface),
    patch = createGrid(
      "tiny-authored-resource",
      { ...parent.scope, footprint: rectangle([1999, 499, 2001, 501]) },
      3,
      3
    );
  putChannel(patch, name, "ratio", new Float64Array(9).fill(99));
  overlayField(parent, patch, [name]);
  state.domain.numerical[parent.id] = parent;
  state.domain.numerical[patch.id] = patch;
  state.domain.fieldPatches = [
    {
      id: "tiny-authored-patch",
      areaId: "area",
      fieldId: parent.id,
      resourceId: patch.id,
      channels: [name],
      footprint: patch.scope.footprint,
      spaceId: patch.scope.spaceId,
      protected: true,
      actor: "creator",
      createdVersion: 1,
    },
  ];
  state.surface.scope = { ...state.surface.scope, areaId: "child" };
  state.domain.scope = state.surface.scope;
  state.domain.world.areas.child = {
    ...state.domain.world.areas.area,
    id: "child",
    parentId: "area",
    profile: "region",
  };
  const original = structuredClone(state.domain),
    inside = { x: 2000, y: 500, z: 0 },
    outside = { x: 2100, y: 500, z: 0 };
  overlayField(state.surface, parent, [name], true);
  expect(fieldInterpolator(state.surface, name)(inside)).toBe(99);
  replaceChannel(state.surface, name, "ratio", new Float64Array(10).fill(2));
  composeAuthoredSamples(state, original);
  composeAuthoredSamples(state, original);
  expect("overlays" in state.surface && state.surface.overlays).toHaveLength(1);
  expect(state.surface.channels[name].every((value) => value === 2)).toBe(true);
  expect(fieldInterpolator(state.surface, name)(inside)).toBe(99);
  expect(fieldInterpolator(state.surface, name)(outside)).toBe(2);
  validateAuthoredInputs(state, original);
  publishGenerationProducts(state, "child-replacement");
  const field = state.domain.world.fields.find((candidate) => candidate.areaId === "child")!;
  expect(field).toBeDefined();
  const published = fieldInterpolator(state.domain.numerical[field.id], name);
  expect(published(inside)).toBe(99);
  expect(published(outside)).toBe(2);
  expect(fieldInterpolator(original.numerical[parent.id], name)(inside)).toBe(99);
});

function surveyModule() {
  const feature: GenerationFeature = {
    id: "test.survey",
    label: "Survey analysis",
    domains: ["physical"],
    defaultEnabled: true,
    settings: {
      precision: {
        label: "Survey precision",
        unit: "ratio",
        default: 0.5,
        minimum: 0,
        maximum: 1,
        step: 0.1,
        group: "geology",
      },
    },
    processes: ["test.survey.measure"],
    slots: ["present.products"],
    contribute: () => [
      {
        kind: "process",
        id: "present.survey.measure",
        process: "test.survey.measure",
        version: "1",
      },
    ],
  };
  const process: MapProcess = {
    contract: {
      id: "test.survey.measure",
      version: "1",
      requires: [],
      produces: ["test:survey"],
      invalidates: [],
      parameters: { precision: { type: "number", unit: "ratio", required: true } },
    },
    behavior: {
      kind: "model-pass",
      applyPass(state, context) {
        const precision = Number(context.parameters.precision);
        putChannel(
          state.surface,
          output.channel,
          output.unit,
          Float64Array.from(
            state.surface.active,
            (_, i) => (precision * (i + 1)) / state.surface.active.length
          )
        );
      },
    },
    validate: () => [],
  };
  return { feature, process, outputs: [output] };
}

it("publishes a registered new parameter, channel and layer without an atlas-specific binding", async () => {
  const module = surveyModule(),
    resolved = resolveGenerationFeatures([module.feature], {
      "test.survey": { settings: { precision: 0.25 } },
    });
  const result = await new MapRunner(
    {
      id: "test.survey",
      version: 1,
      parameters: resolved.selection["test.survey"].settings,
      sequence: module.feature.contribute("present.survey"),
    },
    new MapProcessRegistry().register(module.process)
  ).run(initial(), { seed: "73", seedScope: "survey" });
  const transferred = structuredClone(result);
  const layers = publishGenerationProducts(transferred.state, "survey-run"),
    snapshot = transferred.state.domain,
    field = snapshot.world.fields.find((field) => field.layerId === layer.id)!;
  expect(layers).toEqual(new Set([layer.id]));
  expect(snapshot.world.layers[layer.id]).toMatchObject({
    name: layer.name,
    generator: "test.survey",
    facts: [output.channel],
  });
  expect(field.channels).toEqual([output.channel]);
  expect(snapshot.numerical[field.id].channels[output.channel][0]).toBeCloseTo(0.025);
  expect(snapshot.numerical[field.id].channels[output.channel].at(-1)).toBe(0.25);
  expect(snapshot.numerical[field.id].units[output.channel]).toBe("ratio");
  expect(snapshot.numerical[field.id].quantities?.[output.channel]).toBe("intensive");
  expect(snapshot.coverage).toContainEqual(
    expect.objectContaining({ layerId: layer.id, state: "generated", generationId: "survey-run" })
  );
  expect(snapshot.world.areas.area.layers[layer.id]).toBe("generated");
  expect(Object.hasOwn(initial().domain.world.layers, layer.id)).toBe(false);
});

it("rejects an unregistered channel instead of classifying it as climate", () => {
  const state = initial();
  putChannel(state.surface, "unregisteredOutput", "ratio", new Float64Array(10).fill(1));
  expect(() => publishGenerationProducts(state, "unknown-run")).toThrow("unregisteredOutput");
  expect(state.domain.world.fields).toEqual([]);
  expect(state.domain.coverage).toEqual([]);
});

it("distinguishes a declared inactive working buffer from a requested geographic output", () => {
  const state = initial();
  state.publications = [{ ...output, publish: false }];
  putChannel(state.surface, output.channel, output.unit, new Float64Array(10).fill(1));
  expect(publishGenerationProducts(state, "inactive-run")).toEqual(new Set());
  expect(state.domain.world.fields).toEqual([]);
  expect(state.domain.coverage).toEqual([]);
  expect(state.domain.world.layers[layer.id]).toBeUndefined();
});

it("validates units and quantity semantics from the registered product", () => {
  const wrongUnit = initial();
  putChannel(wrongUnit.surface, output.channel, "metre", new Float64Array(10).fill(1));
  expect(() => publishGenerationProducts(wrongUnit, "wrong-unit")).toThrow("requires ratio");
  const wrongQuantity = initial();
  putChannel(
    wrongQuantity.surface,
    output.channel,
    output.unit,
    new Float64Array(10).fill(1),
    "extensive"
  );
  expect(() => publishGenerationProducts(wrongQuantity, "wrong-quantity")).toThrow(
    "requires intensive"
  );
});

it("combines declared channels on one layer and preserves existing cartographic customization", () => {
  const state = initial();
  state.domain.world.layers[layer.id] = {
    ...layer,
    name: "My survey layer",
    color: "#123456",
    representations: ["vector", "field"],
    facts: ["authoredSurveyNote"],
  };
  state.publications = [output, { ...output, channel: "surveyConfidence" }];
  putChannel(state.surface, output.channel, output.unit, new Float64Array(10).fill(0.25));
  putChannel(state.surface, "surveyConfidence", output.unit, new Float64Array(10).fill(0.75));
  publishGenerationProducts(state, "shared-layer");
  const fields = state.domain.world.fields.filter((field) => field.layerId === layer.id);
  expect(fields).toHaveLength(1);
  expect(fields[0].channels).toEqual([output.channel, "surveyConfidence"]);
  expect(state.domain.world.layers[layer.id]).toMatchObject({
    name: "My survey layer",
    color: "#123456",
    representations: ["vector", "field"],
    facts: ["authoredSurveyNote", output.channel, "surveyConfidence"],
  });
  expect(state.domain.coverage).toHaveLength(1);
});

it.each([
  { family: "other-family" },
  { generator: "other.generator" },
  { schema: { classification: { type: "string", required: true } } },
])("rejects an existing layer with incompatible structural metadata: %j", (conflict) => {
  const state = initial();
  state.domain.world.layers[layer.id] = { ...layer, ...conflict };
  const original = structuredClone(state.domain.world.layers[layer.id]);
  putChannel(state.surface, output.channel, output.unit, new Float64Array(10).fill(1));
  expect(() =>
    preparePublicationLayers(state.domain, state.publications!, state.domain.scope.areaId)
  ).toThrow("registered family, generator and attribute schema");
  expect(() => publishGenerationProducts(state, "conflicting-existing-layer")).toThrow(
    "registered family, generator and attribute schema"
  );
  expect(state.domain.world.layers[layer.id]).toEqual(original);
  expect(state.domain.world.fields).toEqual([]);
  expect(state.domain.coverage).toEqual([]);
});

it("rejects incompatible registrations for the same layer or channel", () => {
  const state = initial();
  state.publications = [output, { ...output, layer: { ...layer, name: "Conflicting layer" } }];
  expect(() => publishGenerationProducts(state, "conflicting-layer")).toThrow(
    "one compatible definition"
  );
  state.publications = [output, { ...output, unit: "metre" }];
  expect(() => publishGenerationProducts(state, "conflicting-channel")).toThrow(
    "one publication binding"
  );
});

it("rejects new undeclared geographic kinds while retaining unchanged original geography", () => {
  const state = initial();
  const feature = generatedFeature(
    state,
    "new-survey-marker",
    "Survey station",
    "surveyMarker",
    layer.id,
    { type: "Point", coordinates: [100, 100] }
  );
  state.domain.world.features[feature.id] = feature;
  expect(() => publishGenerationProducts(state, "unknown-kind")).toThrow("surveyMarker");
  const original = structuredClone(state.domain);
  expect(publishGenerationProducts(state, "retained-geography", original)).toEqual(new Set());
  state.publications = [
    {
      kind: "geography",
      layer: { ...layer, representation: "vector", representations: ["vector"] },
      featureKinds: ["surveyMarker"],
    },
  ];
  expect(publishGenerationProducts(state, "registered-geography")).toEqual(new Set([layer.id]));
  expect(state.domain.coverage).toContainEqual(expect.objectContaining({ layerId: layer.id }));
});

it("registers a new vector layer before common extractor validation and worker transfer", async () => {
  const state = initial(),
    definition = { ...layer, representation: "vector", representations: ["vector" as const] };
  state.publications = [{ kind: "geography", layer: definition, featureKinds: ["surveyStation"] }];
  const process: MapProcess = {
    contract: {
      id: "test.survey.extract",
      version: "1",
      parameters: {},
      requires: [],
      produces: ["test:survey-stations"],
      invalidates: [],
    },
    behavior: {
      kind: "extract",
      extract(candidate) {
        putGenerated(
          candidate,
          generatedFeature(
            candidate,
            "survey-station",
            "Survey station",
            "surveyStation",
            layer.id,
            { type: "Point", coordinates: [100, 100] }
          )
        );
      },
    },
    validate(candidate) {
      expect(candidate.domain.world.layers[layer.id].representation).toBe("vector");
      return [];
    },
  };
  const result = await new MapRunner(
    {
      id: "survey-extraction",
      version: 1,
      parameters: {},
      sequence: [
        {
          kind: "process",
          id: "present.survey.extract",
          process: process.contract.id,
          version: "1",
        },
      ],
    },
    new MapProcessRegistry().register(process)
  ).run(state, { seed: "73", seedScope: "survey" });
  const transferred = structuredClone(result);
  publishGenerationProducts(transferred.state, "survey-vector", state.domain);
  const feature = Object.values(transferred.state.domain.world.features)[0];
  expect(feature.generationDomain).toBe("test.survey");
  expect(transferred.state.domain.coverage).toContainEqual(
    expect.objectContaining({ layerId: layer.id })
  );
  expect(state.domain.world.layers[layer.id]).toBeUndefined();
});
