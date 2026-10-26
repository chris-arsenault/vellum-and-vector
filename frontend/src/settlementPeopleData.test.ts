import { expect, it } from "vitest";
import type { PopulationGroup, World } from "@atlas/domain";
import {
  cultureSegments,
  foldGroupRows,
  groupRows,
  knowledgeSegments,
  residentPracticeSegments,
  traditionShares,
} from "./settlementPeopleData";

const world = {
  entities: {
    bayt: { name: "Bayt Abid" },
    ding: { name: "Upper Dingford" },
    "rel-bayt": { name: "Bayt Abid tradition" },
    "rel-ding": { name: "Upper Dingford tradition" },
    "lang-bayt": { name: "Bayt Abid language" },
    "lang-ding": { name: "Upper Dingford language" },
  },
} as unknown as World;
function group(
  culture: string | null,
  religions: string[],
  count: number,
  extra: Partial<PopulationGroup> = {}
): PopulationGroup {
  return { people: "founders", culture, languages: [], religions, practices: [], count, ...extra };
}
// A capital's partition: one culture in several faith combinations, a minority, a sliver.
const groups = [
  group("bayt", ["rel-bayt"], 900, {
    languageShares: { "lang-bayt": { knowledge: 1, use: 1 } },
    practiceShares: { farming: 0.9, grazing: 0.1, "pressure-diving": 0.1 },
  }),
  group("ding", ["rel-ding", "rel-bayt"], 60, {
    languageShares: {
      "lang-ding": { knowledge: 1, use: 0.1 },
      "lang-bayt": { knowledge: 0.5, use: 0.9 },
    },
    practiceShares: { fishing: 1 },
  }),
  group("bayt", ["rel-bayt", "rel-ding"], 30),
  group("ding", ["rel-ding"], 6),
  group(null, [], 4),
];

it("aggregates residents by culture with unspecified cultures under their people", () => {
  expect(cultureSegments(world, groups)).toEqual([
    { id: "bayt", label: "Bayt Abid", value: 930 },
    { id: "ding", label: "Upper Dingford", value: 66 },
    { id: "founders", label: "founders", value: 4 },
  ]);
});

it("reports overlapping tradition and language shares as fractions of all residents", () => {
  const traditions = traditionShares(world, groups);
  expect(traditions.map((s) => [s.label, Math.round(1000 * s.value) / 1000])).toEqual([
    ["Bayt Abid tradition", 0.99],
    ["Upper Dingford tradition", 0.096],
  ]);
  expect(knowledgeSegments(world, groups).map((s) => [s.label, s.value])).toEqual([
    ["Bayt Abid language", 0.93],
    ["Upper Dingford language", 0.06],
  ]);
  expect(traditionShares(world, [])).toEqual([]);
});

it("weighs the residents' practices by head count", () => {
  const shares = Object.fromEntries(residentPracticeSegments(groups).map((s) => [s.id, s.value]));
  expect(shares.farming).toBeCloseTo(0.81);
  expect(shares.grazing).toBeCloseTo(0.09);
  expect(shares.fishing).toBeCloseTo(0.06);
  expect(shares["pressure-diving"]).toBeCloseTo(0.09);
  expect(residentPracticeSegments(groups)[0].label).toBe("Farming");
});

it("lists groups heaviest first with their record index and folds the minor ones", () => {
  const rows = groupRows(world, groups);
  expect(rows.map((r) => [r.index, r.culture, r.traditions.length, r.share])).toEqual([
    [0, "Bayt Abid", 1, 0.9],
    [1, "Upper Dingford", 2, 0.06],
    [2, "Bayt Abid", 2, 0.03],
    [3, "Upper Dingford", 1, 0.006],
    [4, "founders", 0, 0.004],
  ]);
  const { shown, folded } = foldGroupRows(rows);
  expect(shown.map((r) => r.index)).toEqual([0, 1, 2]);
  expect(folded.map((r) => r.index)).toEqual([3, 4]);
  // One minor row is not worth a remainder row.
  expect(foldGroupRows(rows.slice(0, 4))).toEqual({ shown: rows.slice(0, 4), folded: [] });
  expect(groupRows(world, [])).toEqual([]);
});
