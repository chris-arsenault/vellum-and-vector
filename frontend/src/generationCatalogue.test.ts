import { expect, it } from "vitest";
import {
  atlasRegistry,
  atlasConfiguration,
  describeProcess,
  atlasParametersSchema,
  atlasParameterDefinitions,
} from "@atlas/generation";
import { sequenceStages } from "../../packages/generation/src/sequence";
import { createWorld, session } from "./atlasState";

it("describes every active invocation without constructing a physical workspace", () => {
  const world = createWorld({ name: "Catalogue", seed: 42, width: 10000, height: 10000 });
  const source = session(world.id).snapshot;
  const input = {
    areaId: source.scope.areaId,
    domains: ["physical", "magic", "cultural", "political", "built"],
    quality: "draft",
    seed: 42,
  };
  const registry = atlasRegistry(source, input);
  for (const stage of sequenceStages(atlasConfiguration(source, input).sequence)) {
    if (!stage.invocation) continue;
    const contract = registry.get(stage.invocation.process, stage.invocation.version).contract;
    expect(describeProcess(contract).label.length).toBeGreaterThan(2);
  }
  expect(registry.contracts().some((contract) => contract.id === "atlas.ecology-respond")).toBe(
    true
  );
  expect(source.numerical).toEqual({});
});

it("validates creator controls from the same definitions used to present them", () => {
  for (const [key, definition] of Object.entries(atlasParameterDefinitions)) {
    expect(atlasParametersSchema.parse({})[key as keyof typeof atlasParameterDefinitions]).toBe(
      definition.default
    );
    expect(atlasParametersSchema.safeParse({ [key]: definition.minimum - 1 }).success).toBe(false);
  }
  expect(atlasParametersSchema.safeParse({ rainfallTypo: 2 }).success).toBe(false);
  expect(atlasParametersSchema.parse({ rainfall: 0, impactSize: 0.01 }).rainfall).toBe(0);
});
