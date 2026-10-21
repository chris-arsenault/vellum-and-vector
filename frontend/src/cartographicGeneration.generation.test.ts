import { expect, it } from "vitest";
import { generateAtlas } from "@atlas/generation";
import { newGenerationDraft, prepareDraft } from "./generationDraft";
import { draftEpochs, replaceDraftEpochs } from "./generationDraftEpochs";
import { applyCartographicChoice, cartographicControls } from "./cartographicDraft";

for (const seed of [73, 104729]) {
  it(
    "generates river plains and unsculpted ice from curated intent at seed " + seed,
    async () => {
      let draft = newGenerationDraft();
      draft = {
        ...draft,
        name: "Curated river country",
        height: 2_000_000,
        recipe: { ...draft.recipe, seed, quality: "draft", domains: ["physical"] },
      };
      draft = replaceDraftEpochs(draft, [{ ...draftEpochs(draft)[0], duration: 2500 }]);
      for (const [id, choice] of [
        ["river-terrain", "plains"],
        ["glacial-influence", "ice"],
        ["rainfall-regime", "wet"],
      ]) {
        draft = applyCartographicChoice(
          draft,
          cartographicControls().find((control) => control.id === id)!,
          choice
        );
      }
      const prepared = prepareDraft(draft);
      expect(prepared.diagnostics.filter((item) => item.severity === "error")).toEqual([]);
      const result = await generateAtlas(prepared.source, prepared.input);
      const channels = result.state.surface.channels;
      expect(channels.fluvialErosion).toBeUndefined();
      expect(channels.glacialErosion).toBeUndefined();
      expect(result.state.surface.channels.elevation.every(Number.isFinite)).toBe(true);
      expect(result.state.surface.channels.riverOrder.some((value) => value > 0)).toBe(true);
      console.log({
        seed,
        riverCells: channels.riverOrder.filter((value) => value > 0).length,
        samples: result.state.surface.active.length,
        publishedIncision: false,
        publishedGlacialSculpting: false,
      });
    },
    180000
  );
}

it("delivers distinct temperature and precipitation influences from composed climate choices", async () => {
  const samples: { temperature: number; precipitation: number }[] = [];
  for (const [thermal, rain] of [
    ["cold", "dry"],
    ["warm", "wet"],
  ]) {
    let draft = newGenerationDraft();
    draft = {
      ...draft,
      name: "Climate intent",
      height: 2_000_000,
      recipe: { ...draft.recipe, seed: 73, quality: "draft", domains: ["physical"] },
    };
    draft = replaceDraftEpochs(draft, [{ ...draftEpochs(draft)[0], duration: 2500 }]);
    for (const [id, value] of [
      ["thermal-climate", thermal],
      ["rainfall-regime", rain],
    ])
      draft = applyCartographicChoice(
        draft,
        cartographicControls().find((item) => item.id === id)!,
        value
      );
    const prepared = prepareDraft(draft);
    expect(prepared.diagnostics.filter((item) => item.severity === "error")).toEqual([]);
    const result = await generateAtlas(prepared.source, prepared.input);
    const { channels, active } = result.state.surface;
    const mean = (name: string) =>
      active.reduce((sum, index) => sum + channels[name][index], 0) / active.length;
    samples.push({ temperature: mean("temperature"), precipitation: mean("precipitation") });
  }
  expect(samples[1].temperature).toBeGreaterThan(samples[0].temperature);
  expect(samples[1].precipitation).toBeGreaterThan(samples[0].precipitation);
  console.log({ climateChoices: samples });
}, 180000);
