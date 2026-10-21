import { expect, it } from "vitest";
import { generateAtlas } from "@atlas/generation";
import { rectangle } from "@atlas/domain";
import {
  newGenerationDraft,
  normalizeGenerationDraft,
  prepareDraft,
  setFeatureSetting,
} from "./generationDraft";
import { applyCartographicChoice, cartographicControls } from "./cartographicDraft";
import {
  draftEpochs,
  replaceDraftEpochs,
  renameDraftEpoch,
  updateEcologyEpoch,
} from "./generationDraftEpochs";
import { registerWorldSnapshot, session } from "./atlasState";
import { commitCommand } from "./atlasCommands";
import { generationSnapshot } from "./generationJobs";

it("generates an owned workflow recipe and refines a region without replaying its completed history", async () => {
  let draft = newGenerationDraft();
  draft = {
    ...draft,
    name: "Workflow geography",
    height: 2_000_000,
    recipe: { ...draft.recipe, domains: ["physical"], quality: "draft" },
  };
  draft = replaceDraftEpochs(draft, [{ ...draftEpochs(draft)[0], duration: 2500 }]);
  draft = renameDraftEpoch(draft, "Formation", "First landscape");
  draft = updateEcologyEpoch(draft, "First landscape", { migration: 1.4 });
  for (const [id, value] of [
    ["event-geography", "volcanic"],
    ["river-terrain", "plains"],
  ])
    draft = applyCartographicChoice(
      draft,
      cartographicControls().find((item) => item.id === id)!,
      value
    );
  draft = setFeatureSetting(draft, "physical.volcanism", "volcanism", 0.8);
  const reviewed = prepareDraft(draft);
  expect(reviewed.diagnostics.filter((item) => item.severity === "error")).toEqual([]);
  const world = registerWorldSnapshot(reviewed.source);
  expect(world.id).toBe(draft.worldId);
  const result = await generateAtlas(reviewed.source, reviewed.input);
  expect(result.state.surface.channels.elevation.every(Number.isFinite)).toBe(true);
  const parent = generationSnapshot(result, reviewed.input, crypto.randomUUID());
  session(world.id).snapshot = parent;
  const created = commitCommand(world.id, {
    operationId: crypto.randomUUID(),
    expectedVersion: parent.world.version,
    kind: "createArea",
    data: {
      parentId: reviewed.input.areaId,
      name: "Local landscape",
      profile: "region",
      footprint: rectangle([1000, 1000, 21000, 21000]),
      frame: { origin: { x: 1000, y: 1000, z: 0 }, rotation: 0, metresPerUnit: 1, floor: null },
      approach: "manual",
      traits: [],
    },
  }).candidate;
  const area = Object.values(created.areas).find(
    (item) => item.parentId === reviewed.input.areaId
  )!;
  const source = session(world.id).snapshot;
  const local = prepareDraft(normalizeGenerationDraft(draft, source), source, area.id);
  expect(local.diagnostics.filter((item) => item.severity === "error")).toEqual([]);
  expect(local.input.settings).toEqual(reviewed.input.settings);
  const refined = await generateAtlas(local.source, local.input);
  expect(refined.state.domain.world.epochs).toEqual(parent.world.epochs);
  expect(refined.state.domain.world.areas[area.id].boundary).toEqual(area.boundary);
  expect(refined.state.surface.channels.elevation.every(Number.isFinite)).toBe(true);
  expect(refined.state.domain.world.generations).toEqual(source.world.generations);
}, 180000);
