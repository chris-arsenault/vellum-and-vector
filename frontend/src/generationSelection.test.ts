import { expect, it } from "vitest";
import { atlasConfiguration, prepareAtlasGeneration } from "@atlas/generation";
import { physicalFeatureDefinitions } from "../../packages/generation/src/physicalFeatures";
import { sequenceStages } from "../../packages/generation/src/sequence";
import { selectedAtlasChannels } from "../../packages/generation/src/canonry/atlasPublications";
import { constructedWorld } from "./constructedWorldFixture";

const omissions = [
  "physical.tectonic-history",
  "physical.mountains",
  "physical.volcanism",
  "physical.impacts",
  "physical.hillslopes",
  "physical.continental-margins",
  "physical.coastal-construction",
  "physical.fractures",
  "physical.geothermal",
  "physical.ocean-circulation",
  "physical.river-incision",
  "physical.glacial-sculpting",
  "physical.sea-ice",
  "physical.coastal-evolution",
  "physical.deltas",
  "physical.landforms",
];
it.each(physicalFeatureDefinitions.filter((feature) => omissions.includes(feature.id)))(
  "removes $id from execution and publication without running a world",
  (feature) => {
    const { source, input } = constructedWorld();
    source.world.magicSystems = [];
    source.world.humanEras = [];
    const prepared = prepareAtlasGeneration(source, {
      ...input,
      features: { [feature.id]: { enabled: false } },
    });
    expect(prepared.diagnostics.filter((item) => item.severity === "error")).toEqual([]);
    const calls = sequenceStages(prepared.input.configuration!.sequence).map(
      (stage) => stage.invocation?.process
    );
    for (const process of feature.processes) expect(calls).not.toContain(process);
    const selected = prepared.input.resolvedFeatures!;
    expect(selected.selection[feature.id].enabled).toBe(false);
    const channels = selectedAtlasChannels(selected).map((binding) => binding.name);
    const absent: Record<string, string[]> = {
      "physical.impacts": ["impactExcavation", "impactRim"],
      "physical.volcanism": ["volcanicConstruction"],
      "physical.glacial-sculpting": ["glacialErosion", "glacialDeposition"],
      "physical.coastal-evolution": ["coastalErosion"],
    };
    for (const channel of absent[feature.id] ?? []) expect(channels).not.toContain(channel);
  }
);

it("binds changed physical and society settings and rejects invalid inputs before execution", () => {
  const { source, input } = constructedWorld();
  const parameters = {
    landFraction: 0.7,
    temperature: 30,
    rainfall: 0.2,
    cultureCount: 2,
    polityCount: 2,
  };
  expect(atlasConfiguration(source, { ...input, parameters }).parameters).toMatchObject(parameters);
  expect(() =>
    prepareAtlasGeneration(source, { ...input, parameters: { rainfall: -1 } })
  ).toThrow();
});
