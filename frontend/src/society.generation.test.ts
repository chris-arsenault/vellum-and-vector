import { expect, it } from "vitest";
import { generateAtlas } from "@atlas/generation";
import { population } from "@atlas/domain";
import { newGenerationDraft, prepareDraft } from "./generationDraft";
import { generationSnapshot } from "./generationJobs";

it("delivers a populated world with retained society and environmental consequences", async () => {
  const draft = newGenerationDraft();
  draft.width = 3000000;
  draft.height = 2000000;
  draft.recipe.domains = ["physical", "magic", "cultural", "political", "built"];
  draft.recipe.quality = "draft";
  const { source, input, diagnostics } = prepareDraft(draft);
  expect(diagnostics.filter((d) => d.severity === "error")).toEqual([]);
  const start = performance.now();
  const result = await generateAtlas(source, input);
  const snapshot = generationSnapshot(result, input, crypto.randomUUID());
  const society = snapshot.world.societies![input.areaId];
  expect(society.communities.length).toBeGreaterThan(1);
  expect(society.communities.reduce((sum, c) => sum + population(c), 0)).toBeGreaterThan(0);
  expect(society.history).toHaveLength(source.world.humanEras!.length);
  expect(snapshot.world.fields.some((f) => f.channels?.includes("populationDensity"))).toBe(true);
  expect(Object.values(snapshot.world.features).some((f) => f.kind === "settlement")).toBe(true);
  for (const record of society.history)
    expect(record.before + record.births - record.deaths).toBeCloseTo(record.after, 4);
  console.log({
    elapsedMs: Math.round(performance.now() - start),
    communities: society.communities.length,
    population: Math.round(society.communities.reduce((sum, c) => sum + population(c), 0)),
    works: society.works.length,
    events: society.events.length,
  });
}, 180000);
