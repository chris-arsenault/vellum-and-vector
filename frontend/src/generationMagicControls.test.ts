import { expect, it } from "vitest";
import { canonryMagicPresets, magicSystemSchema } from "@atlas/domain";
import { magicControlKeys } from "./generationMagicControls";

const sources = magicSystemSchema.shape.source.options,
  propagation = magicSystemSchema.shape.propagation.options;
it.each(sources.flatMap((source) => propagation.map((mode) => [source, mode] as const)))(
  "retains independent %s source controls with %s propagation",
  (source, mode) => {
    const system = { ...canonryMagicPresets()[0], source, propagation: mode },
      keys = magicControlKeys(system);
    expect(new Set(keys).size).toBe(keys.length);
    if (source === "geothermal")
      expect(keys).toEqual(
        expect.arrayContaining(["sourceSpacing", "sourceThreshold", "maximumSources"])
      );
    if (source === "cold") expect(keys).toContain("baseInput");
    if (mode === "fracture")
      expect(keys).toEqual(expect.arrayContaining(["baseCost", "conductanceDivisor"]));
    else expect(keys).not.toEqual(expect.arrayContaining(["baseCost", "conductanceDivisor"]));
    if (source === "deep-ocean" && mode === "radial") expect(keys).toContain("beamWidth");
  }
);
it("exposes coastal response parameters for an active effect with any propagation strategy", () => {
  for (const mode of propagation) {
    const system = { ...canonryMagicPresets()[0], propagation: mode };
    system.effects = { ...system.effects, coastalForcing: 0 };
    expect(magicControlKeys(system)).not.toContain("coastalThreshold");
    system.effects.coastalForcing = 1;
    expect(magicControlKeys(system)).toEqual(
      expect.arrayContaining(["coastalThreshold", "waveAmplification", "currentAmplification"])
    );
  }
});
it("does not present cold source input or geothermal spacing as generic propagation controls", () => {
  const system = {
    ...canonryMagicPresets()[0],
    source: "placed" as const,
    propagation: "radial" as const,
  };
  const keys = magicControlKeys(system);
  expect(keys).not.toContain("baseInput");
  expect(keys).not.toContain("sourceSpacing");
  expect(keys).not.toContain("conductanceDivisor");
  expect(keys).toContain("featureNoiseScale");
});
