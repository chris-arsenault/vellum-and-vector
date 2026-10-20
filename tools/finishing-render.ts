import { readFile, writeFile } from "node:fs/promises";
import { deserialize } from "node:v8";
import { biomes, fieldInterpolator, spatial, type Grid } from "../packages/domain/src/index";
import type { AtlasFeature } from "../packages/domain/src/model";
import { tilePainter, rasterLimits } from "../frontend/src/rasterTiles";

const directory = process.argv[2] ?? ".artifacts/finishing-draft-104729",
  after = deserialize(await readFile(`${directory}/after.bin`)) as {
    grid: Grid;
    features: AtlasFeature[];
  },
  views: [string, number[]][] = [["overview", after.grid.bounds]];
for (const kind of ["crater", "volcano", "pass", "gorge", "forest"]) {
  const feature = after.features.find((f) => f.kind === kind);
  if (!feature) continue;
  const [x0, y0, x1, y1] = spatial.bounds(feature.geometry),
    x = (x0 + x1) / 2,
    y = (y0 + y1) / 2,
    radius = Math.max(30_000, Math.min(160_000, Math.max(x1 - x0, y1 - y0) * 0.8));
  views.push([kind, [x - radius, y - radius, x + radius, y + radius]]);
}
for (const phase of ["before", "after"]) {
  const { grid } = deserialize(await readFile(`${directory}/${phase}.bin`)) as { grid: Grid };
  const raster = {
      id: grid.id,
      areaId: grid.scope.areaId,
      footprint: grid.scope.footprint,
      bounds: grid.bounds,
      channel: "elevation",
      field: grid,
      water: grid,
      ice: grid,
    },
    paint = tilePainter(raster, rasterLimits([raster]));
  for (const [name, extent] of views) {
    const size = 384,
      rgba = paint(extent, size),
      rgb = new Uint8Array(size * size * 3);
    for (let i = 0; i < size * size; i++) rgb.set(rgba.subarray(i * 4, i * 4 + 3), i * 3);
    await writeFile(
      `${directory}/${phase}-${name}.ppm`,
      Buffer.concat([Buffer.from(`P6\n${size} ${size}\n255\n`), rgb])
    );
    console.log(phase, name);
  }
  for (const channel of [
    "biome",
    "treeCover",
    "wetlandCover",
    "alteredCover",
    ...Object.keys(grid.channels)
      .filter((name) => name.startsWith("magic:") && name.endsWith(":intensity"))
      .slice(0, 3),
  ]) {
    if (!grid.channels[channel]) continue;
    const size = 384,
      read = fieldInterpolator(grid, channel, channel === "biome"),
      rgb = new Uint8Array(size * size * 3),
      [x0, y0, x1, y1] = grid.bounds;
    for (let row = 0; row < size; row++)
      for (let col = 0; col < size; col++) {
        const value = read({
            x: x0 + ((col + 0.5) * (x1 - x0)) / size,
            y: y1 - ((row + 0.5) * (y1 - y0)) / size,
            z: 0,
          }),
          color =
            channel === "biome"
              ? (biomes[Math.round(value)] ?? biomes[0]).color
                  .match(/[0-9a-f]{2}/g)!
                  .map((v) => parseInt(v, 16))
              : [
                  230 - 150 * Math.min(1, value),
                  235 - 90 * Math.min(1, value),
                  220 - 170 * Math.min(1, value),
                ];
        rgb.set(color, (row * size + col) * 3);
      }
    await writeFile(
      `${directory}/${phase}-${channel.replaceAll(":", "-")}.ppm`,
      Buffer.concat([Buffer.from(`P6\n${size} ${size}\n255\n`), rgb])
    );
  }
}
