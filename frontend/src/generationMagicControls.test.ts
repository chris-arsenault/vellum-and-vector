import { expect, it } from "vitest";
import presentation from "../../crates/atlas-generation/src/magic/presentation.json";
import type { FeaturePresentation } from "./generationPresentation";
import { magicControlKeys } from "./generationMagicControls";

const metadata = presentation as NonNullable<FeaturePresentation["magicPresentation"]>;
const sources = metadata.sources.map((source) => source.value),
  propagation = metadata.propagations.map((mode) => mode.value);
const preset = () => ({
  origins: [{ source: "geothermal" as const, propagation: "fracture" as const }],
  effects: { coastalForcing: 0 },
});
it.each(sources.flatMap((source) => propagation.map((mode) => [source, mode] as const)))(
  "retains independent %s source controls with %s propagation",
  (source, mode) => {
    const example = preset(),
      system = {
        ...example,
        origins: [{ source, propagation: mode }],
      },
      keys = magicControlKeys(system, metadata);
    expect(new Set(keys).size).toBe(keys.length);
    if (source === "geothermal")
      expect(keys).toEqual(expect.arrayContaining(["sourceSpacing", "sourceThreshold"]));
    if (source === "cold") expect(keys).toContain("baseInput");
    if (mode === "fracture")
      expect(keys).toEqual(expect.arrayContaining(["baseCost", "conductanceDivisor"]));
    else expect(keys).not.toEqual(expect.arrayContaining(["baseCost", "conductanceDivisor"]));
    if (source === "deep-ocean" && mode === "radial") expect(keys).toContain("beamWidth");
  }
);
it("exposes coastal response parameters for an active effect with any propagation strategy", () => {
  for (const mode of propagation) {
    const example = preset(),
      system = { ...example, origins: [{ ...example.origins[0], propagation: mode }] };
    system.effects = { ...system.effects, coastalForcing: 0 };
    expect(magicControlKeys(system, metadata)).not.toContain("coastalThreshold");
    system.effects.coastalForcing = 1;
    expect(magicControlKeys(system, metadata)).toEqual(
      expect.arrayContaining(["coastalThreshold", "waveAmplification", "currentAmplification"])
    );
  }
});
it("does not present cold source input or geothermal spacing as generic propagation controls", () => {
  const example = preset(),
    system = {
      ...example,
      origins: [{ source: "placed" as const, propagation: "radial" as const }],
    };
  const keys = magicControlKeys(system, metadata);
  expect(keys).not.toContain("baseInput");
  expect(keys).not.toContain("sourceSpacing");
  expect(keys).not.toContain("conductanceDivisor");
  expect(keys).toContain("featureNoiseScale");
});
