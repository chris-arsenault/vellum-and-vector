import { expect, it } from "vitest";
import { createGrid } from "@atlas/domain";
import { atlasGenerationModules } from "./atlasModules";
import { prepareAtlasGeneration } from "./atlasWorkflow";
import { MapRunner } from "./mapRunner";
import { options } from "./mapFixtures";
import type { GenerationState, ProcessSequence } from "./process";
import { publishGenerationProducts } from "./publication";
import {
  inventoryChannel,
  inventoryFeature,
  inventoryLayer,
  statefulInventoryModule,
  statefulInventoryRequest,
} from "./fixtures/statefulModule";

function ownOperations(sequence: ProcessSequence): ProcessSequence {
  return sequence.flatMap((operation): ProcessSequence => {
    if (operation.kind === "process")
      return operation.feature === inventoryFeature ? [operation] : [];
    const body = ownOperations(operation.body);
    return body.length ? [{ ...operation, body }] : [];
  });
}
async function execute(deposition: number, enabled = true) {
  const { source, input } = statefulInventoryRequest(deposition);
  input.features![inventoryFeature].enabled = enabled;
  const prepared = prepareAtlasGeneration(source, input);
  expect(prepared.diagnostics).toEqual([]);
  const recipe = prepared.input.configuration!;
  const surface = createGrid("test-inventory", source.scope, 4, 3);
  const state: GenerationState = {
    domain: source,
    surface,
    facts: new Set(),
    history: [],
    causes: [],
    publications: atlasGenerationModules
      .publications(prepared.input, source.world)
      .filter((definition) => definition.owners?.includes(inventoryFeature)),
  };
  // Use the module's actual compiled occurrences and bindings; numerical kernels
  // are independent acceptance coverage, not prerequisites of this private inventory.
  const result = await new MapRunner(
    { ...recipe, sequence: ownOperations(recipe.sequence) },
    prepared.registry
  ).run(state, options);
  publishGenerationProducts(result.state, "inventory-test-run");
  return { result, state, recipe };
}

it("registers a carried extensive product that advances over two epochs and publishes a new layer", async () => {
  atlasGenerationModules.register(statefulInventoryModule);
  try {
    const { result, state } = await execute(2);
    const grid = result.state.surface;
    expect(result.state.history.map((entry) => entry.ancestry.at(-1)!.id)).toEqual([
      "Formation",
      "Recent",
    ]);
    expect(result.state.history.map((entry) => entry.causes)).toEqual([
      [expect.objectContaining({ description: expect.stringContaining("over 2 years") })],
      [expect.objectContaining({ description: expect.stringContaining("over 3 years") })],
    ]);
    expect(result.state.facts.has("test:inventory-output")).toBe(true);
    expect(grid.quantities?.[inventoryChannel]).toBe("extensive");
    for (let i = 0; i < grid.active.length; i++)
      expect(grid.channels[inventoryChannel][i] / grid.measures[i]).toBeCloseTo(17, 12);
    expect(state.surface.channels[inventoryChannel]).toBeUndefined();
    expect(result.state.domain.world.layers[inventoryLayer].name).toBe("Carried inventory");
    expect(result.state.domain.world.fields.some((field) => field.layerId === inventoryLayer)).toBe(
      true
    );
    expect(
      result.state.domain.coverage.some((coverage) => coverage.layerId === inventoryLayer)
    ).toBe(true);
    const changed = await execute(4);
    expect(
      changed.result.state.surface.channels[inventoryChannel][0] / grid.measures[0]
    ).toBeCloseTo(33, 12);
  } finally {
    atlasGenerationModules.unregister(statefulInventoryModule.id);
  }
});

it("disabled stateful capability contributes no operations, inventory or output layer", async () => {
  atlasGenerationModules.register(statefulInventoryModule);
  try {
    const { result, recipe } = await execute(2, false);
    expect(ownOperations(recipe.sequence)).toEqual([]);
    expect(result.state.history).toEqual([]);
    expect(result.state.facts.has("test:inventory")).toBe(false);
    expect(result.state.surface.channels[inventoryChannel]).toBeUndefined();
    expect(result.state.domain.world.layers[inventoryLayer]).toBeUndefined();
    expect(result.state.domain.world.fields.some((field) => field.layerId === inventoryLayer)).toBe(
      false
    );
  } finally {
    atlasGenerationModules.unregister(statefulInventoryModule.id);
  }
});
