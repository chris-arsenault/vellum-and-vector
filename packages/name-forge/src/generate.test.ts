import { expect, it } from "vitest";
import {
  generate,
  generateOne,
  trainMarkovChain,
  generateFromMarkov,
  type Culture,
} from "./index.js";

function culture(): Culture {
  return {
    id: "test",
    name: "Test",
    description: "Caller-defined GIS types",
    domains: [],
    lexemeLists: { root: { id: "root", entries: ["ash"] } },
    grammars: [
      {
        id: "place",
        start: "name",
        capitalization: "titleWords",
        rules: {
          name: [["markov:towns"]],
        },
      },
      {
        id: "biome",
        start: "name",
        capitalization: "titleWords",
        rules: {
          name: [
            ["root", "context:type"],
            ["slot:root~poss", "Forest"],
          ],
          root: [["slot:root"]],
        },
      },
      {
        id: "special",
        start: "name",
        capitalization: "titleWords",
        rules: {
          name: [["context:river-name~upper", "slot:root~poss~lower^wood"]],
        },
      },
    ],
    profiles: [
      {
        id: "default",
        entityKinds: [],
        isDefault: true,
        strategyGroups: [
          {
            name: "default",
            priority: 0,
            conditions: null,
            strategies: [{ type: "grammar", grammarId: "place", weight: 1 }],
          },
          {
            name: "forest",
            priority: 10,
            conditions: { entityKinds: ["biome"], subtypes: ["forest"] },
            strategies: [{ type: "grammar", grammarId: "biome", weight: 1 }],
          },
        ],
      },
    ],
  };
}
const models = new Map([
  ["towns", trainMarkovChain(["Ashford", "Ashbury", "Bramford", "Brampton"], 2)],
]);

it("uses supplied models reproducibly and reports Markov strategies", () => {
  const c = culture(),
    request = { kind: "settlement", seed: "towns", count: 20 };
  const first = generate(c, request, { models });
  expect(generate(c, request, { models })).toEqual(first);
  expect(first.strategyUsage).toEqual({ markov: 20 });
  expect(new Set(first.names).size).toBeGreaterThan(1);
  expect(generate(c, { ...request, seed: "different" }, { models }).names).not.toEqual(first.names);
});
it("selects GIS kind/subkind groups and nested rules with missing-context alternatives", () => {
  const result = generate(
    culture(),
    { kind: "biome", subtype: "forest", seed: "biome", count: 8 },
    { models }
  );
  expect(result.names).toEqual(Array(8).fill("Ash's Forest"));
  expect(result.debugInfo.every((d) => d.groupUsed === "forest")).toBe(true);
});
it("preserves context IDs containing hyphens, affixes and token case after grammar casing", () => {
  const c = culture();
  c.profiles[0].strategyGroups[0].strategies = [
    { type: "grammar", grammarId: "special", weight: 1 },
  ];
  expect(
    generateOne(c, { kind: "river", seed: "case", context: { "river-name": "Severn" } }, { models })
  ).toBe("SEVERN ash'swood");
});
it("fails on missing models instead of emitting model identifiers as names", () => {
  expect(() =>
    generateOne(culture(), { kind: "settlement", seed: "missing" }, { models: new Map() })
  ).toThrow("Missing NameForge Markov model: towns");
});
it("emits complete Markov words and rejects impossible length ranges", () => {
  const model = trainMarkovChain(["Ashford"], 3);
  expect(generateFromMarkov(model, { seed: "full", minLength: 7, maxLength: 7 })).toBe("Ashford");
  expect(() => generateFromMarkov(model, { seed: "short", maxLength: 6 })).toThrow("complete name");
  expect(() => trainMarkovChain([], 3)).toThrow("name samples");
  expect(() => trainMarkovChain(["Ashford"], 0)).toThrow("order");
});
it("retains phonotactic morphology and style with syllable boundaries", () => {
  const c = culture();
  c.domains = [
    {
      id: "local",
      appliesTo: { kind: ["settlement"] },
      phonology: {
        consonants: ["k"],
        vowels: ["a"],
        syllableTemplates: ["CV"],
        lengthRange: [2, 2],
      },
      morphology: { prefixes: ["al"], structure: ["prefix-root"] },
      style: { hyphenRate: 1 },
    },
  ];
  c.profiles[0].strategyGroups[0].strategies = [
    { type: "phonotactic", domainId: "local", weight: 1 },
  ];
  const name = generateOne(c, { kind: "settlement", seed: "sounds" }, { models });
  expect(["Al-kaka", "Alka-ka"]).toContain(name);
});
