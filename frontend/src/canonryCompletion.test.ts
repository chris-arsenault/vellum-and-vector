import { expect, it } from "vitest";
import { generateAtlas } from "@atlas/generation";
import { createWorld, session } from "./atlasState";
import { generationSnapshot } from "./generationJobs";
import { commitCommand } from "./atlasCommands";
import { makeCommand } from "./useAtlas";

it("evolves impacts, repeated ice ages and all three magic systems through shared physical history", async () => {
  const world = createWorld({
    name: "Complete history",
    seed: 104729,
    width: 4_000_000,
    height: 2_000_000,
  });
  const source = structuredClone(session(world.id).snapshot),
    present = world.epochs.at(-1)!;
  source.world.epochs = [
    { ...world.epochs[0], duration: 2000 },
    { ...present, id: "First ice age", ice: 1, temperature: -20, seaLevel: -100 },
    { ...present, id: "Interglacial", ice: 0.2, temperature: 20 },
    { ...present, id: "Second ice age", ice: 1, temperature: -15, seaLevel: -70 },
    present,
  ];
  const input = {
    areaId: Object.keys(world.areas)[0],
    seed: world.seed,
    quality: "draft",
    domains: ["physical", "magic"],
  };
  const epochs: { ice: number; history: number; impacts: number }[] = [];
  const started = performance.now();
  const result = await generateAtlas(source, input, {
    async saveBoundary(boundary) {
      if (boundary.kind !== "epoch") return;
      const map = boundary.state.physical!.map;
      epochs.push({
        ice: map.IceThickness.reduce((sum, value) => sum + value, 0),
        history: map.MaximumIceThickness.reduce((sum, value) => sum + value, 0),
        impacts: map.ImpactExcavation.reduce((sum, value) => sum + value, 0),
      });
    },
  });
  expect(epochs).toHaveLength(5);
  expect(epochs[1].ice).toBeGreaterThan(epochs[0].ice);
  expect(epochs[2].ice).toBeLessThan(epochs[1].ice);
  expect(epochs[3].ice).toBeGreaterThan(epochs[2].ice);
  expect(epochs[4].history).toBeGreaterThan(epochs[4].ice);
  expect(epochs[0].impacts).toBeGreaterThan(0);
  expect(epochs[4].impacts).toBeGreaterThanOrEqual(epochs[0].impacts);
  const grid = result.state.surface;
  for (const id of ["fire", "aurora", "pressure"]) {
    // Warm present-day terrain can lose Aurora while retaining its glacial history.
    if (id !== "aurora")
      expect(
        grid.channels[`magic:${id}:intensity`].some((value) => value > 0),
        id
      ).toBe(true);
    expect(grid.channels[`magic:${id}:history`].some((value) => value > 0)).toBe(true);
    expect(
      result.state.history.every((entry) =>
        entry.causes.some(
          (cause) =>
            cause.kind === "domain" &&
            cause.description.startsWith(id[0].toUpperCase() + id.slice(1))
        )
      )
    ).toBe(true);
  }
  expect(grid.channels.naturalSurface).toBeDefined();
  expect(grid.channels.finalSurface).not.toEqual(grid.channels.naturalSurface);
  const features = Object.values(result.state.domain.world.features);
  expect(features.some((feature) => feature.kind === "crater")).toBe(true);
  expect(features.some((feature) => feature.layerId === "magic")).toBe(true);
  expect(result.state.history[0].ancestry[0].duration).toBe(2000);
  expect(result.state.physical).toBeUndefined();
  const published = generationSnapshot(result, input, crypto.randomUUID());
  expect(published.world.fields.find((field) => field.layerId === "magic")?.channels).toContain(
    "magic:pressure:coastalHistory"
  );
  console.log(
    `Five-epoch draft with Fire, Aurora and Pressure: ${((performance.now() - started) / 1000).toFixed(2)} s`
  );
}, 120000);

it("authors a variant through the shared operation and preserves it when settings change", () => {
  const world = createWorld({ name: "Configurable magic", seed: 9, width: 1000, height: 1000 });
  const variant = {
    ...world.magicSystems![0],
    id: "new-system",
    name: "Ice forging",
    effects: {
      heat: -0.2,
      iceMelt: -0.3,
      rockResistance: 500,
      coastalForcing: 0,
    },
  };
  let current = commitCommand(
    world.id,
    makeCommand(world, "setMagicSystems", {
      systems: [...world.magicSystems!, variant],
    })
  ).candidate;
  expect(current.magicSystems?.at(-1)?.name).toBe("Ice forging");
  current = commitCommand(
    world.id,
    makeCommand(current, "setWorldSettings", {
      name: "Revised world",
      seed: 10,
    })
  ).candidate;
  expect(current.magicSystems?.at(-1)?.effects.heat).toBe(-0.2);
});
