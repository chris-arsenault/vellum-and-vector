import { expect, it } from "vitest";
import { rainfallRegimes } from "@atlas/generation";
import type { Grid } from "@atlas/domain";
import { band, generateProfile, share, type Band } from "./climateFixture";

type World = Awaited<ReturnType<typeof generateProfile>>;
const meanRain = (profile: Band[]) =>
  profile.reduce((sum, b) => sum + b.precipitation * b.land, 0) /
  profile.reduce((sum, b) => sum + b.land, 0);
/** One integrated basin can outweigh a wetter world's largest river; ten large reaches cannot. */
const majorDischarge = (world: World) =>
  world.rivers
    .map((river) => river.discharge)
    .sort((a, b) => b - a)
    .slice(0, 10)
    .reduce((sum, discharge) => sum + discharge, 0);
/** Share of land flooded more often than once a decade. */
function flooded(grid: Grid) {
  const c = grid.channels,
    land = c.water.filter((kind) => kind !== 1).length;
  return c.floodFrequency.filter((value, i) => c.water[i] !== 1 && value > 0.1).length / land;
}

/** Dry stays arid in absolute depth and relative to the same world's Mixed regime. */
function expectArid(dry: Band[], mixed: Band[], frame: string) {
  expect(meanRain(dry), frame).toBeLessThan(0.3);
  for (const b of dry) {
    expect(b.precipitation, `${frame} ${b.latitude}°`).toBeLessThan(0.6);
    const baseline = mixed.find((item) => item.latitude === b.latitude)!;
    if (b.land >= 30)
      expect(b.precipitation, `${frame} ${b.latitude}°`).toBeLessThan(baseline.precipitation * 0.2);
    expect(b.biomes.Rainforest ?? 0).toBe(0);
  }
}
/** Wet is at least 1.4 times Mixed in every band with broad land. */
function expectWetter(wet: Band[], mixed: Band[], frame: string) {
  for (const b of wet.filter((item) => item.land >= 30)) {
    const m = mixed.find((item) => item.latitude === b.latitude)!;
    expect(b.precipitation, `${frame} ${b.latitude}°`).toBeGreaterThan(m.precipitation * 1.4);
  }
}
/** Rivers follow the water: more and larger in Wet, still present in Dry; Wet floods only part of its land. */
function expectRivers([dry, mixed, wet]: World[], frame: string) {
  expect(dry.rivers.length, frame).toBeGreaterThan(0);
  expect(wet.rivers.length, frame).toBeGreaterThanOrEqual(mixed.rivers.length);
  expect(majorDischarge(wet), frame).toBeGreaterThan(majorDischarge(mixed));
  expect(majorDischarge(mixed), frame).toBeGreaterThan(majorDischarge(dry));
  // Discharge integrates catchment area as well as rainfall. A large northern
  // continent can carry the largest river even when the tropics are wetter.
  expect(flooded(wet.grid), frame).toBeLessThan(0.5);
  expect(Math.max(...wet.grid.channels.floodFrequency)).toBeLessThanOrEqual(0.5);
}

it.each([
  [10, 70],
  [-70, 70],
])(
  "fits the Dry, Mixed and Wet regimes to their own outcomes on %i..%i",
  async (south, north) => {
    const frame = `${south}..${north}`,
      regime = (id: keyof typeof rainfallRegimes) =>
        generateProfile(`${id} ${frame}`, south, north, ["physical"], {
          rainfall: rainfallRegimes[id].rainfall,
        });
    const worlds = await Promise.all([regime("dry"), regime("mixed"), regime("wet")]);
    const [dry, mixed, wet] = worlds.map((world) => world.profile);
    expectArid(dry, mixed, frame);
    expectWetter(wet, mixed, frame);
    expectRivers(worlds, frame);
    // The belt order survives every regime: the subtropics stay drier than the tropics.
    const [subtropics, tropics] = south < 0 ? [-30, -10] : [20, 10];
    for (const profile of [dry, mixed, wet])
      expect(band(profile, subtropics).precipitation).toBeLessThan(
        band(profile, tropics).precipitation
      );
    if (south < 0)
      for (const key of [-10, 0]) expect(band(wet, key).precipitation).toBeGreaterThan(2.6);
    // Wet thins the subtropical deserts to at most half of Mixed's share.
    else
      expect(share(band(wet, 20), ["Desert"])).toBeLessThan(share(band(mixed, 20), ["Desert"]) / 2);
  },
  600_000
);
