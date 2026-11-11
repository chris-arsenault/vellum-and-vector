import { expect, it } from "vitest";
import { beforePresentEpoch } from "@atlas/domain";
import { hasHumanRound, presentHumanEras, roundEras } from "./societyRound";
import { societySequence } from "./societyProcesses";
import type { GenerationSettings } from "./generationSettings";
import type { AtlasGenerationInput } from "./atlasWorkflow";

const era = (id: string, physicalEpoch: string | null) => ({
  id,
  years: 100,
  physicalEpoch,
  mobility: 1,
  politicalCapacity: 0,
});
const settings = {
  epochs: [{ id: "Formation" }, { id: "Cold age" }, { id: "Present" }],
  humanEras: [
    era("Ice age", beforePresentEpoch),
    era("Late ice age", "Cold age"),
    era("Settlement", null),
    era("Lost", "Never was"),
  ],
} as unknown as GenerationSettings;

it("runs every era bound to an earlier epoch inside it and the rest with the present", () => {
  expect(roundEras(settings, "Cold age", 1).map((e) => e.id)).toEqual(["Ice age", "Late ice age"]);
  expect(roundEras(settings, "Formation", 0)).toEqual([]);
  // The final epoch is the present, whatever its name; nothing rounds inside it.
  expect(roundEras(settings, "Present", 2)).toEqual([]);
  // An era bound to an epoch that no longer exists runs with the present.
  expect(presentHumanEras(settings).map((e) => e.id)).toEqual(["Settlement", "Lost"]);
  expect(hasHumanRound(settings)).toBe(true);
  expect(hasHumanRound({ ...settings, humanEras: [era("Settlement", null)] })).toBe(false);
});

it("runs only the eras not bound to an earlier epoch in the present sequence", () => {
  const input = {
    settings,
    domains: ["physical", "cultural"],
    resolvedFeatures: { selection: {} },
  } as unknown as AtlasGenerationInput;
  const eras = societySequence(input).flatMap((step) =>
    step.kind === "epochs" ? step.epochs.map((e) => [e.id, e.parentEpoch]) : []
  );
  expect(eras).toEqual([
    ["Settlement", null],
    ["Lost", null],
  ]);
});
