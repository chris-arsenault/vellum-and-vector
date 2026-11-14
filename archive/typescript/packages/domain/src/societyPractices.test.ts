import { expect, it } from "vitest";
import { mergePopulation, type PopulationGroup } from "./society";
import { populationGroupsSchema } from "./societyEditing";
import {
  communityPractices,
  livelihoodShares,
  practiceShares,
  relaxShares,
  withPracticeShares,
} from "./societyPractices";

function group(count: number, practices: string[] = []): PopulationGroup {
  return {
    people: "residents",
    culture: "culture",
    languages: [],
    religions: [],
    practices,
    count,
  };
}

it("reads an authored list as equal livelihood shares and full engagement otherwise", () => {
  expect(practiceShares(group(1, ["cultivation", "fishing", "fire-forge"]))).toEqual({
    farming: 0.5,
    fishing: 0.5,
    "fire-forge": 1,
  });
  expect(practiceShares(group(1))).toEqual({});
});

it("bounds shares, keeps livelihoods a distribution and lists them by weight", () => {
  const g = withPracticeShares(group(1), {
    farming: 0.9,
    fishing: 0.6,
    "aurora-archive": 1.4,
    gathering: 1e-9,
  });
  expect(g.practices).toEqual(["aurora-archive", "farming", "fishing"]);
  expect(g.practiceShares!.farming + g.practiceShares!.fishing).toBeCloseTo(1, 12);
  expect(g.practiceShares!.farming / g.practiceShares!.fishing).toBeCloseTo(1.5, 12);
  expect(g.practiceShares!["aurora-archive"]).toBe(1);
  expect(g.practiceShares!.gathering).toBeUndefined();
});

it("merges practice shares by people instead of splitting groups on them", () => {
  const merged = mergePopulation([
    withPracticeShares(group(300), { fishing: 1 }),
    withPracticeShares(group(100), { farming: 1, "fire-forge": 0.4 }),
  ]);
  expect(merged).toHaveLength(1);
  expect(merged[0].count).toBe(400);
  expect(merged[0].practiceShares).toEqual({ fishing: 0.75, farming: 0.25, "fire-forge": 0.1 });
  expect(communityPractices(merged)).toEqual({ fishing: 0.75, farming: 0.25, "fire-forge": 0.1 });
});

it("derives livelihood shares from support and relaxes toward them", () => {
  const target = livelihoodShares({ farming: 30, grazing: 0, gathering: 10, fishing: 0 });
  expect(target).toEqual({ farming: 0.75, gathering: 0.25 });
  const relaxed = relaxShares({ fishing: 1 }, target, 0.5);
  expect(relaxed).toEqual({ fishing: 0.5, farming: 0.375, gathering: 0.125 });
  expect(livelihoodShares({ farming: 0, grazing: 0, gathering: 0, fishing: 0 })).toEqual({});
});

it("validates authored practice shares against the listed practices", () => {
  const valid = {
    ...group(10, ["farming", "fishing"]),
    practiceShares: { farming: 0.7, fishing: 0.3 },
  };
  expect(populationGroupsSchema.safeParse([valid]).success).toBe(true);
  expect(
    populationGroupsSchema.safeParse([{ ...valid, practiceShares: { farming: 0.7 } }]).success
  ).toBe(false);
  expect(
    populationGroupsSchema.safeParse([{ ...valid, practiceShares: { farming: 0.7, fishing: 0.5 } }])
      .success
  ).toBe(false);
  expect(
    populationGroupsSchema.safeParse([
      { ...valid, practices: ["farming"], practiceShares: { farming: 0.7, fishing: 0.3 } },
    ]).success
  ).toBe(false);
});
