import { mkdirSync, writeFileSync } from "node:fs";
import { expect, it } from "vitest";
import { generateAtlas } from "@atlas/generation";
import { gridPosition } from "@atlas/domain";
import { createWorld, session } from "./atlasState";

const width = 4_000_000,
  height = 3_000_000,
  south = 10,
  north = 70;

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
  const c = result.state.surface.channels,
    aurora = c["magic:aurora:history"];
  const bands = new Map<number, { total: number; cells: number }>();
  let iced = 0,
    icedCells = 0,
    open = 0,
    openCells = 0;
  for (let i = 0; i < aurora.length; i++) {
    const latitude = south + ((north - south) * gridPosition(result.state.surface, i).y) / height;
    const key = Math.min(60, Math.floor(latitude / 10) * 10);
    const band = bands.get(key) ?? { total: 0, cells: 0 };
    band.total += aurora[i];
    band.cells++;
    bands.set(key, band);
    if (c.maximumIceThickness[i] > 1) {
      iced += aurora[i];
      icedCells++;
    } else {
      open += aurora[i];
      openCells++;
    }
  }
  const mean = (key: number) => bands.get(key)!.total / bands.get(key)!.cells;
  mkdirSync("test-results", { recursive: true });
  writeFileSync(
    "test-results/magic-climate.txt",
    `${[...bands.keys()]
      .sort((a, b) => a - b)
      .map((key) => `${key}°: aurora history ${mean(key).toFixed(1)}`)
      .join("\n")}\nice ${(iced / icedCells).toFixed(1)} open ${(open / openCells).toFixed(1)}\n`
  );
  expect(mean(50) + mean(60)).toBeGreaterThan((mean(10) + mean(20)) * 1.5);
  expect(iced / icedCells).toBeGreaterThan(open / openCells);
  // Coastal magic still forces coasts through the new currents and waves.
  expect(c.coastalForcingHistory.some((value) => value > 0)).toBe(true);
}, 300_000);
