import { readFile, writeFile } from "node:fs/promises";
import { deserialize, serialize } from "node:v8";
import { createGrid, rectangle, resample, type Grid } from "../packages/domain/src/index";
import { sampleFinishedLandscape } from "../packages/generation/src/canonry/macroSampling";
import type { GenerationState } from "../packages/generation/src/process";
import { tilePainter, rasterLimits } from "../frontend/src/rasterTiles";

const directory = process.argv[2] ?? ".artifacts/finishing-standard-104729",
  state = deserialize(await readFile(`${directory}/composed-fixture.bin`)) as GenerationState,
  before = deserialize(await readFile(`${directory}/before.bin`)).grid as Grid,
  finishing = state.physical!.finishing!,
  center =
    finishing.passes[0].profile.points[Math.floor(finishing.passes[0].profile.points.length / 2)],
  radius = 250_000,
  bounds = [
    Math.max(before.bounds[0], center[0] - radius),
    Math.max(before.bounds[1], center[1] - radius),
    Math.min(before.bounds[2], center[0] + radius),
    Math.min(before.bounds[3], center[1] + radius),
  ] as [number, number, number, number],
  grid = createGrid(
    "mixed-region",
    { ...before.scope, footprint: rectangle(bounds) },
    Math.ceil((bounds[2] - bounds[0]) / before.scope.resolution) + 1,
    Math.ceil((bounds[3] - bounds[1]) / before.scope.resolution) + 1
  ),
  profiles = finishing.profiles.filter((p) => {
    const width = Math.max(...p.widths);
    return p.points.some(
      ([x, y]) =>
        x >= bounds[0] - width &&
        x <= bounds[2] + width &&
        y >= bounds[1] - width &&
        y <= bounds[3] + width
    );
  });
for (const name of Object.keys(before.channels)) resample(before, grid, name);
const finished = sampleFinishedLandscape(grid, profiles),
  { fieldInterpolator } = await import("../packages/domain/src/index");
for (const pass of finishing.passes)
  for (const [x, y] of pass.profile.points)
    if (x >= bounds[0] && x <= bounds[2] && y >= bounds[1] && y <= bounds[3]) {
      const read = fieldInterpolator(finished, "elevation"),
        started = performance.now();
      let checksum = 0;
      for (let j = 0; j < 2; j++) {
        const start = performance.now();
        for (let i = 0; i < 258 * 258; i++)
          checksum += read({ x: x + (i % 258) * 100, y: y + Math.floor(i / 258) * 100, z: 0 });
        console.log("Tile", j, (performance.now() - start) / 1000);
      }
      console.log({
        checksum,
        totalSampling: (performance.now() - started) / 1000,
        peakRssMiB: process.resourceUsage().maxRSS / 1024,
      });
      await writeFile(
        `${directory}/sampled-region.bin`,
        serialize({ grid: finished, profiles: profiles.length })
      );
      const rgb = new Uint8Array(512 * 256 * 3);
      for (const [panel, field] of [grid, finished].entries()) {
        const raster = {id: field.id, areaId: field.scope.areaId, footprint: field.scope.footprint,
          bounds: field.bounds, channel: "elevation", field, water: grid, ice: grid},
          rgba = tilePainter(raster, rasterLimits([raster]))(bounds, 256);
        for (let row = 0; row < 256; row++)
          for (let column = 0; column < 256; column++) {
            const from = (row * 256 + column) * 4,
              to = (row * 512 + column + panel * 256) * 3;
            rgb.set(rgba.subarray(from, from + 3), to);
          }
      }
      await writeFile(`${directory}/sampled-region.ppm`, Buffer.concat([Buffer.from("P6\n512 256\n255\n"), rgb]));
      process.exit(0);
    }
