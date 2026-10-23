import { expect, it } from "vitest";
import { mergePopulation, type PopulationGroup } from "./society";
import { populationGroupsSchema } from "./societyEditing";
import { languageKnowledge, languageShares, languageUse } from "./societyLanguages";

function group(count: number, language: string | null): PopulationGroup {
  return {
    people: "residents",
    culture: "culture",
    languages: language ? [language] : [],
    namingLanguage: language,
    religions: [],
    practices: [],
    count,
  };
}

it("merges weighted language shares without inventing speakers or mutating source groups", () => {
  const groups = [group(600, "A"), group(300, "B"), group(100, null)];
  groups[1].languages.push("A");
  const before = structuredClone(groups);
  const merged = mergePopulation(groups);
  expect(merged).toHaveLength(1);
  expect(merged[0].count).toBe(1000);
  expect(languageUse(merged).A).toBeCloseTo(0.6, 12);
  expect(languageUse(merged).B).toBeCloseTo(0.3, 12);
  expect(languageKnowledge(merged).A).toBeCloseTo(0.9, 12);
  expect(languageKnowledge(merged).B).toBeCloseTo(0.3, 12);
  expect(groups).toEqual(before);
});

it("retains distinct people, cultures, religions and practices when merging languages", () => {
  const base = group(100, "A");
  const groups = [
    base,
    { ...base, people: "new people" },
    { ...base, culture: "new culture" },
    { ...base, religions: ["faith"] },
    { ...base, practices: ["pastoralism"] },
  ];
  expect(mergePopulation(groups)).toHaveLength(5);
});

it("accepts mixed shares and preserves them when other demographic properties change", () => {
  const mixed = {
    ...group(100, "A"),
    languages: ["A", "B"],
    languageShares: { A: { knowledge: 1, use: 0.75 }, B: { knowledge: 0.4, use: 0.25 } },
  };
  const [edited] = populationGroupsSchema.parse([
    { ...mixed, count: 900, practices: ["conservation"] },
  ]);
  expect(languageShares(edited)).toEqual(mixed.languageShares);
  expect(languageUse([edited])).toEqual({ A: 0.75, B: 0.25 });
  expect(languageKnowledge([edited])).toEqual({ A: 1, B: 0.4 });
  expect(languageUse([{ ...edited, count: 0 }])).toEqual({});
  expect(languageKnowledge([{ ...edited, count: 0 }])).toEqual({});
});

it.each([
  { A: { knowledge: -0.1, use: 0 } },
  { A: { knowledge: 1.1, use: 0 } },
  { A: { knowledge: Number.NaN, use: 0 } },
  { A: { knowledge: 1, use: -0.1 } },
  { A: { knowledge: 0.2, use: 0.3 } },
  { A: { knowledge: 1, use: 0.8 }, B: { knowledge: 1, use: 0.8 } },
])("rejects invalid language knowledge or use: %j", (shares) => {
  expect(
    populationGroupsSchema.safeParse([
      { ...group(100, "A"), languages: Object.keys(shares), languageShares: shares },
    ]).success
  ).toBe(false);
});

it("requires explicit shares for every listed language and rejects unlisted shares", () => {
  const base = group(100, "A");
  expect(populationGroupsSchema.safeParse([{ ...base, languageShares: {} }]).success).toBe(false);
  expect(
    populationGroupsSchema.safeParse([
      { ...base, languageShares: { A: { knowledge: 1, use: 1 }, B: { knowledge: 1, use: 0 } } },
    ]).success
  ).toBe(false);
});
