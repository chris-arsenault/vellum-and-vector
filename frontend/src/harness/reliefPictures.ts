import { writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  gridCellBounds,
  unwrapCoordinates,
  MapScale,
  type Grid,
  type Band,
  type Bounds,
} from "@atlas/domain";
import { png } from "./quickTerrain";

/**
 * Grey pictures of what a map's relief is made of, from its saved fields: the ground lit from the
 * north-west with sea flat, and each part of the height on its own scale. Structure that colours
 * and labels hide on the overview shows here.
 */
const imageWidth = 1400;
/** Metres of height to one unit of shading, over a fixed distance: pictures of any map compare. */
const shadeMetres = 1500,
  shadeReach = 28_000;
type Channels = Record<string, Band>;

/** A field drawn into pixels; pixels no cell covers are NaN. */
function rasterize(grid: Grid, bounds: Bounds, values: (index: number) => number) {
  const [west, south, east, north] = bounds,
    scale = imageWidth / (east - west),
    width = imageWidth,
    height = Math.ceil((north - south) * scale),
    pixels = new Float64Array(width * height).fill(NaN);
  for (let index = 0; index < grid.active.length; index++) {
    if (!grid.active.get(index)) continue;
    const [x0, y0, x1, y1] = gridCellBounds(grid, index),
      value = values(index),
      centre = (x0 + x1) / 2,
      displayed = unwrapCoordinates(
        [
          [(west + east) / 2, 0],
          [centre, 0],
        ],
        grid.periodicWidth
      )[1][0],
      shift = displayed - centre;
    for (let row = Math.floor((north - y1) * scale); row < (north - y0) * scale; row++)
      for (
        let col = Math.floor((x0 + shift - west) * scale);
        col < (x1 + shift - west) * scale;
        col++
      )
        if (row >= 0 && row < height && col >= 0 && col < width) pixels[row * width + col] = value;
  }
  return { pixels, width, height, metresPerPixel: 1 / scale };
}
function grey(width: number, height: number, level: (at: number) => number) {
  const rgb = new Uint8Array(3 * width * height);
  for (let at = 0; at < width * height; at++)
    rgb.fill(Math.max(0, Math.min(255, Math.round(level(at) * 255))), 3 * at, 3 * at + 3);
  return png(width, height, rgb);
}
/** Ground lit from the north-west, at a strength that does not depend on the map's cell size. */
function shaded(grid: Grid, channels: Channels, bounds: Bounds) {
  const { pixels, width, height } = rasterize(grid, bounds, (i) =>
      Math.max(
        0,
        MapScale.metres(
          channels.Elevation.get(i) - (channels.EffectiveSeaLevel?.get(i) ?? 0),
          "native"
        )
      )
    ),
    reach = Math.max(1, Math.round((shadeReach / (bounds[2] - bounds[0])) * imageWidth)),
    at = (k: number) => (Number.isNaN(pixels[k]) ? 0 : pixels[k]);
  return grey(width, height, (k) => {
    if (Number.isNaN(pixels[k])) return 1;
    if (pixels[k] <= 0) return 0.62;
    const west = k - reach >= 0 ? at(k - reach) : at(k),
      north = k - reach * width >= 0 ? at(k - reach * width) : at(k);
    return 0.62 + (pixels[k] - (west + north) / 2) / shadeMetres;
  });
}
/** One part of the height, stretched between what it reaches on land. */
function part(grid: Grid, channels: Channels, name: string, bounds: Bounds) {
  const channel = channels[name],
    land: number[] = [];
  for (let i = 0; i < grid.active.length; i++)
    if (grid.active.get(i) && channels.Elevation.get(i) > (channels.EffectiveSeaLevel?.get(i) ?? 0))
      land.push(channel.get(i));
  land.sort((a, b) => a - b);
  const low = land[Math.floor(land.length * 0.02)],
    high = land[Math.floor(land.length * 0.995)];
  const { pixels, width, height } = rasterize(grid, bounds, (i) =>
    channels.Elevation.get(i) > (channels.EffectiveSeaLevel?.get(i) ?? 0) ? channel.get(i) : NaN
  );
  return grey(width, height, (k) =>
    Number.isNaN(pixels[k]) ? 1 : (pixels[k] - low) / Math.max(1, high - low)
  );
}
export function writeReliefPictures(
  grid: Grid,
  channels: Channels,
  out: string,
  kind: string,
  bounds: Bounds
) {
  writeFileSync(join(out, `${kind}-shade.png`), shaded(grid, channels, bounds));
  for (const name of ["CrustSupportElevation", "SurfaceRockLoad"])
    if (channels[name])
      writeFileSync(join(out, `${kind}-${name}.png`), part(grid, channels, name, bounds));
}
