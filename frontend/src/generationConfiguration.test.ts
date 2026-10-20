import { expect, it } from "vitest";
import {
  prepareAtlasGeneration,
  preflight,
  MapProcessRegistry,
  type MapProcess,
  type ProcessConfiguration,
} from "@atlas/generation";
import { planHash } from "../../packages/generation/src/planHash";
import { createWorld, session } from "./atlasState";
import { createGrid, putChannel } from "@atlas/domain";

function request() {
  const world = createWorld({
    name: "Resolved world",
    seed: 42,
    width: 1_000_000,
    height: 500_000,
  });
  const source = session(world.id).snapshot;
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

it("diagnoses an invalidated fact at its actual causal invocation", () => {
  const make = (
    id: string,
    requires: string[],
    produces: string[],
    invalidates: string[]
  ): MapProcess => ({
    contract: { id, version: "1", parameters: {}, requires, produces, invalidates },
    apply() {},
    validate: () => [],
  });
  const registry = new MapProcessRegistry()
    .register(make("rain", [], ["rain"], []))
    .register(make("terrain", [], [], ["rain"]))
    .register(make("runoff", ["rain"], [], []));
  const configuration: ProcessConfiguration = {
    id: "test",
    version: 1,
    parameters: {},
    sequence: ["rain", "terrain", "runoff"].map((process) => ({
      kind: "process",
      process,
      id: process,
      version: "1",
    })),
  };
  const errors = preflight(configuration, registry);
  expect(errors).toHaveLength(1);
  expect(errors[0]).toMatchObject({ invocation: "runoff", resource: "rain" });
  expect(errors[0].message).toContain("invalidated by terrain");
});

it("rejects required-step switches and explains selectable dependencies", () => {
  const { source, input } = request();
  expect(() =>
    prepareAtlasGeneration(source, { ...input, processes: { "canonry.temperature": false } })
  ).toThrow("required");
  expect(() =>
    prepareAtlasGeneration(source, { ...input, processes: { misspelled: false } })
  ).toThrow("Unknown process");
  const mismatched = prepareAtlasGeneration(source, {
    ...input,
    processes: { "canonry.glacial-erosion": false },
  });
  expect(mismatched.diagnostics.some((diagnostic) => diagnostic.code === "coupled_processes")).toBe(
    true
  );
  const delta = prepareAtlasGeneration(source, {
    ...input,
    processes: { "canonry.river-floodplains": false },
  });
  expect(
    delta.diagnostics.some((diagnostic) => diagnostic.resource === "canonry:Floodplains")
  ).toBe(true);
});

it("accepts authored elevation with initialized absent histories and rejects mismatched units", () => {
  const { source, input } = request();
  const id = crypto.randomUUID();
  const grid = createGrid(id, source.scope, 4, 4);
  putChannel(grid, "elevation", "metre", new Float64Array(16).fill(100));
  source.numerical[id] = grid;
  source.world.fields.push({
    id,
    areaId: source.scope.areaId,
    spaceId: source.scope.spaceId,
    layerId: "terrain",
    algorithm: "authored",
    source: { kind: "operation", id: crypto.randomUUID() },
    samples: 16,
    channels: ["elevation"],
  });
  const prepared = prepareAtlasGeneration(source, { ...input, domains: ["magic"] });
  expect(prepared.diagnostics).toEqual([]);
  const validation = prepared.registry
    .contracts()
    .find((contract) => contract.id.endsWith("physical-structural-validation"))!;
  expect(validation.requires).not.toContain("canonry:Impacts");
  grid.units.elevation = "ratio";
  expect(() => prepareAtlasGeneration(source, { ...input, domains: ["magic"] })).toThrow(
    "Inherited elevation requires metre"
  );
});
