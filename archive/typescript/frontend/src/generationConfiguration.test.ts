import { fixtureWorld, fixtureState } from "./testSupport/workspaceFixture";
import { expect, it } from "vitest";
import {
  prepareAtlasGeneration,
  preflight,
  MapProcessRegistry,
  type MapProcess,
  type ProcessConfiguration,
} from "@atlas/generation";
import { planHash } from "../../packages/generation/src/planHash";
import { mapCommand } from "../../packages/generation/src/processTraits";

function request() {
  const world = fixtureWorld({
    name: "Resolved world",
    seed: 42,
    width: 1_000_000,
    height: 500_000,
  });
  const source = fixtureState(world.id).snapshot;
  return {
    source,
    input: {
      areaId: source.scope.areaId,
      quality: "draft",
      domains: ["physical", "magic"],
      seed: 73,
    },
  };
}
it("includes every ecological epoch input in configuration identity and pins the reviewed request", async () => {
  const { source, input } = request();
  const prepared = prepareAtlasGeneration(source, input);
  expect(prepared.diagnostics).toEqual([]);
  const changed = structuredClone(prepared.input);
  changed.configuration = undefined;
  changed.settings!.epochs[0].ecology = { rainfall: 0.2, migration: 2 };
  const next = prepareAtlasGeneration(source, changed);
  expect(await planHash(prepared.input.configuration)).not.toBe(
    await planHash(next.input.configuration)
  );
  expect(prepareAtlasGeneration(source, prepared.input).input).toEqual(prepared.input);
  expect(() =>
    prepareAtlasGeneration(source, { ...next.input, configuration: prepared.input.configuration })
  ).toThrow("reviewed configuration");
  expect(source.world.seed).toBe(42);
});

it("diagnoses an invalidated fact at its actual causal invocation", async () => {
  const make = (
    id: string,
    requires: string[],
    produces: string[],
    invalidates: string[]
  ): MapProcess => ({
    contract: { id, version: "1", parameters: {}, requires, produces, invalidates },
    operation: mapCommand(id, "event", () => undefined, []),
    validate: () => [],
  });
  const registry = new MapProcessRegistry()
    .register(make("rain", [], ["rain"], []))
    .register(make("terrain", [], [], ["rain"]))
    .register(make("Runoff", ["rain"], [], []));
  const configuration: ProcessConfiguration = {
    id: "test",
    version: 1,
    parameters: {},
    sequence: ["rain", "terrain", "Runoff"].map((process) => ({
      kind: "process",
      process,
      id: process,
      version: "1",
    })),
  };
  const errors = preflight(configuration, registry);
  expect(errors).toHaveLength(1);
  expect(errors[0]).toMatchObject({ invocation: "Runoff", resource: "rain" });
  expect(errors[0].message).toContain("invalidated by terrain");
});

it("explains omitted feature dependencies", async () => {
  const { source, input } = request();
  const climate = prepareAtlasGeneration(source, {
    ...input,
    features: { "physical.climate": { enabled: false } },
  });
  expect(climate.diagnostics.some((item) => item.resource === "physical.climate")).toBe(true);
  expect(() =>
    prepareAtlasGeneration(source, { ...input, features: { misspelled: { enabled: false } } })
  ).toThrow("Unknown generation feature");
  const delta = prepareAtlasGeneration(source, {
    ...input,
    features: { "physical.floodplains": { enabled: false } },
  });
  expect(
    delta.diagnostics.some((diagnostic) => diagnostic.resource === "physical.floodplains")
  ).toBe(true);
});

it("rejects a world request that leaves out land, climate and water", () => {
  const { source, input } = request();
  expect(() => prepareAtlasGeneration(source, { ...input, domains: ["magic"] })).toThrow(
    "Land, climate and water always generate"
  );
});
