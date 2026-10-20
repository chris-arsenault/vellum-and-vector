import { expect, it } from "vitest";
import { createGrid } from "@atlas/domain";
import { createWorld, session } from "./atlasState";
import {
  ProductLedger,
  bindNativeFacts,
  processRequirements,
} from "../../packages/generation/src/productLedger";
import {
  initialSteps,
  climateSteps,
  drainageSteps,
  incisionSteps,
  sedimentStep,
  glaciationSteps,
  iceSteps,
  extractionSteps,
} from "../../packages/generation/src/canonry/sequence";
import type { GenerationState, MapProcessContext } from "@atlas/generation";
import { atlasRegistry, executeProcessBehavior, prepareAtlasGeneration } from "@atlas/generation";

function scenario() {
  const world = createWorld({
    name: "Fixed world geology",
    seed: 104729,
    width: 4_000_000,
    height: 2_000_000,
  });
  const source = structuredClone(session(world.id).snapshot);
  const areaId = Object.keys(world.areas)[0];
  const scope = { ...source.scope, areaId, footprint: world.areas[areaId].footprint };
  const state: GenerationState = {
    domain: { ...source, scope },
    surface: createGrid("geology", scope, 16, 8),
    facts: new Set(),
    history: [],
  };
  const input = { areaId, seed: world.seed, quality: "draft", domains: ["physical"] };
  const prepared = prepareAtlasGeneration(source, input);
  const registry = atlasRegistry(prepared.source, prepared.input);
  const products = new ProductLedger(state.facts, registry.productDefinitions());
  const context: MapProcessContext = {
    scope,
    invocation: [],
    parameters: { initial: true },
    inputs: prepared.input.configuration!.inputs,
    products,
    epochs: [],
    epochIndices: [],
    causes: [],
    recordCause() {},
    random: () => 0.5,
    cancelled: () => false,
    progress() {},
  };
  const apply = async (id: string) => {
    const started = performance.now();
    const process = registry.get(id, "0f62584c");
    bindNativeFacts(state, products);
    for (const input of processRequirements(process.contract))
      expect(products.accepts(input), `${id} requires ${input.product}`).toBe(true);
    await executeProcessBehavior(process, state, context);
    bindNativeFacts(state, products);
    expect(process.validate(state, context).filter((item) => item.severity === "error")).toEqual(
      []
    );
    products.commit(process.contract, id);
    console.log(id, {
      seconds: (performance.now() - started) / 1000,
      cells: state.physical!.map.mesh.count,
    });
    await new Promise<void>((resolve) => setImmediate(resolve));
  };
  return { state, context, apply };
}
it("evolves fixed world geology, rivers, sediment and a glacial transition", async () => {
  const { state, context, apply } = scenario();
  await apply("canonry.initialize");
  for (const [name] of initialSteps) await apply(`canonry.${name}`);
  const map = state.physical!.map;
  expect(map.mesh.topology).toBeNull();
  const mesh = map.mesh;
  expect(map.events.some((e) => e.kind === "impact")).toBe(true);
  expect(map.events.some((e) => e.kind === "volcano")).toBe(true);
  expect(map.ImpactExcavation.some((v) => v > 0)).toBe(true);
  expect(map.VolcanicConstructionHistory.some((v) => v > 0)).toBe(true);
  expect(map.faults.length).toBeGreaterThan(0);
  expect(map.Elevation.every(Number.isFinite)).toBe(true);
  context.parameters.initial = false;
  context.epochIndices = [0];
  for (const [name] of [...climateSteps, ...drainageSteps]) await apply(`canonry.${name}`);
  for (const [name] of [...incisionSteps, ...climateSteps, ...drainageSteps, sedimentStep])
    await apply(`canonry.${name}`);
  const evolved = state.physical!.map;
  expect(evolved.CumulativeFluvialErosion.some((v) => v > 0)).toBe(true);
  expect(evolved.RiverOrders.some((v) => v > 0)).toBe(true);
  expect(
    Math.abs(
      evolved.SedimentProducedTotal - evolved.SedimentDepositedTotal - evolved.SedimentExportedTotal
    )
  ).toBeLessThan(evolved.SedimentProducedTotal * 1e-9);
  context.epochIndices = [1];
  context.parameters.iceLoad = true;
  for (const [name] of [...climateSteps, ...drainageSteps, ...glaciationSteps]) {
    await apply(`canonry.${name}`);
  }
  const glacial = state.physical!.map;
  expect(glacial.CumulativeGlacialErosion.some((v) => v > 0)).toBe(true);
  const coldIce = glacial.IceThickness.reduce((v, h, i) => v + h * glacial.mesh.areas[i], 0);
  expect(coldIce).toBeGreaterThan(0);
  context.epochIndices = [2];
  context.parameters.iceLoad = false;
  for (const [name] of [...climateSteps, ...drainageSteps, ...iceSteps, ...extractionSteps])
    await apply(`canonry.${name}`);
  const present = state.physical!.map;
  const warmIce = present.IceThickness.reduce((v, h, i) => v + h * present.mesh.areas[i], 0);
  expect(warmIce).toBeLessThan(coldIce);
  expect(present.MaximumIceThickness.some((v) => v > 0)).toBe(true);
  expect(present.mesh).toBe(mesh);
}, 600000);
