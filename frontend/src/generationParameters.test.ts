import { expect, it } from "vitest";
import { atlasConfiguration, defaultAtlasParameters, generateAtlas } from "@atlas/generation";
import { atlasPhysicalProfile } from "../../packages/generation/src/canonry/atlasProfile";
import { createWorld, session } from "./atlasState";
import { generationSnapshot } from "./generationJobs";

it("maps creator controls to native physics with declared units", () => {
  const profile = atlasPhysicalProfile(16384, {
    continents: 7,
    provinces: 30,
    landFraction: 0.3,
    temperature: -5,
    rainfall: 2,
    erosion: 0.5,
    seaLevel: 100,
  });
  expect(profile.ContinentalAssemblyCount).toBe(7);
  expect(profile.TectonicProvinceCount).toBe(30);
  expect(profile.ContinentalCrustFraction).toBe(0.3);
  expect(profile.TemperatureBaseline).toBe(250);
  expect(profile.PrecipitationBaseline).toBe(80);
  expect(profile.FluvialErosionStrength).toBe(0.16);
  expect(profile.SeaLevel * profile.ElevationScale).toBe(100);
});
it("changes real geography, retains chosen inputs, and rejects invalid settings", async () => {
  const world = createWorld({ name: "Controls", seed: 104729, width: 100000, height: 100000 }),
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
  expect(atlasConfiguration(source, { ...input, parameters }).parameters).toEqual(parameters);
  await expect(generateAtlas(source, { ...input, parameters: { rainfall: -1 } })).rejects.toThrow();
}, 60000);
