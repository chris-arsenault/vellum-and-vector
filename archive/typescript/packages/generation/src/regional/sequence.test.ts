import { expect, it } from "vitest";
import type { AtlasGenerationInput } from "../atlasWorkflow";
import { resolveGenerationFeatures, type FeatureSelection } from "../features";
import { landscape } from "../mapFixtures";
import { physicalFeatureDefinitions } from "../physicalFeatures";
import { physicalFeatureSequence } from "../physicalFeatureSequence";
import { sequenceStages } from "../sequence";
import { rounds } from "./schedule";
import { regionalSequence } from "./sequence";

function composition(features: FeatureSelection = {}) {
  const source = landscape().domain;
  source.world.areas.area.profile = "region";
  const input: AtlasGenerationInput = {
    areaId: "area",
    domains: ["physical"],
    quality: "draft",
    seed: 73,
    resolvedFeatures: resolveGenerationFeatures(physicalFeatureDefinitions, features),
  };
  return { source, input, stages: sequenceStages(regionalSequence(source, input)) };
}

it.each([true, false])(
  "realizes captured Ground once independently of mountain selection: %s",
  (enabled) => {
    const { stages } = composition({ "physical.mountains": { enabled } }),
      ids = stages.flatMap(({ invocation }) => (invocation ? [invocation.process] : [])),
      relief = ids.indexOf("refinement.relief");
    expect(ids.filter((id) => id === "refinement.relief")).toHaveLength(1);
    expect(relief).toBeGreaterThan(ids.indexOf("refinement.context"));
    expect(relief).toBeLessThan(ids.indexOf("refinement.round"));
    expect(ids).not.toContain("atlas.refine-relief");
    expect(ids).not.toContain("atlas.orogenic-construction");
  }
);

it("retains the nonregional refinement contribution under its existing mountain feature", () => {
  const { source, input } = composition(),
    resolved = input.resolvedFeatures!,
    context = { source, input, resolved };
  expect(physicalFeatureSequence("terrain.refinement", resolved, context)).toMatchObject([
    { process: "atlas.refine-relief" },
  ]);
  const omitted = composition({ "physical.mountains": { enabled: false } });
  expect(
    physicalFeatureSequence("terrain.refinement", omitted.input.resolvedFeatures!, {
      source: omitted.source,
      input: omitted.input,
      resolved: omitted.input.resolvedFeatures!,
    })
  ).toEqual([]);
});

it("composes selected relaxation with local work exposure before each round's material work", () => {
  const { stages } = composition(),
    relaxations = stages.filter(
      ({ invocation }) => invocation?.process === "atlas.crustal-relaxation"
    );
  expect(relaxations).toHaveLength(rounds);
  for (const stage of relaxations) {
    expect(stage.epochs).toEqual([]);
    expect(stage.invocation?.parameters).toEqual({ workSpan: 1 / rounds });
    const occurrence = stage.path[0].split("/")[0],
      round = stages.filter((candidate) => candidate.path[0].startsWith(`${occurrence}/`)),
      ids = round.flatMap(({ invocation }) => (invocation ? [invocation.process] : []));
    expect(ids.indexOf("atlas.mass-wasting")).toBeGreaterThan(
      ids.indexOf("atlas.crustal-relaxation")
    );
    expect(ids.indexOf("atlas.lithospheric-flexure")).toBeGreaterThan(
      ids.indexOf("atlas.crustal-relaxation")
    );
  }
});

it("omits relaxation when its load-response feature is disabled", () => {
  const { stages } = composition({ "material.load-response": { enabled: false } });
  expect(stages.some(({ invocation }) => invocation?.process === "atlas.crustal-relaxation")).toBe(
    false
  );
});
