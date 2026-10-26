import { expect, it } from "vitest";
import { generateAtlas } from "@atlas/generation";
import { createWorld, session } from "./atlasState";
import { generationSnapshot } from "./generationJobs";
import { mkdir, writeFile } from "node:fs/promises";
import { serialize } from "node:v8";
import { tilePainter, rasterLimits } from "./rasterTiles";
import { spatial, type GridSurface } from "@atlas/domain";
import type { AtlasFeature } from "./types";

function checkMagic(result: Awaited<ReturnType<typeof generateAtlas>>) {
  const grid = result.state.surface;
  const physicalEpochs = new Set(result.state.domain.world.epochs.map((epoch) => epoch.id)),
    physicalHistory = result.state.history.filter((entry) =>
      physicalEpochs.has(entry.ancestry[0].id)
    );
  expect(physicalHistory).toHaveLength(physicalEpochs.size);
  for (const id of ["fire", "aurora", "pressure"]) {
    // Warm present-day terrain can lose Aurora while retaining its glacial history.
    if (id !== "aurora")
      expect(
        grid.channels[`magic:${id}:intensity`].some((value) => value > 0),
        id
      ).toBe(true);
    expect(grid.channels[`magic:${id}:history`].some((value) => value > 0)).toBe(true);
    expect(
      physicalHistory.every((entry) =>
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
}

async function saveDisplayFixture(grid: GridSurface, features: AtlasFeature[]) {
  const directory = ".artifacts/generation";
  await mkdir(directory, { recursive: true });
  await writeFile(`${directory}/completed-world.bin`, serialize({ grid, features }));
  const raster = {
    id: grid.id,
    areaId: grid.scope.areaId,
    footprint: grid.scope.footprint,
    bounds: grid.bounds,
    channel: "elevation",
    field: grid,
    water: grid,
    ice: grid,
    lakes: features
      .filter((f) => f.kind === "lake" && typeof f.attributes.waterLevel === "number")
      .map((f) => ({ geometry: f.geometry, level: Number(f.attributes.waterLevel) })),
  };
  const paint = tilePainter(raster, rasterLimits([raster]));
  const views: [string, number[]][] = [["overview", grid.bounds]];
  for (const kind of ["crater", "volcano", "gorge", "waterfall", "peak", "lake"]) {
    const feature = features.find((f) => f.kind === kind);
    if (!feature) continue;
    const bounds = spatial.bounds(feature.geometry);
    const point = [(bounds[0] + bounds[2]) / 2, (bounds[1] + bounds[3]) / 2];
    const radius =
      typeof feature.attributes.radius === "number" ? feature.attributes.radius * 1.6 : 30_000;
    views.push([
      kind,
      [point[0] - radius, point[1] - radius, point[0] + radius, point[1] + radius],
    ]);
  }
  for (const [name, extent] of views) {
    const rgba = paint(extent, 768),
      rgb = new Uint8Array(768 * 768 * 3);
    for (let i = 0; i < 768 * 768; i++) rgb.set(rgba.subarray(i * 4, i * 4 + 3), i * 3);
    await writeFile(
      `${directory}/world-${name}.ppm`,
      Buffer.concat([Buffer.from("P6\n768 768\n255\n"), rgb])
    );
  }
}

it("publishes one evolved world with every domain for geographic display review", async () => {
  const world = createWorld({
    name: "World display",
    seed: 104729,
    width: 2_000_000,
    height: 1_000_000,
  });
  const source = structuredClone(session(world.id).snapshot);
  source.world.epochs = [source.world.epochs[0]];
  const input = {
    areaId: Object.keys(world.areas)[0],
    seed: world.seed,
    quality: "draft",
    domains: ["physical", "magic", "cultural", "political", "built"],
  };
  let started = performance.now();
  const result = await generateAtlas(source, input, {
    progress(path, _fraction, message) {
      if (message.startsWith("Starting ")) started = performance.now();
      if (message.startsWith("Completed ") && performance.now() - started > 1000)
        console.log(path.join("/"), ((performance.now() - started) / 1000).toFixed(2), "seconds");
    },
  });
  const features = Object.values(result.state.domain.world.features);
  await saveDisplayFixture(result.state.surface, features);
  expect(result.state.physical).toBeUndefined();
  const published = generationSnapshot(result, input, crypto.randomUUID());
  expect(features.some((feature) => feature.kind === "settlement")).toBe(true);
  expect(features.some((feature) => feature.kind === "sovereignty")).toBe(true);
  expect(published.world.fields.some((field) => field.layerId === "magic")).toBe(true);
}, 600_000);

it("evolves impacts, repeated ice ages and all three magic systems through shared physical history", async () => {
  const world = createWorld({
    name: "Complete history",
    seed: 104729,
    width: 2_000_000,
    height: 1_000_000,
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
    domains: ["physical", "magic", "cultural", "political", "built"],
  };
  const epochs: { ice: number; history: number; impacts: number }[] = [];
  const physicalEpochs = new Set(source.world.epochs.map((epoch) => epoch.id));
  const started = performance.now();
  let stepStarted = started;
  const result = await generateAtlas(source, input, {
    progress(path, _fraction, message) {
      if (message.startsWith("Starting ")) stepStarted = performance.now();
      if (message.startsWith("Completed ") && performance.now() - stepStarted > 1000)
        console.log(
          path.join("/"),
          ((performance.now() - stepStarted) / 1000).toFixed(2),
          "seconds"
        );
    },
    async saveBoundary(boundary) {
      if (boundary.kind !== "epoch" || !physicalEpochs.has(boundary.ancestry[0]?.id)) return;
      const map = boundary.state.physical!.map;
      epochs.push({
        ice: map.IceThickness.reduce((sum, value) => sum + value, 0),
        history: map.MaximumIceThickness.reduce((sum, value) => sum + value, 0),
        impacts: map.ImpactExcavation.reduce((sum, value) => sum + value, 0),
      });
      console.log("Completed epoch", epochs.length, "with", map.mesh.count, "physical cells");
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
  checkMagic(result);
  const features = Object.values(result.state.domain.world.features);
  expect(features.some((feature) => feature.kind === "crater")).toBe(true);
  expect(features.some((feature) => feature.layerId === "magic")).toBe(true);
  expect(result.state.history[0].ancestry[0].duration).toBe(2000);
  expect(result.state.physical).toBeUndefined();
  const published = generationSnapshot(result, input, crypto.randomUUID());
  expect(published.world.fields.find((field) => field.layerId === "magic")?.channels).toContain(
    "magic:pressure:coastalHistory"
  );
  expect(grid.topology).toBeUndefined();
  expect(features.some((feature) => feature.kind === "settlement")).toBe(true);
  expect(features.some((feature) => feature.kind === "sovereignty")).toBe(true);
  await saveDisplayFixture(grid, features);
  console.log(
    `Five-epoch draft with Fire, Aurora and Pressure: ${((performance.now() - started) / 1000).toFixed(2)} s`
  );
}, 3_600_000);
