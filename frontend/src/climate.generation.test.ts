import { mkdirSync, writeFileSync } from "node:fs";
import { expect, it } from "vitest";
import { atlasPresets, generateAtlas } from "@atlas/generation";
import { biomes, gridPosition, sample, type Grid } from "@atlas/domain";
import { createWorld, session } from "./atlasState";

const width = 4_000_000,
  height = 3_000_000;

interface Band {
  latitude: number;
  land: number;
  temperature: number;
  precipitation: number;
  windEast: number;
  windSpeed: number;
  ice: number;
  biomes: Record<string, number>;
}
/** Land-area zonal means by ten-degree band; the evidence used by each climate milestone. */
function zonalProfile(grid: Grid, south: number, north: number): Band[] {
  const c = grid.channels,
    bands = new Map<number, Band>();
  for (let i = 0; i < c.temperature.length; i++) {
    if (c.water[i] === 1) continue;
    const latitude = south + ((north - south) * gridPosition(grid, i).y) / height;
    const key = Math.min(Math.floor((north - 1) / 10) * 10, Math.floor(latitude / 10) * 10);
    const band = bands.get(key) ?? {
      latitude: key,
      land: 0,
      temperature: 0,
      precipitation: 0,
      windEast: 0,
      windSpeed: 0,
      ice: 0,
      biomes: {},
    };
    band.land++;
    band.temperature += c.temperature[i];
    band.precipitation += c.rainfall[i] + c.snowfall[i];
    band.windEast += c.windEast[i];
    band.windSpeed += c.windSpeed[i];
    band.ice += Number(c.iceThickness[i] > 1);
    const name = biomes[c.biome[i]]?.name ?? "Unknown";
    band.biomes[name] = (band.biomes[name] ?? 0) + 1;
    bands.set(key, band);
  }
  return [...bands.values()]
    .sort((a, b) => a.latitude - b.latitude)
    .map((band) => ({
      ...band,
      temperature: band.temperature / band.land,
      precipitation: band.precipitation / band.land,
      windEast: band.windEast / band.land,
      windSpeed: band.windSpeed / band.land,
      ice: band.ice / band.land,
    }));
}
function report(profile: Band[]) {
  return profile
    .map(
      (b) =>
        `${b.latitude}°: land ${b.land} T ${b.temperature.toFixed(1)}°C P ${b.precipitation.toFixed(
          3
        )} m wind ${b.windEast.toFixed(2)} at ${b.windSpeed.toFixed(1)} m/s ice ${(b.ice * 100).toFixed(0)}% ` +
        Object.entries(b.biomes)
          .sort((x, y) => y[1] - x[1])
          .slice(0, 3)
          .map(([name, count]) => `${name} ${count}`)
          .join(", ")
    )
    .join("\n");
}
async function generateProfile(name: string, south: number, north: number) {
  const world = createWorld({ name, seed: 104729, width, height });
  // Default climate; epochs long enough for forest succession to mature.
  for (const epoch of world.epochs) epoch.duration = 5000;
  const domain = session(world.id).snapshot;
  const result = await generateAtlas(domain, {
    areaId: domain.scope.areaId,
    quality: "draft",
    seed: world.seed,
    domains: ["physical"],
    parameters: { southLatitude: south, northLatitude: north },
  });
  const profile = zonalProfile(result.state.surface, south, north);
  // Retained for inspection in the ignored test output directory.
  mkdirSync("test-results", { recursive: true });
  writeFileSync(`test-results/climate-profile-${south}-${north}.txt`, `${report(profile)}\n`);
  return { profile, grid: result.state.surface };
}
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
      latitude = south + ((north - south) * y) / height;
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
const band = (profile: Band[], latitude: number) =>
  profile.find((item) => item.latitude === latitude)!;
const share = (b: Band, names: string[]) =>
  names.reduce((sum, name) => sum + (b.biomes[name] ?? 0), 0) / b.land;

it("organises the default world's temperature, winds and ice by latitude", async () => {
  const { profile, grid } = await generateProfile("Latitude climate", 10, 70);
  const shelves = shelfProductivity(grid);
  expect(shelves.upwelling).toBeGreaterThan(shelves.still * 1.2);
  expect(band(profile, 10).temperature).toBeGreaterThan(band(profile, 50).temperature + 15);
  for (let i = 1; i < profile.length; i++)
    expect(profile[i].temperature).toBeLessThan(profile[i - 1].temperature);
  // Trades blow from the east; the westerlies from the west.
  expect(band(profile, 10).windEast).toBeLessThan(-0.5);
  expect(band(profile, 20).windEast).toBeLessThan(-0.5);
  for (const latitude of [30, 40, 50])
    expect(band(profile, latitude).windEast).toBeGreaterThan(0.5);
  expect(band(profile, 10).ice).toBe(0);
  expect(band(profile, 50).ice).toBeGreaterThan(band(profile, 30).ice);
  expect(share(band(profile, 10), ["Rainforest", "Savanna"])).toBeGreaterThan(0.1);
  // Pressure belts: a subtropical dip between the equatorial and storm-track rains.
  expect(band(profile, 30).precipitation).toBeLessThan(band(profile, 10).precipitation * 0.85);
  expect(band(profile, 30).precipitation).toBeLessThan(band(profile, 40).precipitation * 0.85);
  const dry = ["Desert"];
  expect(Math.max(share(band(profile, 20), dry), share(band(profile, 30), dry))).toBeGreaterThan(
    share(band(profile, 40), dry)
  );
  const coasts = westerlyCoasts(grid, 10, 70);
  expect(coasts.west).toBeGreaterThan(coasts.east);
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
