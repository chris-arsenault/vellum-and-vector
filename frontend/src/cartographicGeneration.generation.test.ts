import { expect, it } from "vitest";
import { generateAtlas } from "@atlas/generation";
import { newGenerationDraft, prepareDraft } from "./generationDraft";
import { applyCartographicChoice, cartographicControls } from "./cartographicDraft";
import { generationSnapshot } from "./generationJobs";

const compositions = {
  maritime: [
    ["land-and-sea", "broken"],
    ["terrain", "hills"],
    ["shoreline", "inlets"],
    ["climate-coverage", "northern"],
    ["warmth", "earthlike"],
    ["living-landscape", "humid"],
    ["landmarks", "scattered"],
  ],
  glaciated: [
    ["land-and-sea", "islands"],
    ["terrain", "glacial"],
    ["shoreline", "inlets"],
    ["climate-coverage", "hemispheres"],
    ["warmth", "warmer"],
    ["living-landscape", "mosaic"],
    ["landmarks", "rare"],
  ],
  dry: [
    ["land-and-sea", "broad"],
    ["terrain", "plains"],
    ["shoreline", "flats"],
    ["climate-coverage", "northern"],
    ["warmth", "warmer"],
    ["living-landscape", "dry"],
    ["landmarks", "rare"],
  ],
};

for (const seed of [73, 104729]) {
  it(`publishes the three worked geographic compositions at seed ${seed}`, async () => {
    const measurements: Record<string, Record<string, number>> = {};
    for (const [name, choices] of Object.entries(compositions)) {
      let draft = newGenerationDraft();
      draft = {
        ...draft,
        name,
        ...(seed === 73 ? {} : { width: 3_000_000, height: 2_000_000 }),
        recipe: { ...draft.recipe, seed, quality: "draft", domains: ["physical"] },
      };
      for (const [id, choice] of choices)
        draft = applyCartographicChoice(
          draft,
          cartographicControls().find((control) => control.id === id)!,
          choice
        );
      const prepared = prepareDraft(draft);
      expect(prepared.diagnostics.filter((entry) => entry.severity === "error")).toEqual([]);
      const result = await generateAtlas(prepared.source, prepared.input);
      const { channels, active: mask } = result.state.surface;
      const active = Array.from(mask.keys()).filter((i) => mask[i]);
      expect(channels.elevation.every(Number.isFinite)).toBe(true);
      const mean = (channel: string) =>
        active.reduce((sum, i) => sum + channels[channel][i], 0) / active.length;
      const land = active.filter((i) => channels.water[i] !== 1);
      const landMean = (channel: string) =>
        land.reduce((sum, i) => sum + channels[channel][i], 0) / land.length;
      measurements[name] = {
        landFraction: land.length / active.length,
        precipitation: mean("precipitation"),
        treeCover: landMean("treeCover"),
        vegetation: landMean("grassCover") + landMean("treeCover"),
        relief:
          Math.max(...land.map((i) => channels.elevation[i])) -
          Math.min(...land.map((i) => channels.elevation[i])),
        glacialErosion: mean("glacialErosion"),
        grassCover: landMean("grassCover"),
        woodlandShare: land.filter((i) => channels.treeCover[i] >= 0.15).length / land.length,
        forestShare: land.filter((i) => channels.treeCover[i] >= 0.4).length / land.length,
      };
      const published = generationSnapshot(result, prepared.input, crypto.randomUUID());
      expect(
        Object.values(published.numerical).some((field) => Boolean(field.channels.elevation))
      ).toBe(true);
      measurements[name].rivers = Object.values(published.world.features).filter(
        (feature) => feature.kind === "river"
      ).length;
      expect(Object.values(measurements[name]).every(Number.isFinite)).toBe(true);
      console.log({ seed, composition: name, measurements: measurements[name] });
      if (name === "maritime") expect(measurements[name].rivers).toBeGreaterThan(0);
    }
    console.log({ seed, compositions: measurements });
    expect(measurements.maritime.precipitation).toBeGreaterThan(measurements.dry.precipitation);
    expect(measurements.maritime.treeCover).toBeGreaterThan(measurements.dry.treeCover);
    expect(measurements.dry.landFraction).toBeGreaterThan(measurements.glaciated.landFraction);
    expect(measurements.glaciated.glacialErosion).toBeGreaterThan(measurements.dry.glacialErosion);
    if (seed === 73)
      expect(measurements.maritime.treeCover).toBeGreaterThan(measurements.maritime.grassCover);
  }, 180000);
}
