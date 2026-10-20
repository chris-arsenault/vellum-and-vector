import { expect, it } from "vitest";
import { atlasConfiguration, defaultAtlasParameters, generateAtlas } from "@atlas/generation";
import { createWorld, session } from "./atlasState";
import { generationSnapshot } from "./generationJobs";

it("changes real geography, retains chosen inputs, and rejects invalid settings", async () => {
  const world = createWorld({
      name: "Controls",
      seed: 104729,
      width: 4_000_000,
      height: 2_000_000,
    }),
    source = structuredClone(session(world.id).snapshot);
  source.world.epochs = source.world.epochs.slice(-1);
  const areaId = Object.keys(world.areas)[0],
    input = { areaId, seed: world.seed, quality: "draft", domains: ["physical"] };
  const baseline = await generateAtlas(source, input);
  const parameters = {
    ...defaultAtlasParameters,
    landFraction: 0.7,
    temperature: 30,
    rainfall: 0.2,
    cultureCount: 2,
    polityCount: 2,
  };
  const changed = await generateAtlas(source, {
    ...input,
    domains: ["physical", "cultural", "political"],
    parameters,
  });
  expect(
    Object.values(changed.state.domain.world.entities).filter((entity) => entity.kind === "culture")
  ).toHaveLength(2);
  expect(
    Object.values(changed.state.domain.world.entities).filter((entity) => entity.kind === "polity")
  ).toHaveLength(2);
  expect(changed.configurationHash).not.toBe(baseline.configurationHash);
  expect(changed.state.surface.channels.elevation).not.toEqual(
    baseline.state.surface.channels.elevation
  );
  expect(changed.state.surface.channels.temperature).not.toEqual(
    baseline.state.surface.channels.temperature
  );
  const published = generationSnapshot(changed, { ...input, parameters }, crypto.randomUUID());
  expect(published.world.generations.at(-1)).toMatchObject({ seed: input.seed, parameters });
  expect(atlasConfiguration(source, { ...input, parameters }).parameters).toMatchObject(parameters);
  expect(atlasConfiguration(source, input).inputs).toMatchObject({
    features: {
      selection: {
        "magic.configured": { configuration: { magicSystems: source.world.magicSystems } },
      },
    },
  });
  await expect(generateAtlas(source, { ...input, parameters: { rainfall: -1 } })).rejects.toThrow();
}, 60000);
