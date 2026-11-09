import { fixtureWorld, commitCommand } from "./testSupport/workspaceFixture";
import { expect, it } from "vitest";
import { MapScale } from "@atlas/domain";
import { atlasPhysicalProfile } from "../../packages/generation/src/world/atlasProfile";
import { makeCommand } from "./useAtlas";

it("maps creator controls to native physics with declared units", async () => {
  const profile = atlasPhysicalProfile(
    {
      continents: 7,
      provinces: 30,
      continentalCrustFraction: 0.6,
      landFraction: 0.3,
      temperature: -5,
      rainfall: 2,
      erosion: 0.5,
      seaLevel: 0.000025,
    },
    {},
    MapScale.reference()
  );
  expect(profile.ContinentalAssemblyCount).toBe(7);
  expect(profile.TectonicProvinceCount).toBe(30);
  expect(profile.ContinentalCrustFraction).toBe(0.6);
  expect(profile.QualityTargets.OceanCoverage.target).toBe(0.7);
  expect(profile.TemperatureBaseline).toBe(250);
  expect(profile.PrecipitationBaseline).toBe(80);
  expect(profile.FluvialErosionRate).toBe(2.08);
  expect(profile.SeaLevel * profile.ElevationScale).toBe(100);
});

it("authors a variant through the shared operation and preserves it when settings change", async () => {
  const world = fixtureWorld({ name: "Configurable magic", seed: 9, width: 1000, height: 1000 });
  const variant = {
    ...world.magicSystems![0],
    id: "new-system",
    name: "Ice forging",
    effects: { heat: -0.2, iceMelt: -0.3, rockResistance: 500, coastalForcing: 0 },
  };
  let current = (
    await commitCommand(
      world.id,
      makeCommand(world, "setMagicSystems", {
        systems: [...world.magicSystems!, variant],
      })
    )
  ).candidate;
  expect(current.magicSystems?.at(-1)?.name).toBe("Ice forging");
  current = (
    await commitCommand(
      world.id,
      makeCommand(current, "setWorldSettings", {
        name: "Revised world",
        seed: 10,
      })
    )
  ).candidate;
  expect(current.magicSystems?.at(-1)?.effects.heat).toBe(-0.2);
});
