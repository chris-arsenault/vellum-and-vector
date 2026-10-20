import { expect, it } from "vitest";
import { rectangle } from "@atlas/domain";
import { prepareAtlasGeneration } from "./atlasWorkflow";
import { physicalFeatureDefinitions } from "./physicalFeatures";
import { nativeContracts } from "./canonry/contracts";
import { landscape } from "./mapFixtures";
import { sequenceStages } from "./sequence";

function source() {
  const domain = landscape().domain;
  domain.world.id = domain.scope.worldId = "00000000-0000-4000-8000-000000000001";
  const footprint = rectangle([0, 0, 3_000_000, 2_000_000]);
  domain.scope.footprint = footprint;
  domain.world.reference.domain = footprint;
  domain.world.areas[domain.scope.areaId].footprint = footprint;
  domain.world.epochs = [
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
  domain.world.humanEras = [];
  domain.world.magicSystems = [];
  return domain;
}
function prepareOmission(id: string) {
  const domain = source();
  return prepareAtlasGeneration(domain, {
    areaId: domain.scope.areaId,
    seed: 73,
    quality: "draft",
    domains: ["physical"],
    features: { [id]: { enabled: false } },
  });
}

it("assigns every reference operation to exactly one feature implementation", () => {
  const processes = physicalFeatureDefinitions.flatMap((feature) => feature.processes);
  expect([...processes].sort()).toEqual(
    Object.keys(nativeContracts)
      .map((name) => `canonry.${name}`)
      .sort()
  );
});

it.each(physicalFeatureDefinitions)(
  "preflights omission of $id with its real consumers",
  (feature) => {
    const prepared = prepareOmission(feature.id);
    const dependencies = prepared.diagnostics.filter((item) => item.code === "feature_dependency");
    if (prepared.diagnostics.length) {
      expect(dependencies.some((item) => item.resource === feature.id)).toBe(true);
      expect(dependencies.every((item) => item.invocation && item.resource && item.message)).toBe(
        true
      );
      return;
    }
    const invocations = sequenceStages(prepared.input.configuration!.sequence).flatMap((stage) =>
      stage.invocation ? [stage.invocation.process] : []
    );
    expect(invocations.filter((process) => feature.processes.includes(process))).toEqual([]);
  }
);

it("keeps initial crust but omits the complete epoch crust update when tectonic evolution is disabled", () => {
  const prepared = prepareOmission("physical.tectonic-history");
  expect(prepared.diagnostics).toEqual([]);
  const stages = sequenceStages(prepared.input.configuration!.sequence);
  expect(
    stages.some(
      (stage) => stage.invocation?.process === "canonry.tectonic-provinces" && !stage.epochs.length
    )
  ).toBe(true);
  expect(
    stages.some(
      (stage) => stage.invocation?.process === "canonry.tectonic-uplift" && stage.epochs.length
    )
  ).toBe(false);
});
