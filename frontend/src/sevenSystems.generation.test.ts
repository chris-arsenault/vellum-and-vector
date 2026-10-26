import { mkdirSync, writeFileSync } from "node:fs";
import { expect, it } from "vitest";
import { generateAtlas } from "@atlas/generation";
import { canonryMagicPresets, type Grid } from "@atlas/domain";
import { newGenerationDraft, prepareDraft } from "./generationDraft";
import { generationSnapshot } from "./generationJobs";

/** The share of land cells where a channel is above zero, and the channel's mean on land. */
function landShare(grid: Grid, channel: string) {
  const values = grid.channels[channel],
    water = grid.channels.water;
  if (!values) return { share: 0, mean: 0 };
  let land = 0,
    active = 0,
    total = 0;
  for (let i = 0; i < values.length; i++) {
    if (water[i] === 1) continue;
    land++;
    if (values[i] > 0) active++;
    total += values[i];
  }
  return { share: land ? active / land : 0, mean: land ? total / land : 0 };
}
/** The number of land samples on the surface grid. */
function landCells(grid: Grid) {
  let land = 0;
  for (const kind of grid.channels.water) if (kind !== 1) land++;
  return land;
}

/** Percentiles of a channel over the land cells where it is above zero, for tuning thresholds. */
function spread(grid: Grid, channel: string) {
  const values = grid.channels[channel],
    water = grid.channels.water;
  if (!values) return null;
  const land: number[] = [];
  for (let i = 0; i < values.length; i++) if (water[i] !== 1 && values[i] > 0) land.push(values[i]);
  land.sort((a, b) => a - b);
  const at = (q: number) => land[Math.min(land.length - 1, Math.floor(q * land.length))] ?? 0;
  return { cells: land.length, p50: at(0.5), p90: at(0.9), p99: at(0.99), max: at(1) };
}

/**
 * One full draft world with all seven systems and the default human eras: every system's
 * presence is logged under the generation artifacts, the three physical systems must be
 * present, no system's classes may hold more than a quarter of the land area, and the named
 * places must be few enough to read: at most one per eight land cells. Before the source
 * floor and the place minima this world published two thousand places on 5,384 land cells,
 * 425 of them Fire cores; with them, 614 on 5,380, 110 cores. Reach and thresholds are
 * retuned from this log. Coverage is judged by its mean, the ground the classes hold: the
 * projected channel is interpolated, so the share of cells with any coverage overstates a
 * one-cell ring by its whole neighbourhood.
 */
it("generates a world with all seven systems where none saturates the land", async () => {
  const draft = newGenerationDraft();
  draft.width = 4_000_000;
  draft.height = 3_000_000;
  draft.recipe.domains = ["physical", "magic", "cultural", "political", "built"];
  draft.recipe.quality = "draft";
  const { source, input, diagnostics } = prepareDraft(draft);
  expect(diagnostics.filter((d) => d.severity === "error")).toEqual([]);
  const systems = (source.world.magicSystems ?? canonryMagicPresets()).map((s) => s.id);
  expect(systems).toEqual(["fire", "aurora", "pressure", "greenwood", "salt", "hallowed", "veil"]);
  const start = performance.now();
  const result = await generateAtlas(source, input);
  const snapshot = generationSnapshot(result, input, crypto.randomUUID());
  const grid = result.state.surface,
    features = Object.values(snapshot.world.features),
    magicPlaces = features.filter((f) => f.layerId === "magic"),
    log = {
      seed: input.seed,
      seconds: Math.round((performance.now() - start) / 1000),
      landCells: landCells(grid),
      magicPlaces: magicPlaces.length,
      rules: Object.fromEntries(
        [...new Set(magicPlaces.map((f) => `${f.attributes.system}:${f.attributes.rule}`))]
          .sort()
          .map((key) => [
            key,
            magicPlaces.filter((f) => `${f.attributes.system}:${f.attributes.rule}` === key).length,
          ])
      ),
      systems: Object.fromEntries(
        systems.map((id) => [
          id,
          {
            intensity: landShare(grid, `magic:${id}:intensity`),
            coverage: landShare(grid, `magic:${id}:coverage`),
            places: features.filter((f) => f.layerId === "magic" && f.attributes.system === id)
              .length,
          },
        ])
      ),
      meetings: features
        .filter((f) => f.layerId === "magic" && f.attributes.system === "confluence")
        .map((f) => String(f.attributes.rule)),
      forcings: Object.fromEntries(
        ["quickening", "stillness", "verdure", "salting", "warding", "tearing", "fog"].map(
          (channel) => [channel, landShare(grid, channel)]
        )
      ),
      secondSurface: landShare(grid, "secondSurface").share,
      settlements: features.filter((f) => f.kind === "settlement").length,
      records: Object.fromEntries(
        [
          "tenure",
          "walkedRoute",
          "massDeath",
          "magic:hallowed:source",
          "magic:hallowed:intensity",
          "magic:hallowed:feature:ring",
          "magic:hallowed:feature:line",
          "magic:greenwood:source",
        ].map((channel) => [channel, spread(grid, channel)])
      ),
    };
  mkdirSync(".artifacts/generation", { recursive: true });
  writeFileSync(".artifacts/generation/seven-systems.json", JSON.stringify(log, null, 2));
  for (const id of ["fire", "aurora", "pressure"])
    expect(log.systems[id].intensity.share, id).toBeGreaterThan(0);
  // No system's classes hold more than a quarter of the land area, and the places are few
  // enough to read.
  for (const id of systems) expect(log.systems[id].coverage.mean, id).toBeLessThanOrEqual(0.25);
  expect(log.magicPlaces).toBeLessThanOrEqual(0.125 * log.landCells);
  expect(log.settlements).toBeGreaterThan(0);
}, 600_000);
