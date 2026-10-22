// Shared generation-test support: a default-sized world, its latitudes and
// land-area zonal profiles. Imported only by `*.generation.test.ts` files.
import { mkdirSync, writeFileSync } from "node:fs";
import { atlasLatitude, generateAtlas, type AtlasParameters } from "@atlas/generation";
import { biomes, gridPosition, type Grid } from "@atlas/domain";
import { createWorld, session } from "./atlasState";

export const width = 4_000_000,
  height = 3_000_000;
/** The generator's own latitude for a northing, under its default projection. */
export const latitudeOf = (south: number, north: number, y: number) =>
  atlasLatitude({ southLatitude: south, northLatitude: north }, [0, height], y);

export interface Band {
  latitude: number;
  land: number;
  temperature: number;
  precipitation: number;
  windEast: number;
  windSpeed: number;
  ice: number;
  humidity: number;
  trees: number;
  biomes: Record<string, number>;
}
/** Land-area zonal means by ten-degree band; the evidence used by each climate milestone. */
export function zonalProfile(grid: Grid, south: number, north: number): Band[] {
  const c = grid.channels,
    bands = new Map<number, Band>();
  for (let i = 0; i < c.temperature.length; i++) {
    if (c.water[i] === 1) continue;
    const latitude = latitudeOf(south, north, gridPosition(grid, i).y);
    const key = Math.min(Math.floor((north - 1) / 10) * 10, Math.floor(latitude / 10) * 10);
    const band = bands.get(key) ?? {
      latitude: key,
      land: 0,
      temperature: 0,
      precipitation: 0,
      windEast: 0,
      windSpeed: 0,
      ice: 0,
      humidity: 0,
      trees: 0,
      biomes: {},
    };
    band.land++;
    band.humidity += c.moisture[i];
    band.trees += c.treeCover[i];
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
      humidity: band.humidity / band.land,
      trees: band.trees / band.land,
    }));
}
export function report(profile: Band[]) {
  return profile
    .map(
      (b) =>
        `${b.latitude}°: land ${b.land} T ${b.temperature.toFixed(1)}°C P ${b.precipitation.toFixed(
          3
        )} m RH ${b.humidity.toFixed(2)} trees ${b.trees.toFixed(2)} wind ${b.windEast.toFixed(2)} at ${b.windSpeed.toFixed(1)} m/s ice ${(b.ice * 100).toFixed(0)}% ` +
        Object.entries(b.biomes)
          .sort((x, y) => y[1] - x[1])
          .slice(0, 3)
          .map(([name, count]) => `${name} ${count}`)
          .join(", ")
    )
    .join("\n");
}
/** Each river's largest discharge (m³/s) and the latitude where it occurs. */
function riverPeaks(
  result: Awaited<ReturnType<typeof generateAtlas>>,
  south: number,
  north: number
) {
  return Object.values(result.state.domain.world.features)
    .filter((feature) => feature.kind === "river" && feature.geometry.type === "LineString")
    .map((river) => {
      const discharges = river.attributes.discharges as number[],
        peak = discharges.indexOf(Math.max(...discharges)),
        coordinates = (river.geometry as { coordinates: number[][] }).coordinates;
      return {
        discharge: discharges[peak],
        latitude: latitudeOf(south, north, coordinates[peak][1]),
      };
    });
}
export async function generateProfile(
  name: string,
  south: number,
  north: number,
  domains: ("physical" | "magic")[] = ["physical"],
  parameters: Partial<AtlasParameters> = {}
) {
  const world = createWorld({ name, seed: 104729, width, height });
  // Default climate; epochs long enough for forest succession to mature.
  for (const epoch of world.epochs) epoch.duration = 5000;
  const domain = session(world.id).snapshot;
  const result = await generateAtlas(domain, {
    areaId: domain.scope.areaId,
    quality: "draft",
    seed: world.seed,
    domains,
    parameters: { ...parameters, southLatitude: south, northLatitude: north },
  });
  const profile = zonalProfile(result.state.surface, south, north);
  // Retained for inspection in the ignored test output directory.
  mkdirSync("test-results", { recursive: true });
  writeFileSync(
    `test-results/climate-profile-${south}-${north}-${domains.join("-")}.txt`,
    `${report(profile)}\n`
  );
  return { profile, grid: result.state.surface, rivers: riverPeaks(result, south, north) };
}
export const band = (profile: Band[], latitude: number) =>
  profile.find((item) => item.latitude === latitude)!;
/** The most poleward band with enough land to average; continents vary with the frame. */
export const poleward = (profile: Band[]) => profile.filter((item) => item.land >= 30).at(-1)!;
export const share = (b: Band, names: string[]) =>
  names.reduce((sum, name) => sum + (b.biomes[name] ?? 0), 0) / b.land;
