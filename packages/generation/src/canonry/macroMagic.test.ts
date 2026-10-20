import { expect, it } from "vitest";
import { canonryMagicPresets, magicSystemSchema } from "@atlas/domain";
import { macroFixture } from "./macroFixtures";
import { initializeMagic } from "./magicState";
import { classifyMagicFeatures } from "./magicFeatures";
import { composeMagicalRegions } from "./macroMagic";
import { nearestTriangle } from "./mesh";

it.each(["source", "corridor", "region", "front", "interaction"] as const)(
  "composes a configured %s without relying on a preset identity",
  (role) => {
    const state = macroFixture(),
      work = state.physical!,
      map = work.map,
      mesh = map.mesh,
      hole = nearestTriangle(mesh, 0, 0);
    state.domain.world.magicSystems = [
      magicSystemSchema.parse({
        id: "custom",
        name: "Custom",
        source: "placed",
        propagation: "radial",
        phase: "climate",
        effects: { heat: 0.2 },
        features: [
          {
            id: "shape",
            name: "Shape",
            seeds: [[{ field: "history", min: 1 }]],
            composition: { role, scale: 35_000 },
          },
        ],
      }),
    ];
    initializeMagic(state);
    const field = work.magic!.fields[0];
    for (let i = 0; i < mesh.count; i++)
      if (Math.hypot(mesh.x[i], mesh.y[i]) < 70_000 && i !== hole) {
        field.history[i] = 500;
        field.stored[i] = 50;
        field.retained[i] = mesh.areas[i] * 7;
        field.firstEpoch[i] = 2;
        field.wake[i] = 1;
      }
    const stored = field.stored.reduce((sum, value, i) => sum + value * mesh.areas[i], 0),
      retained = field.retained.reduce((a, b) => a + b, 0);
    classifyMagicFeatures(state);
    const originalCount = field.features.shape.reduce((a, b) => a + b, 0);
    composeMagicalRegions(state, 42);
    if (["front", "interaction"].includes(role)) expect(field.features.shape[hole]).toBe(0);
    if (["source", "region"].includes(role)) {
      expect(field.features.shape[hole]).toBe(1);
      expect(field.history[hole]).toBeGreaterThan(0);
      expect(field.firstEpoch[hole]).toBe(2);
    }
    if (["source", "corridor", "front"].includes(role))
      expect(field.features.shape.reduce((a, b) => a + b, 0)).toBeLessThan(originalCount);
    expect(
      field.stored.reduce((sum, value, i) => sum + value * mesh.areas[i], 0) / stored
    ).toBeCloseTo(1, 10);
    expect(field.retained.reduce((a, b) => a + b, 0) / retained).toBeCloseTo(1, 10);
    expect(field.intensity[hole]).toBe(0);
    expect(map.CompletedEpochCount).toBe(0);
  }
);

it("retains all eighteen configured rules and independent interactions with their owner disabled", () => {
  const state = macroFixture(),
    work = state.physical!;
  state.domain.world.magicSystems = canonryMagicPresets();
  initializeMagic(state);
  const fields = work.magic!.fields;
  fields[0].intensity.fill(500);
  fields[1].intensity.fill(500);
  fields[2].definition.enabled = false;
  classifyMagicFeatures(state);
  composeMagicalRegions(state, 42);
  expect(fields.flatMap((f) => f.definition.features)).toHaveLength(18);
  expect(fields[2].features.war.every(Boolean)).toBe(true);
  expect(fields[2].features.crush).toBeUndefined();
  expect(fields[2].intensity.every((v) => v === 0)).toBe(true);
});
