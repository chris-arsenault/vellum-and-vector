import { expect, it } from "vitest";
import { rainfallRegimes } from "@atlas/generation";
import type { Grid } from "@atlas/domain";
import { band, generateProfile, share, type Band } from "./climateFixture";

type World = Awaited<ReturnType<typeof generateProfile>>;
const meanRain = (profile: Band[]) =>
  profile.reduce((sum, b) => sum + b.precipitation * b.land, 0) /
  profile.reduce((sum, b) => sum + b.land, 0);
const largest = (world: World) =>
  world.rivers.reduce((best, river) => (river.discharge > best.discharge ? river : best));
/** Share of land flooded more often than once a decade. */
function flooded(grid: Grid) {
  const c = grid.channels,
    land = c.water.filter((kind) => kind !== 1).length;
  return c.floodFrequency.filter((value, i) => c.water[i] !== 1 && value > 0.1).length / land;
}

/** Dry stays absolutely arid and dominated by dry vegetation rather than matching old sample arrays. */
function expectArid(dry: Band[], frame: string) {
  expect(meanRain(dry), frame).toBeLessThan(0.3);
  for (const b of dry) {
    expect(b.precipitation, `${frame} ${b.latitude}°`).toBeLessThan(0.6);
    if (b.temperature > 5 && b.land >= 30)
      expect(
        share(b, ["Desert", "Barren", "Grassland"]),
        `${frame} ${b.latitude}°`
      ).toBeGreaterThan(0.5);
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
const runoffVolume = (world: World) =>
  world.grid.channels.runoff.reduce((sum, value, i) => sum + value * world.grid.measures[i], 0);
const meanFlow = (world: World) => {
  const values = world.grid.reconstruction!.channels.flow;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
};
/** Rain changes basin capture as well as flow; compare world runoff and typical streamflow. */
function expectRivers([dry, mixed, wet]: World[], frame: string, spansEquator: boolean) {
  expect(dry.rivers.length, frame).toBeGreaterThan(0);
  expect(wet.rivers.length, frame).toBeGreaterThanOrEqual(mixed.rivers.length);
  expect(runoffVolume(wet), frame).toBeGreaterThan(runoffVolume(mixed));
  expect(runoffVolume(mixed), frame).toBeGreaterThan(runoffVolume(dry));
  expect(meanFlow(wet), frame).toBeGreaterThan(meanFlow(mixed));
  expect(largest(mixed).discharge, frame).toBeGreaterThan(largest(dry).discharge);
  // The wet tropics carry the largest river where the frame spans the equator.
  if (spansEquator) expect(Math.abs(largest(mixed).latitude)).toBeLessThan(30);
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
    expectArid(dry, frame);
    expectWetter(wet, mixed, frame);
    expectRivers(worlds, frame, south < 0);
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
