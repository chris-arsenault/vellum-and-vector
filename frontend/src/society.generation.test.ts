import { expect, it } from "vitest";
import { generateAtlas } from "@atlas/generation";
import { population, languageUse, isSocietyWork, type DomainSnapshot } from "@atlas/domain";
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
  checkLinguisticPublication(snapshot, input.areaId);
  const society = snapshot.world.societies![input.areaId];
  expect(society.communities.length).toBeGreaterThan(1);
  expect(society.communities.reduce((sum, c) => sum + population(c), 0)).toBeGreaterThan(0);
  expect(society.history).toHaveLength(source.world.humanEras!.length);
  expect(society.history.every((era) => (era.cycles ?? 0) > 1)).toBe(true);
  expect(
    society.communities.some((c) =>
      c.history!.some((s, i, h) => i > 0 && s.population > h[i - 1].population)
    )
  ).toBe(true);
  expect(snapshot.world.fields.some((f) => f.channels?.includes("populationDensity"))).toBe(true);
  expect(Object.values(snapshot.world.features).some((f) => f.kind === "settlement")).toBe(true);
  for (const community of society.communities)
    expect(community.name).not.toMatch(/\d|Name-|markov:|slot:/);
  const polities = Object.values(snapshot.world.entities).filter(
    (entity) => entity.kind === "polity"
  );
  expect(polities.length).toBeGreaterThan(0);
  for (const entity of polities) {
    expect(entity.name).not.toMatch(/^Polity \d/);
    expect(typeof entity.attributes.namingCulture).toBe("string");
  }
  for (const record of society.history)
    expect(record.before + record.births - record.deaths).toBeCloseTo(record.after, 4);
  console.log({
    elapsedMs: Math.round(performance.now() - start),
    communities: society.communities.length,
    population: Math.round(society.communities.reduce((sum, c) => sum + population(c), 0)),
    works: society.works.length,
    events: society.events.length,
    settlements: society.communities.filter((c) => c.founded).length,
    sizeRange: [
      Math.min(
        ...society.communities.filter((c) => c.founded).map((c) => c.settlement!.population)
      ),
      Math.max(...society.communities.map((c) => c.settlement?.population ?? 0)),
    ],
    declining: society.communities.filter((c) =>
      c.history!.some((s, i, h) => i > 0 && s.population < h[i - 1].population)
    ).length,
  });
}, 180000);

function checkLinguisticPublication(snapshot: DomainSnapshot, areaId: string) {
  const society = snapshot.world.societies![areaId];
  const languages = snapshot.world.fields.filter((f) => f.layerId === "languages");
  expect(languages.flatMap((f) => f.channels ?? []).some((c) => c.startsWith("languageUse:"))).toBe(
    true
  );
  for (const community of society.communities) {
    const shares = Object.values(languageUse(community.groups));
    if (population(community) > 0)
      expect(shares.reduce((sum, share) => sum + share, 0)).toBeCloseTo(1, 8);
    if (community.naming?.language)
      expect(snapshot.world.entities[community.naming.language].attributes.namingCulture).toBe(
        community.naming.culture
      );
  }
  const geography = Object.values(snapshot.world.features).filter((f) => f.attributes.namingKind);
  expect(geography.some((f) => typeof f.attributes.namingLanguage === "string")).toBe(true);
  expect(geography.every((f) => typeof f.attributes.namedInEra === "string")).toBe(true);
  expect(society.works.length).toBeGreaterThan(0);
  for (const work of society.works) {
    expect(work.name).toBeTypeOf("string");
    expect(work.name).not.toContain(" at ");
    expect(work.naming?.era).toBe(work.built);
  }
  const works = Object.values(snapshot.world.features).filter(isSocietyWork);
  for (const work of works) {
    expect(work.name).not.toContain(" at ");
    expect(work.attributes.namingKind).toBe("societyWork");
    expect(work.name).toBe(society.works.find((w) => w.id === work.attributes.workId)!.name);
  }
}
