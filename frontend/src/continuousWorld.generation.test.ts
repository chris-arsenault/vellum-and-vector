import { expect, it } from "vitest";
import { mkdir, writeFile } from "node:fs/promises";
import { serialize } from "node:v8";
import { generateAtlas } from "@atlas/generation";
import { gridSurfaceSchema, fieldInterpolator, spatial, biomes } from "@atlas/domain";
import { createWorld, session } from "./atlasState";
import { generationSnapshot } from "./generationJobs";

it("publishes the complete causal Draft world with shared continuous field support", async () => {
  const world = createWorld({
    name: "Continuous causal geography",
    seed: 104729,
    width: 4e6,
    height: 3e6,
  });
  const source = session(world.id).snapshot;
  const input = {
    areaId: source.scope.areaId,
    seed: world.seed,
    quality: "draft",
    domains: ["physical", "magic", "cultural", "political", "built"],
  };
  const result = await generateAtlas(source, input, {
    progress(path, _fraction, message) {
      if (message.startsWith("Starting ") || message.startsWith("Completed "))
        console.log(path.join("/"), message);
    },
  });
  const grid = result.state.surface,
    features = result.state.domain.world.features;
  checkEcologicalWitnesses(grid, features);
  await mkdir(".artifacts/generation", { recursive: true });
  await writeFile(
    ".artifacts/generation/fixed-continuous-draft.bin",
    serialize({ grid, features })
  );
  expect(result.state.history).toHaveLength(source.world.epochs.length);
  expect(grid.geography?.biome).toBeDefined();
  for (const kind of ["river", "lake", "forest", "settlement", "sovereignty"])
    expect(
      Object.values(features).some((f) => f.kind === kind),
      kind
    ).toBe(true);
  for (const id of ["fire", "aurora", "pressure"])
    expect(
      grid.channels[`magic:${id}:history`].some((value) => value > 0),
      id
    ).toBe(true);
  const published = generationSnapshot(result, input, crypto.randomUUID());
  for (const field of published.world.fields) {
    const data = published.numerical[field.id];
    expect(() => gridSurfaceSchema.parse(data)).not.toThrow();
    if (field.channels?.includes("water")) expect(data.geography?.water).toBeDefined();
    for (const channel of field.channels ?? []) {
      const p = { x: 1_234_567, y: 1_345_678, z: 0 };
      expect(fieldInterpolator(data, channel)(p)).toBeCloseTo(
        fieldInterpolator(grid, channel)(p),
        7
      );
    }
  }
  console.log(
    JSON.stringify({
      features: Object.keys(features).length,
      classificationCodes: grid.geography!.biome!.codes,
    })
  );
}, 600_000);

function checkEcologicalWitnesses(
  grid: Parameters<typeof fieldInterpolator>[0],
  features: ReturnType<typeof session>["snapshot"]["world"]["features"]
) {
  const read = fieldInterpolator(grid, "biome"),
    regions = Object.values(features).filter((feature) => feature.attributes.biome);
  // Independent review found missing interior patches and a curved boundary
  // which a single midpoint probe accepted despite a kilometre-scale error.
  for (const [x, y] of [
    [814610.522, 392853.07],
    [2491384.126, 80258.605],
    [815240, 385950],
    [1135240, 35950],
    [1395776.374, 1210234.694],
    [3792727.081, 1491711.285],
  ]) {
    const code = read({ x, y, z: 0 }),
      candidates = regions.filter((feature) => feature.attributes.biome === biomes[code].name),
      point = { type: "Point" as const, coordinates: [x, y] };
    expect(candidates.length, `${x},${y}`).toBeGreaterThan(0);
    const distance = Math.min(
      ...candidates.map((feature) => spatial.distance(feature.geometry, point))
    );
    expect(distance, `biome ${code} at ${x},${y}`).toBeLessThanOrEqual(10);
  }
}
