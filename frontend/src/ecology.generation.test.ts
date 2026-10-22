import { expect, it } from "vitest";
import { generateAtlas } from "@atlas/generation";
import { gridPosition, sample, magicSystemSchema, type DomainSnapshot } from "@atlas/domain";
import { createWorld, session } from "./atlasState";
import { generationSnapshot } from "./generationJobs";

it("generates forests and ecological history through the real atlas pipeline and publishes them", async () => {
  const world = createWorld({
    name: "Living basin",
    seed: 104729,
    width: 2_000_000,
    height: 1_000_000,
  });
  const regimes = [
    { name: "Wet expansion", temperature: 22, rain: 1.4, season: 0.15, fire: 0.3, ice: 0 },
    { name: "Dry fire period", temperature: 28, rain: 0.3, season: 0.85, fire: 3, ice: 0 },
    // A global mean of 2 °C glaciates the poleward land and leaves warm-edge refugia.
    { name: "Cold retreat", temperature: 2, rain: 0.7, season: 0.65, fire: 0.2, ice: 0.8 },
    { name: "Recovery", temperature: 20, rain: 1.2, season: 0.3, fire: 0.5, ice: 0 },
  ];
  world.epochs = regimes.map((regime) => ({
    id: regime.name,
    temperature: regime.temperature,
    duration: 5000,
    seaLevel: 0,
    tectonics: 0.4,
    hydrology: 1,
    ice: regime.ice,
    coasts: 1,
    ecology: { rainfall: regime.rain, seasonality: regime.season, fire: regime.fire },
  }));
  const domain = session(world.id).snapshot;
  const input = {
    areaId: domain.scope.areaId,
    quality: "draft",
    seed: world.seed,
    domains: ["physical"],
    parameters: { impacts: 0, volcanism: 0.2, plateDrift: 0.2 },
  };
  const epochs: number[] = [];
  const result = await generateAtlas(domain, input, {
    async saveBoundary(boundary) {
      if (boundary.kind !== "epoch") return;
      const map = boundary.state.physical!.map;
      const integral = (values: Float64Array) =>
        values.reduce((sum, value, i) => sum + value * map.mesh.contentAreas[i], 0);
      epochs.push(integral(map.TreeCover) / 1e6);
    },
  });
  expect(epochs).toHaveLength(4);
  expect(epochs[1]).toBeLessThan(epochs[0]);
  const fields = result.state.surface.channels;
  const codes = [...new Set(fields.biome)];
  expect(codes.length).toBeGreaterThan(3);
  expect(fields.treeCover.some((value) => value > 0.4)).toBe(true);
  expect(fields.herbivores.some((value) => value > 0)).toBe(true);
  expect(fields.predators.some((value) => value > 0)).toBe(true);
  expect(fields.peatCarbon.some((value) => value > 0)).toBe(true);
  expect(fields.aquaticFauna.some((value) => value > 0)).toBe(true);
  expect(
    Object.values(result.state.domain.world.features).some((feature) => feature.kind === "forest")
  ).toBe(true);
  expect(result.state.history).toHaveLength(4);
  for (const epoch of result.state.history)
    expect(
      epoch.causes.some((cause) => cause.kind === "domain" && cause.process === "atlas.ecology")
    ).toBe(true);
  const published = generationSnapshot(result, input, crypto.randomUUID());
  const ecology = published.world.fields.find((field) => field.layerId === "ecology")!;
  expect(ecology.channels).toContain("biome");
  expect(ecology.channels).toContain("broadleafSaplings");
  expect(ecology.channels).toContain("soilWater");
  expect(ecology.channels).toContain("migrationFlux");
  expect(published.numerical[ecology.id].quantities?.biome).toBe("category");
  await checkMagicPublication(published, input);
}, 600_000);

async function checkMagicPublication(
  snapshot: DomainSnapshot,
  input: Parameters<typeof generateAtlas>[1]
) {
  const ecology = snapshot.world.fields.find((f) => f.layerId === "ecology")!;
  const elevation = snapshot.world.fields.find((f) => f.layerId === "elevation")!;
  const source = snapshot.numerical[ecology.id];
  const forest = source.channels.treeCover.findIndex((v) => v > 0.4);
  const position = gridPosition(source, forest);
  const magical = structuredClone(snapshot);
  magical.world.magicSystems = [
    magicSystemSchema.parse({
      id: "wildwood",
      name: "Wildwood",
      source: "placed",
      propagation: "radial",
      phase: "climate",
      effects: { ecologicalAlteration: 1, plantColdTolerance: 20, animalToxicity: 0.5 },
    }),
  ];
  magical.world.magic.push({
    id: crypto.randomUUID(),
    systemId: "wildwood",
    name: "Altered forest source",
    source: position,
    radius: 10_000_000,
    strength: 1000,
    propagation: "radial",
    effect: "growth",
    decay: 0,
    storage: 0,
    dependsOn: null,
    startsAtEpoch: 0,
    spaceId: snapshot.scope.spaceId,
  });
  const result = await generateAtlas(magical, { ...input, domains: ["magic"] });
  expect(result.state.history).toHaveLength(0);
  expect(result.state.surface.channels.alteredCover.some((v) => v > 0.2)).toBe(true);
  expect(result.state.surface.channels.biome.some((v) => v === 15)).toBe(true);
  expect(
    Object.values(result.state.domain.world.features).some(
      (f) => f.layerId === "ecology" && f.attributes.biome === "Altered woodland"
    )
  ).toBe(true);
  expect(sample(result.state.surface, "elevation", position)).toBeCloseTo(
    sample(snapshot.numerical[elevation.id], "elevation", position),
    8
  );
  for (const feature of Object.values(magical.world.features))
    if (["volcano", "caldera"].includes(feature.kind))
      expect(result.state.domain.world.features[feature.id]).toEqual(feature);
  const published = generationSnapshot(
    result,
    { ...input, domains: ["magic"] },
    crypto.randomUUID(),
    magical
  );
  expect(published.numerical[ecology.id].channels.alteredCover.some((v) => v > 0.2)).toBe(true);
}
