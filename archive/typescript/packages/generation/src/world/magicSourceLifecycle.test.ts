import { expect, it, vi } from "vitest";
import { canonryMagicPresets, MapScale, resolveMagicSystem } from "@atlas/domain";
import type { GenerationState } from "../process";
import type { MagicField } from "./magicState";
import { retainedCharge } from "./magicFeedback";
import { currentPhaseFields } from "./magicProcesses";
import { tearResponse } from "./magicVeil";
import { physicalEpochIndex } from "../generationBindings";
import {
  magicSourceStrategies,
  supplyMagicSources,
  sourcePropagationActivity,
  placedSourceStrength,
} from "./magicSources";

it("supplies each origin once per elapsed epoch, including zero-supply event eligibility", () => {
  // Explicit lifecycle contract: callbacks only, with no terrain or process world.
  const supply = vi.fn(),
    definition = resolveMagicSystem(
      canonryMagicPresets()[0],
      new MapScale(4_000_000, 4_000_000, 1000)
    ),
    field = { definition, suppliedEpoch: -1 } as MagicField,
    state = {} as GenerationState,
    strategies = {
      ...magicSourceStrategies,
      geothermal: { ...magicSourceStrategies.geothermal, supply },
      impact: { ...magicSourceStrategies.impact, supply },
      forge: { ...magicSourceStrategies.forge, supply },
    };
  supplyMagicSources(state, field, 5, 0, 1, strategies);
  expect(supply).toHaveBeenCalledTimes(3);
  supplyMagicSources(state, field, 5, 0, 1, strategies);
  expect(supply).toHaveBeenCalledTimes(3);
  supplyMagicSources(state, field, 5, 1, 0, strategies);
  expect(supply).toHaveBeenCalledTimes(6);
  expect(supply.mock.calls.slice(3).every((call) => call[3].activity === 0)).toBe(true);
  expect(field.definition).toBe(definition);
});

it("placed supply stops and scales once without suppressing retained material release", () => {
  for (const system of canonryMagicPresets())
    for (const origin of system.origins) {
      expect(placedSourceStrength(800, origin, 0)).toBe(0);
      const source = placedSourceStrength(800, origin, 0.25),
        propagation = sourcePropagationActivity(origin, 0.25);
      expect(source * propagation).toBe(200);
    }
  const fire = canonryMagicPresets().find((system) => system.id === "fire")!;
  expect(sourcePropagationActivity(fire.origins[0], 0)).toBe(1);
  const greenwood = canonryMagicPresets().find((system) => system.id === "greenwood")!,
    spring = greenwood.origins.find((origin) => origin.source === "aquifer")!;
  expect(sourcePropagationActivity(spring, 0)).toBe(1);
  expect(placedSourceStrength(800, spring, 0)).toBe(0);
});

it("retention cannot recreate departed ground inventory from an old intensity projection", () => {
  expect(retainedCharge(0, 0, 0.8, 0.5)).toBe(0);
  expect(retainedCharge(40, 0, 0.8, 0.5)).toBe(32);
  expect(retainedCharge(0, 20, 0.8, 0.5)).toBe(10);
  expect(retainedCharge(40, 20, 0.8, 0.5)).toBe(42);
});

it("refreshes current maintained sources between supply phases, including disabled wards that must clear", () => {
  const fields = canonryMagicPresets().map((definition) => ({ definition }));
  const ward = fields.find((field) => field.definition.id === "hallowed")!;
  for (const enabled of [true, false]) {
    ward.definition.enabled = enabled;
    expect(currentPhaseFields(fields, "climate")).toContain(ward);
    expect(currentPhaseFields(fields, "post-glacial")).toContain(ward);
    expect(currentPhaseFields(fields, "climate")).not.toContain(
      fields.find((field) => field.definition.id === "veil")
    );
  }
});

it("emergent strain scales once before access and deformation, while inactive memory does no work", () => {
  const parameters = { tearFloor: 0.1, tearFull: 1, holdSalting: 1, wildShift: 0.5 },
    origin = canonryMagicPresets().find((system) => system.id === "veil")!.origins[0],
    response = tearResponse(0.55, 0, 0, 0.5, parameters);
  expect(response).toEqual({ strength: 250, wild: 0.5 });
  expect(response.strength * sourcePropagationActivity(origin, 0.5)).toBe(250);
  expect(tearResponse(0.55, 250, 0, 0.5, parameters)).toEqual({ strength: 250, wild: 0 });
  expect(tearResponse(0, 250, 1, 0.5, parameters)).toEqual({ strength: 250, wild: 0 });
  expect(tearResponse(1, 250, 1, 0, parameters)).toEqual({ strength: 0, wild: 0 });
});

it("resolves physical activity from declared ancestry rather than human era indices or names", () => {
  const epochs = [
    { id: "Formation", magicActivity: { veil: 1 } },
    { id: "Aftermath", magicActivity: { veil: 0 } },
  ];
  const activity = (ancestry: { parentEpoch: string | null }[]) =>
    epochs[physicalEpochIndex(epochs, ancestry)].magicActivity.veil;
  expect(activity([{ parentEpoch: "Formation" }])).toBe(1);
  expect(activity([{ parentEpoch: "Formation" }, { parentEpoch: "Formation" }])).toBe(1);
  for (const index of [0, 1]) {
    const present = { id: "Formation", duration: 1, parentEpoch: null, variables: {} },
      context = { epochs: [present], epochIndices: [index] };
    expect(activity(context.epochs)).toBe(0);
  }
  expect(activity([{ parentEpoch: "Aftermath" }])).toBe(0);
  expect(activity([])).toBe(0);
  expect(() => activity([{ parentEpoch: "Absent" }])).toThrow();
});
