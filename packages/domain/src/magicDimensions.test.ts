import { expect, it } from "vitest";
import { MapScale } from "./mapScale";
import { magicSystemSchema } from "./magicSystems";
import { resolveMagicSystem } from "./magicDimensions";

const source = {
  id: "fire",
  name: "Fire",
  origins: [{ id: "vein", source: "geothermal", propagation: "fracture" }],
  phase: "climate",
};

it("resolves relative dimensions against the owning map", () => {
  const definition = magicSystemSchema.parse({
    ...source,
    parameters: {
      sourceSpacing: 0.02,
      accumulationArea: 0.00001,
      fallenDensity: 400_000_000,
      springFlow: 6.25e-19,
    },
    effects: { iceMelt: 0.0000005 },
    features: [{ id: "soil", name: "Soil", seeds: [[{ field: "soilDepth", min: 0.0000005 }]] }],
  });
  expect(definition.lengthUnits).toBe("relative");
  expect(definition.parameters.sourceSpacing).toBe(0.02);
  const saved = magicSystemSchema.parse(definition);
  expect(saved.parameters.sourceSpacing).toBe(0.02);
  const resolved = resolveMagicSystem(saved, new MapScale(2_000_000, 1_500_000, 200));
  expect(resolved.parameters.sourceSpacing).toBe(40_000);
  expect(resolved.parameters.accumulationArea).toBe(40_000_000);
  expect(resolved.parameters.fallenDensity).toBe(200);
  expect(resolved.parameters.springFlow).toBe(5);
  expect(resolved.effects.iceMelt).toBe(1);
  expect(resolved.features[0].seeds[0][0].min).toBe(1);
});

it("rejects malformed feature rules", () => {
  for (const features of [[null], [{ seeds: [null] }], [{ seeds: [[null]] }]])
    expect(magicSystemSchema.safeParse({ ...source, features }).success).toBe(false);
});
