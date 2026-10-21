import { mkdirSync, writeFileSync } from "node:fs";
import { expect, it } from "vitest";
import { atlasLatitude, generateAtlas } from "@atlas/generation";
import { gridPosition, type Grid } from "@atlas/domain";
import { createWorld, session } from "./atlasState";

const width = 4_000_000,
  height = 3_000_000,
  south = 10,
  north = 70;

interface AuroraBand {
  total: number;
  cells: number;
  iced: number;
  icedCells: number;
  open: number;
  openCells: number;
}
/** Aurora history on land by ten-degree band, split into ice sheets and ice-free ground. */
function auroraBands(grid: Grid) {
  const c = grid.channels,
    aurora = c["magic:aurora:history"],
    bands = new Map<number, AuroraBand>();
  for (let i = 0; i < aurora.length; i++) {
    // Ice sheets against ice-free land; open high-latitude sea is a different surface.
    if (c.water[i] === 1) continue;
    const latitude = atlasLatitude(
      { southLatitude: south, northLatitude: north },
      [0, height],
      gridPosition(grid, i).y
    );
    const key = Math.min(60, Math.floor(latitude / 10) * 10);
    const band = bands.get(key) ?? {
      total: 0,
      cells: 0,
      iced: 0,
      icedCells: 0,
      open: 0,
      openCells: 0,
    };
    band.total += aurora[i];
    band.cells++;
    if (c.maximumIceThickness[i] > 1) {
      band.iced += aurora[i];
      band.icedCells++;
    } else {
      band.open += aurora[i];
      band.openCells++;
    }
    bands.set(key, band);
  }
  return bands;
}

it("gathers cold magic toward the pole and its ice under the latitude climate", async () => {
  const world = createWorld({ name: "Magic climate", seed: 104729, width, height });
  for (const epoch of world.epochs) epoch.duration = 5000;
  const domain = session(world.id).snapshot;
  const result = await generateAtlas(domain, {
    areaId: domain.scope.areaId,
    quality: "draft",
    seed: world.seed,
    domains: ["physical", "magic"],
    parameters: { southLatitude: south, northLatitude: north },
  });
  const bands = auroraBands(result.state.surface);
  const mean = (key: number) => bands.get(key)!.total / bands.get(key)!.cells;
  // Ice against open ground at the same latitude, where both are common.
  const compared = [...bands]
    .sort(([a], [b]) => a - b)
    .filter(([, band]) => band.icedCells >= 50 && band.openCells >= 50)
    .map(([key, band]) => ({
      key,
      iced: band.iced / band.icedCells,
      open: band.open / band.openCells,
    }));
  const keys = [...bands.keys()].sort((a, b) => a - b);
  mkdirSync("test-results", { recursive: true });
  writeFileSync(
    "test-results/magic-climate.txt",
    `${keys.map((key) => `${key}°: aurora history ${mean(key).toFixed(1)}`).join("\n")}\n${compared
      .map((band) => `${band.key}° ice ${band.iced.toFixed(1)} open ${band.open.toFixed(1)}`)
      .join("\n")}\n`
  );
  // The two most poleward land bands against the two most equatorward.
  expect(mean(keys.at(-1)!) + mean(keys.at(-2)!)).toBeGreaterThan(
    (mean(keys[0]) + mean(keys[1])) * 1.5
  );
  expect(compared.length).toBeGreaterThan(0);
  for (const band of compared) expect(band.iced, `${band.key}°`).toBeGreaterThan(band.open);
  // Coastal magic still forces coasts through the new currents and waves.
  expect(result.state.surface.channels.coastalForcingHistory.some((value) => value > 0)).toBe(true);
}, 300_000);
