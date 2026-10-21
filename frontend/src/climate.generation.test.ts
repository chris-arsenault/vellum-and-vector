import { writeFileSync } from "node:fs";
import { expect, it } from "vitest";
import { atlasPresets, generateAtlas } from "@atlas/generation";
import { gridPosition, sample, type Grid } from "@atlas/domain";
import { createWorld, session } from "./atlasState";
import {
  band,
  generateProfile,
  height,
  latitudeOf,
  poleward,
  share,
  width,
  type Band,
} from "./climateFixture";

/** Mean shelf aquatic productivity with and without upwelling below the subpolar gyres. */
function shelfProductivity(grid: Grid) {
  const c = grid.channels,
    sums = { upwelling: [0, 0], still: [0, 0] };
  for (let i = 0; i < c.water.length; i++) {
    if (c.water[i] !== 1 || c.waterDepth[i] > 200) continue;
    const kind = c.upwelling[i] > 0.3 ? "upwelling" : c.upwelling[i] === 0 ? "still" : null;
    if (!kind) continue;
    sums[kind][0] += c.aquaticProductivity[i];
    sums[kind][1]++;
  }
  return { upwelling: sums.upwelling[0] / sums.upwelling[1], still: sums.still[0] / sums.still[1] };
}
/** Mean precipitation on 35–55° land with open ocean 150 km to its west or east. */
function westerlyCoasts(grid: Grid, south: number, north: number) {
  const c = grid.channels,
    sums = { west: [0, 0], east: [0, 0] };
  const water = (x: number, y: number) =>
    x >= 0 && x <= width && sample(grid, "water", { x, y, z: 0 }) === 1;
  for (let i = 0; i < c.water.length; i++) {
    if (c.water[i] === 1) continue;
    const { x, y } = gridPosition(grid, i),
      latitude = latitudeOf(south, north, y);
    if (latitude < 35 || latitude > 55) continue;
    const west = water(x - 150_000, y),
      east = water(x + 150_000, y);
    if (west === east) continue;
    const side = sums[west ? "west" : "east"];
    side[0] += c.rainfall[i] + c.snowfall[i];
    side[1]++;
  }
  return { west: sums.west[0] / sums.west[1], east: sums.east[0] / sums.east[1] };
}
/** Ocean temperature mean and spread in bands of `step` degrees. */
function oceanBands(grid: Grid, south: number, north: number, step: number) {
  const c = grid.channels,
    bands = new Map<number, number[]>();
  for (let i = 0; i < c.temperature.length; i++) {
    if (c.water[i] !== 1) continue;
    const latitude = latitudeOf(south, north, gridPosition(grid, i).y),
      key = Math.floor(latitude / step) * step;
    bands.set(key, [...(bands.get(key) ?? []), c.temperature[i]]);
  }
  return new Map(
    [...bands].map(([key, values]) => {
      const mean = values.reduce((a, b) => a + b, 0) / values.length;
      const spread = Math.sqrt(values.reduce((a, b) => a + (b - mean) ** 2, 0) / values.length);
      return [key, { mean, spread }];
    })
  );
}
/**
 * Mean absolute land temperature difference 40 km along and across the local
 * wind; wind-aligned streaks make the across difference much larger.
 */
function windAnisotropy(grid: Grid) {
  const c = grid.channels,
    land = (x: number, y: number) =>
      x >= 0 && x <= width && y >= 0 && y <= height && sample(grid, "water", { x, y, z: 0 }) !== 1;
  const temperatureAt = (x: number, y: number) => sample(grid, "temperature", { x, y, z: 0 });
  let along = 0,
    across = 0,
    count = 0;
  for (let i = 0; i < c.temperature.length; i++) {
    const length = Math.hypot(c.windEast[i], c.windNorth[i]);
    if (c.water[i] === 1 || length === 0) continue;
    const { x, y } = gridPosition(grid, i),
      [dx, dy] = [(c.windEast[i] / length) * 40_000, (c.windNorth[i] / length) * 40_000];
    if (!land(x + dx, y + dy) || !land(x - dy, y + dx)) continue;
    along += Math.abs(temperatureAt(x + dx, y + dy) - c.temperature[i]);
    across += Math.abs(temperatureAt(x - dy, y + dx) - c.temperature[i]);
    count++;
  }
  return { along: along / count, across: across / count };
}
/** Mean wind components, ocean temperature and ice share over all cells in bands of `step` degrees. */
function allBands(grid: Grid, south: number, north: number, step: number) {
  const c = grid.channels,
    bands = new Map<
      number,
      { east: number; north: number; t: number; sea: number; ice: number; n: number }
    >();
  for (let i = 0; i < c.temperature.length; i++) {
    const key = Math.floor(latitudeOf(south, north, gridPosition(grid, i).y) / step) * step;
    const band = bands.get(key) ?? { east: 0, north: 0, t: 0, sea: 0, ice: 0, n: 0 };
    band.east += c.windEast[i];
    band.north += c.windNorth[i];
    if (c.water[i] === 1) {
      band.t += c.temperature[i];
      band.sea++;
    }
    band.ice += Number(c.iceThickness[i] > 1);
    band.n++;
    bands.set(key, band);
  }
  return (key: number) => {
    const band = bands.get(key)!;
    return {
      east: band.east / band.n,
      north: band.north / band.n,
      sea: band.t / band.sea,
      ice: band.ice / band.n,
    };
  };
}
/** Land cooling in °C per degree between the 10° band and the most poleward one. */
const cooling = (profile: Band[]) => {
  const far = poleward(profile);
  return (band(profile, 10).temperature - far.temperature) / (far.latitude - 10);
};

it("organises the default world's temperature, winds and ice by latitude", async () => {
  const { profile, grid } = await generateProfile("Latitude climate", 10, 70);
  const shelves = shelfProductivity(grid);
  expect(shelves.upwelling).toBeGreaterThan(shelves.still * 1.2);
  // Earth's land cools about 0.45 °C per degree between 10° and 40°.
  expect(cooling(profile)).toBeGreaterThan(0.35);
  for (let i = 1; i < profile.length; i++)
    expect(profile[i].temperature).toBeLessThan(profile[i - 1].temperature);
  // Trades blow from the east; the westerlies from the west.
  expect(band(profile, 10).windEast).toBeLessThan(-0.5);
  expect(band(profile, 20).windEast).toBeLessThan(-0.5);
  for (const item of profile.filter((b) => b.latitude >= 30 && b.latitude < 60))
    expect(item.windEast, `${item.latitude}°`).toBeGreaterThan(0.5);
  expect(band(profile, 10).ice).toBe(0);
  expect(profile.at(-1)!.ice).toBeGreaterThan(band(profile, 30).ice);
  // Tropical biomes concentrate toward the equatorward edge.
  const tropical = ["Rainforest", "Savanna"];
  expect(share(band(profile, 10), tropical)).toBeGreaterThan(
    share(band(profile, 30), tropical) * 2
  );
  expect(share(band(profile, 10), tropical)).toBeGreaterThan(0.1);
  // Earth-like magnitudes (±30 %): 1.0–1.6 m on the tropical margin, a dry belt
  // at 20–30° and 0.9–1.5 m on westerly coasts.
  expect(band(profile, 10).precipitation).toBeGreaterThan(0.7);
  expect(band(profile, 20).precipitation).toBeLessThan(0.455);
  const deserts = (b: Band) => share(b, ["Desert"]);
  expect(deserts(band(profile, 20))).toBeGreaterThan(deserts(band(profile, 10)));
  expect(deserts(band(profile, 20))).toBeGreaterThan(deserts(poleward(profile)));
  // Pressure belts: a subtropical dip between the equatorial and storm-track rains.
  expect(band(profile, 30).precipitation).toBeLessThan(band(profile, 10).precipitation * 0.85);
  expect(band(profile, 30).precipitation).toBeLessThan(band(profile, 40).precipitation * 0.85);
  const dry = ["Desert"];
  expect(Math.max(share(band(profile, 20), dry), share(band(profile, 30), dry))).toBeGreaterThan(
    share(band(profile, 40), dry)
  );
  const coasts = westerlyCoasts(grid, 10, 70);
  expect(coasts.west).toBeGreaterThan(coasts.east);
  expect(coasts.west).toBeGreaterThan(0.63);
  expect(coasts.west).toBeLessThan(1.95);
  // Ridges and fractures no longer glow: within a band, sea temperature
  // varies with currents and upwelling, not crustal heat.
  for (const [latitude, { spread }] of oceanBands(grid, 10, 70, 10))
    expect(spread, `${latitude}°`).toBeLessThan(4);
}, 300_000);

it("mirrors winds and sea temperature across the equator of a two-hemisphere world", async () => {
  const { grid, profile } = await generateProfile("Two hemispheres", -70, 70);
  const at = allBands(grid, -70, 70, 10);
  // Earth-like land rain (±30 %): 1.8–2.5 m within 10° of the equator, a dry
  // belt at 20–30° in both hemispheres and a dry polar cell.
  for (const key of [-10, 0]) {
    expect(band(profile, key).precipitation, `${key}°`).toBeGreaterThan(1.26);
    expect(band(profile, key).precipitation, `${key}°`).toBeLessThan(3.25);
    // Rainforest dominates the equatorial forest.
    const b = band(profile, key);
    expect(b.biomes.Rainforest ?? 0).toBeGreaterThan(
      (b.biomes["Temperate forest"] ?? 0) + (b.biomes["Boreal forest"] ?? 0)
    );
  }
  // Bands with little land can be a single windward coast; judge the belt where land is broad.
  for (const key of [-30, 20].filter((item) => band(profile, item).land >= 200))
    expect(band(profile, key).precipitation, `${key}°`).toBeLessThan(
      band(profile, 0).precipitation / 3
    );
  expect(band(profile, -70).precipitation).toBeLessThan(0.52);
  // Trades blow from the east toward the equator on both sides; westerlies beyond 30°.
  expect(at(10).east).toBeLessThan(-0.3);
  expect(at(-20).east).toBeLessThan(-0.3);
  expect(at(10).north).toBeLessThan(0);
  expect(at(-20).north).toBeGreaterThan(0);
  expect(at(40).east).toBeGreaterThan(0.3);
  expect(at(-50).east).toBeGreaterThan(0.3);
  expect(Math.abs(at(20).sea - at(-30).sea)).toBeLessThan(4);
  expect(at(0).sea).toBeGreaterThan(at(-50).sea + 10);
  expect(at(0).sea).toBeGreaterThan(at(40).sea + 10);
}, 300_000);

it("gives a full globe one warm equator and two cold poles", async () => {
  const { grid } = await generateProfile("Full globe", -90, 90, ["physical"], {
    wrapLongitude: 1,
  });
  const at = allBands(grid, -90, 90, 20);
  // Air and ocean cross the east–west seam: the rain change across it is no
  // larger than across the same 60 km anywhere inside the map.
  const rain = (x: number, y: number) => sample(grid, "precipitation", { x, y, z: 0 });
  let seam = 0,
    inside = 0;
  for (let y = 300_000; y < height - 300_000; y += 50_000) {
    seam += Math.abs(rain(width - 30_000, y) - rain(30_000, y));
    inside += Math.abs(rain(width / 2 - 30_000, y) - rain(width / 2 + 30_000, y));
  }
  expect(seam).toBeLessThan(inside * 1.5);
  writeFileSync(
    "test-results/climate-globe.txt",
    [-80, -60, -40, -20, 0, 20, 40, 60, 80]
      .map((key) => `${key}°: ${JSON.stringify(at(key))}`)
      .join("\n") + "\n"
  );
  expect(at(0).sea).toBeGreaterThan(at(60).sea + 15);
  expect(at(-20).sea).toBeGreaterThan(at(-80).sea + 15);
  expect(at(80).ice).toBeGreaterThan(at(0).ice + 0.2);
  expect(at(-80).ice).toBeGreaterThan(at(0).ice + 0.2);
}, 300_000);

it("keeps the latitude climate when magic heats the world", async () => {
  const { profile, grid } = await generateProfile("Magic climate", 10, 70, ["physical", "magic"]);
  for (let i = 1; i < profile.length; i++)
    expect(profile[i].temperature).toBeLessThan(profile[i - 1].temperature + 1);
  expect(band(profile, 10).temperature).toBeLessThan(35);
  expect(cooling(profile)).toBeGreaterThan(0.35);
  // Magical heat spreads downwind without drawing wind-aligned streaks.
  const streaks = windAnisotropy(grid);
  expect(streaks.across).toBeLessThan(streaks.along * 1.5);
  // The 60° polar front is a gradient, not a step.
  const ocean = oceanBands(grid, 10, 70, 1);
  for (let latitude = 55; latitude < 65; latitude++)
    expect(
      Math.abs(ocean.get(latitude + 1)!.mean - ocean.get(latitude)!.mean),
      `${latitude}°`
    ).toBeLessThan(1.5);
}, 300_000);

it("shifts ice and rainfall with the climate presets rather than flattening them", async () => {
  const summary: Record<string, { ice: number; precipitation: number }> = {};
  for (const id of ["balanced", "cold", "arid", "canonry"]) {
    const world = createWorld({ name: id, seed: 104729, width, height });
    const domain = session(world.id).snapshot;
    const result = await generateAtlas(domain, {
      areaId: domain.scope.areaId,
      quality: "draft",
      seed: world.seed,
      domains: ["physical"],
      parameters: atlasPresets[id].parameters,
    });
    const c = result.state.surface.channels;
    let land = 0,
      ice = 0,
      precipitation = 0;
    for (let i = 0; i < c.water.length; i++) {
      if (c.water[i] === 1) continue;
      land++;
      ice += Number(c.iceThickness[i] > 1);
      precipitation += c.rainfall[i] + c.snowfall[i];
    }
    summary[id] = { ice: ice / land, precipitation: precipitation / land };
  }
  expect(summary.cold.ice).toBeGreaterThan(summary.balanced.ice);
  expect(summary.canonry.ice).toBeGreaterThan(summary.cold.ice);
  expect(summary.arid.precipitation).toBeLessThan(summary.balanced.precipitation * 0.6);
}, 600_000);

it("gives a high-latitude world tundra, boreal forest and ice toward its pole", async () => {
  const { profile } = await generateProfile("Polar climate", 40, 85);
  const cold = ["Tundra", "Boreal forest", "Ice"];
  expect(share(band(profile, 70), cold)).toBeGreaterThan(share(band(profile, 40), cold) + 0.2);
  expect(band(profile, 70).windEast).toBeLessThan(0);
  expect(band(profile, 40).temperature).toBeGreaterThan(band(profile, 70).temperature + 10);
}, 300_000);
