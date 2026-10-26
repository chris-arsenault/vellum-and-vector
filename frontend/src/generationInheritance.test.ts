import { expect, it } from "vitest";
import { createGrid, rectangle, resampleChannels } from "@atlas/domain";
import { prepareAtlasGeneration, type GenerationState } from "@atlas/generation";
import { createAtlasWorkspace } from "../../packages/generation/src/canonry/atlasWorkspace";
import { sequenceStages } from "../../packages/generation/src/sequence";
import { generationSnapshot } from "./generationJobs";
import { constructedWorld } from "./constructedWorldFixture";

it("inherits impact history and fixed geography from supplied parent cells with new impacts disabled", () => {
  const { input, result } = constructedWorld();
  const parent = generationSnapshot(result, input, crypto.randomUUID());
  const before = structuredClone(parent);
  const domain = structuredClone(parent);
  const areaId = crypto.randomUUID();
  const footprint = rectangle([2200, 100, 3800, 900]);
  domain.world.areas[areaId] = {
    ...domain.world.areas[input.areaId],
    id: areaId,
    name: "Constructed child",
    parentId: input.areaId,
    profile: "region",
    footprint,
    boundary: null,
  };
  domain.scope = { ...domain.scope, areaId, footprint };
  const surface = createGrid("child", domain.scope, 4, 4);
  resampleChannels(result.state.surface, surface);
  const state: GenerationState = { domain, surface, facts: new Set(), history: [] };
  const work = createAtlasWorkspace(state, "draft");
  expect(work.inherited).toBe(true);
  expect(work.map.ImpactExcavation.some((value) => value > 0)).toBe(true);
  expect(work.map.AvailableFacts.has("Impacts")).toBe(true);
  expect(work.map.Elevation.every(Number.isFinite)).toBe(true);
  expect(work.map.SeaLevelInitialized).toBe(true);
  const prepared = prepareAtlasGeneration(domain, {
    ...input,
    areaId,
    features: { "physical.impacts": { enabled: false } },
  });
  expect(
    sequenceStages(prepared.input.configuration!.sequence).map((stage) => stage.invocation?.process)
  ).not.toContain("canonry.impact-cratering");
  expect(state.domain.world.epochs).toEqual(before.world.epochs);
  expect(parent).toEqual(before);
});
