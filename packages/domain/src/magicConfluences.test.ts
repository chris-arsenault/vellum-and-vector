import { expect, it } from "vitest";
import {
  canonryConfluencePresets,
  canonryMagicPresets,
  confluenceEffective,
  magicConfluenceSchema,
  surfaceCategories,
  surfaceRuleSources,
  validateMagicConfluences,
} from "./index";

it("ships the three meetings as presets that validate against the preset systems", () => {
  const systems = canonryMagicPresets(),
    confluences = canonryConfluencePresets();
  expect(confluences.map((c) => c.id)).toEqual(["war", "steam", "breach"]);
  expect(() => validateMagicConfluences(confluences, systems)).not.toThrow();
  expect(confluences[0].effects.fractureConductance).toBeGreaterThan(0);
  expect(confluences[0].hazard?.kind).toBe("thermal-fracture");
});
it("is effective only when every system it reads is enabled", () => {
  const systems = canonryMagicPresets(),
    [war] = canonryConfluencePresets();
  expect(confluenceEffective(war, systems)).toBe(true);
  systems[0].enabled = false;
  expect(confluenceEffective(war, systems)).toBe(false);
  systems[0].enabled = true;
  expect(confluenceEffective({ ...war, enabled: false }, systems)).toBe(false);
});
it("rejects own-channel conditions and treats an absent system as never holding", () => {
  const systems = canonryMagicPresets();
  const base = {
    id: "x",
    name: "X",
    systems: ["fire", "aurora"],
    seeds: [[{ field: "system:fire", min: 1 }]],
  };
  const absent = magicConfluenceSchema.parse({ ...base, systems: ["fire", "salt"] });
  expect(() => validateMagicConfluences([absent], systems)).not.toThrow();
  expect(confluenceEffective(absent, systems)).toBe(false);
  expect(() =>
    validateMagicConfluences(
      [magicConfluenceSchema.parse({ ...base, seeds: [[{ field: "intensity", min: 1 }]] })],
      systems
    )
  ).toThrow(/cannot read/);
  expect(() =>
    validateMagicConfluences(
      [magicConfluenceSchema.parse({ ...base, seeds: [[{ field: "fracture", min: 1 }]] })],
      systems
    )
  ).not.toThrow();
});
it("takes surface codes after every system under one Interactions source", () => {
  const systems = canonryMagicPresets(),
    confluences = canonryConfluencePresets();
  const sources = surfaceRuleSources(systems, confluences);
  expect(sources.at(-1)!.id).toBe("confluence");
  const categories = surfaceCategories(systems, confluences);
  const breach = categories.find((category) => category.rule === "breach")!;
  expect(breach.system).toBe("confluence");
  expect(breach.name).toBe("Interactions · Breach");
  const ruleCount = systems.reduce((sum, system) => sum + system.features.length, 0);
  expect(breach.code).toBe(100 + ruleCount + 2);
});
