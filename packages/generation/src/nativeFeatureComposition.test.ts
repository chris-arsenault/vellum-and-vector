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
import { executeProcessBehavior } from "./processTraits";
import { worldGenerationSettings } from "./generationSettings";
import { atlasConfiguration } from "./atlasWorkflow";
import { sequenceStages } from "./sequence";
import { allSteps, physicalSteps, withPlateDeformation } from "./world/physicalSteps";
import { physicalContext } from "./world/context";
import { respondersTo, type AnswerKey } from "./coupling/answers";

it("passes the movement interval and operation salt to embedded deformation", () => {
  const run = vi.fn(),
    map = createField(createWorldMesh([0, 0, 1000, 1000], 16, 0)),
    context = physicalContext(73, 0, map.scale.resolve(physicalProfile)),
    moving = withPlateDeformation(map, context, [["probe", 7, run, []]]);
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
      run,
    }),
    feature = physicalFeature("test.native", "Native probe", {
      "epoch.incision": [[step("probe-step", 7, probe), { unforced: true }]],
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
  map.ExternalHeatForcing.fill(1);
  await executeProcessBehavior(registry.get(invocation.process, invocation.version), state, {
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
  expect(map.ExternalHeatForcing.get(0)).toBe(0);
});
