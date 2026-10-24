import { expect, it } from "vitest";
import { generateAtlas } from "@atlas/generation";
import { newGenerationDraft, prepareDraft } from "./generationDraft";
import { applyCartographicChoice, cartographicControls } from "./cartographicDraft";
import { generationSnapshot } from "./generationJobs";

it.each(["northern", "globe"])(
  "publishes a large %s world while retaining recoverable errors",
  async (coverage) => {
    const base = newGenerationDraft();
    const draft = applyCartographicChoice(
      {
        ...base,
        name: "Large world",
        width: 40_000_000,
        height: 20_000_000,
        recipe: { ...base.recipe, seed: 104729, quality: "draft", domains: ["physical", "magic"] },
      },
      cartographicControls().find((control) => control.id === "climate-coverage")!,
      coverage
    );
    const prepared = prepareDraft(draft);
    expect(prepared.diagnostics.filter((entry) => entry.severity === "error")).toEqual([]);
    const started = performance.now();
    const result = await generateAtlas(prepared.source, prepared.input);
    const snapshot = generationSnapshot(result, prepared.input, crypto.randomUUID());
    expect(snapshot.world.fields.some((field) => field.channels?.includes("elevation"))).toBe(true);
    expect(result.state.surface.channels.elevation.every(Number.isFinite)).toBe(true);
    expect(result.state.surface.channels.temperature.every(Number.isFinite)).toBe(true);
    expect(result.state.history.length).toBeGreaterThan(0);
    console.log({
      coverage,
      seconds: (performance.now() - started) / 1000,
      diagnostics:
        result.state.diagnostics?.map(({ code, process, message }) => ({
          code,
          process,
          message,
        })) ?? [],
    });
  },
  180000
);
