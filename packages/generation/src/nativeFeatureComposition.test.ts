import { expect, it, vi } from "vitest";
import { featureContribution, resolveGenerationFeatures } from "./features";
import { physicalFeature, nativeStepsOf } from "./physicalFeature";
import { step } from "./world/sequence";
import { defineProcess } from "./processes/groundProcess";
import { nativeProcess } from "./world/atlasProcesses";
import { createField } from "./world/field";
import { createWorldMesh } from "./world/worldMesh";
import { physicalProfile } from "./world/profile";
import { landscape } from "./mapFixtures";
import { MapProcessRegistry } from "./process";
import { executeMapOperation } from "./processTraits";
import { worldGenerationSettings } from "./generationSettings";
import { atlasConfiguration } from "./atlasWorkflow";
import { sequenceStages } from "./sequence";
import { allSteps, physicalSteps, withPlateDeformation } from "./world/physicalSteps";
import { physicalContext } from "./world/context";
import { respondersTo, type AnswerKey } from "./coupling/answers";
import type { FeatureContributionContext } from "./features";
import { atlasGenerationModules } from "./generationModules";
import { bindFeatureQueries } from "./physicalFeatureSequence";
import { fieldQuery } from "./processes/builder";
import { defineCommand, readOperation } from "./processOperation";
import type { PhysicalInput } from "./processes/groundProcess";

it("installs selected module-owned query implementations without editing built-in consumers", () => {
  const read = vi.fn(),
    operation = fieldQuery(
      { id: "extension-read", statement: "Supplied module query.", execute: read },
      []
    );
  const feature = physicalFeature("test.query-extension", "Extension", {
    "present.landforms": [step("extension-read", 7, operation)],
  });
  atlasGenerationModules.register({ id: "test.query-extension", features: [feature] });
  try {
    const map = createField(createWorldMesh([0, 0, 1000, 1000], 16, 0));
    const selected = resolveGenerationFeatures([feature], {}, {}, ["physical"]);
    bindFeatureQueries(map, selected, 1);
    const profile = map.scale.resolve(physicalProfile);
    readOperation(map, operation.operation, {
      map,
      context: physicalContext(1, 91, profile, null, 2),
    });
    expect(read).toHaveBeenCalledOnce();
    const expected = physicalContext(1, 7, profile, null, 2);
    expect(read).toHaveBeenCalledWith({
      map,
      context: expect.objectContaining({
        Seed: expected.Seed,
        EpochStableSeed: expected.EpochStableSeed,
        EpochIndex: 2,
        Profile: profile,
        Span: 0,
      }),
    });
  } finally {
    atlasGenerationModules.unregister("test.query-extension");
  }
});

it("selects shared, specialized and captured operations through the same feature contract", () => {
  const captured = physicalFeature(
      "test.captured",
      "Captured",
      { "formation.foundation": ["formation"] },
      { regional: { kind: "captured" } }
    ),
    specialized = physicalFeature(
      "test.local",
      "Local",
      { "climate.atmosphere": ["climate"], "water.routing": ["routing"] },
      {
        regional: {
          kind: "specialized",
          operations: { "climate.atmosphere": ["refinement.climate"] },
        },
      }
    ),
    definitions = [captured, specialized],
    resolved = resolveGenerationFeatures(definitions, {}, {}, ["physical"]),
    source = landscape().domain,
    context: FeatureContributionContext = {
      source,
      input: { areaId: source.scope.areaId, seed: 1, quality: "draft", domains: ["physical"] },
      resolved,
      execution: "regional",
    },
    processes = (feature: typeof captured, slot: string, selected = resolved) =>
      featureContribution(feature, slot, selected, { ...context, resolved: selected }).map(
        (node) => (node.kind === "process" ? node.process : "epochs")
      );
  expect(processes(captured, "formation.foundation")).toEqual([]);
  expect(processes(specialized, "climate.atmosphere")).toEqual(["refinement.climate"]);
  expect(processes(specialized, "water.routing")).toEqual(["atlas.routing"]);
  expect(
    featureContribution(specialized, "climate.atmosphere", resolved, {
      ...context,
      execution: "world",
    })
  ).toEqual([expect.objectContaining({ process: "atlas.climate" })]);
  expect(
    processes(
      specialized,
      "climate.atmosphere",
      resolveGenerationFeatures(definitions, { "test.local": { enabled: false } }, {}, ["physical"])
    )
  ).toEqual([]);
});

it("passes the movement interval and operation salt to embedded deformation", () => {
  const run = vi.fn(),
    map = createField(createWorldMesh([0, 0, 1000, 1000], 16, 0)),
    context = physicalContext(73, 0, map.scale.resolve(physicalProfile)),
    moving = withPlateDeformation(map, context, [
      [
        "probe",
        7,
        defineCommand("probe", "event", ({ map, context }: PhysicalInput) => run(map, context), []),
        [],
      ],
    ]);
  moving.DuringPlateStep!({ ...context, Span: 0.125, TectonicDurationMyr: 2.5 });
  expect(run).toHaveBeenCalledWith(
    map,
    expect.objectContaining({
      Span: 0.125,
      TectonicDurationMyr: 2.5,
      Seed: context.Seed ^ 7,
      EpochStableSeed: context.EpochStableSeed ^ 7,
    })
  );
});

it("has each key's base answer written before the first step that asks it", () => {
  // A band no land step writes comes from another domain's previous pass, such as plant cover.
  const domain = landscape().domain;
  domain.world.epochs = [
    {
      id: "epoch",
      tectonics: 1,
      hydrology: 1,
      ice: 1,
      coasts: 1,
      temperature: 15,
      seaLevel: 0,
    },
  ];
  const sequence = atlasConfiguration(domain, {
      areaId: domain.scope.areaId,
      seed: 1,
      quality: "draft",
      domains: ["physical"],
    }).sequence,
    byName = new Map(allSteps.map((step) => [`atlas.${step[0]}`, step])),
    schedule = sequenceStages(sequence).flatMap(({ invocation }) => {
      const step = invocation && byName.get(invocation.process);
      return step ? [step] : [];
    }),
    landWritten = new Set(schedule.flatMap((step) => physicalSteps[step[0]].writes)),
    written = new Set<string>(),
    late: string[] = [],
    baseReads = (key: AnswerKey) => respondersTo(key).find((one) => "base" in one)?.reads ?? [];
  for (const step of schedule) {
    for (const key of new Set(step[3].flatMap((process) => process.asks)))
      for (const band of baseReads(key))
        if (landWritten.has(band) && !written.has(band))
          late.push(`${step[0]} asks ${key} before ${band} is written`);
    for (const band of physicalSteps[step[0]].writes) written.add(band);
  }
  expect([...new Set(late)]).toEqual([]);
});

it("dispatches a selected native feature through the registry derived from its operations", async () => {
  const run = vi.fn(),
    probe = defineProcess({
      id: "probe",
      statement: "Composition-only probe.",
      reads: [],
      asks: [],
      moves: [],
      settings: {},
      prepare: () => ({}),
      execute: run,
    }),
    feature = physicalFeature("test.native", "Native probe", {
      "epoch.incision": [[step("probe-step", 7, probe), { initial: true }]],
    }),
    resolve = (enabled: boolean) =>
      resolveGenerationFeatures([feature], { "test.native": { enabled } }, {}, ["physical"]),
    selected = featureContribution(feature, "epoch.incision", resolve(true)),
    omitted = featureContribution(feature, "epoch.incision", resolve(false)),
    registry = nativeStepsOf([feature]).reduce(
      (entries, native) => entries.register(nativeProcess(native)),
      new MapProcessRegistry()
    );
  expect(selected).toHaveLength(1);
  expect(omitted).toEqual([]);
  const invocation = selected[0];
  if (invocation.kind !== "process") throw new Error("Expected native invocation");
  const state = landscape(),
    map = createField(createWorldMesh([0, 0, 1_000, 1_000], 16, 0));
  state.domain.world.epochs = [
    {
      id: "probe",
      tectonics: 1,
      hydrology: 1,
      ice: 1,
      coasts: 1,
      temperature: 15,
      seaLevel: 0,
    },
  ];
  state.physical = {
    map,
    profile: map.scale.resolve(physicalProfile),
    samples: state.surface.coverage.scratch("int32", "probe:samples", 0),
    grid: state.surface.coverage,
    fixed: [],
    inherited: false,
  };
  await executeMapOperation(registry.get(invocation.process, invocation.version).operation, state, {
    scope: state.domain.scope,
    invocation: [invocation.id],
    parameters: invocation.parameters ?? {},
    inputs: {
      seed: 73,
      settings: JSON.parse(JSON.stringify(worldGenerationSettings(state.domain.world))),
      features: JSON.parse(JSON.stringify(resolve(true))),
    },
    epochs: [],
    epochIndices: [],
    causes: [],
    recordCause() {},
    random: () => 0.5,
    cancelled: () => false,
    progress() {},
  });
  expect(run).toHaveBeenCalledOnce();
  expect(run).toHaveBeenCalledWith(
    expect.objectContaining({
      field: map,
    })
  );
  expect(invocation.parameters).toEqual({ initial: true });
});
