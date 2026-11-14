import type { Bounds } from "@atlas/map";

export interface RasterSamples {
  bounds: Bounds;
  width: number;
  height: number;
  bands: string[];
  values: ArrayLike<number | bigint>[];
}
/** Sample a GIS pixel grid at pixel centres; categories keep their exact published codes. */
export function rasterSample(
  data: RasterSamples,
  band: string,
  x: number,
  y: number,
  categorical = false
) {
  const index = data.bands.indexOf(band);
  if (index < 0) throw new Error(`Published raster is missing ${band}.`);
  const [west, south, east, north] = data.bounds;
  const col = Math.max(
    0,
    Math.min(data.width - 1, ((x - west) / (east - west)) * data.width - 0.5)
  );
  const row = Math.max(
    0,
    Math.min(data.height - 1, ((north - y) / (north - south)) * data.height - 0.5)
  );
  const at = (col: number, row: number) => Number(data.values[index][row * data.width + col]);
  if (categorical) return at(Math.round(col), Math.round(row));
  const left = Math.floor(col),
    top = Math.floor(row),
    right = Math.min(data.width - 1, left + 1),
    bottom = Math.min(data.height - 1, top + 1);
  const dx = col - left,
    dy = row - top;
  return (
    at(left, top) * (1 - dx) * (1 - dy) +
    at(right, top) * dx * (1 - dy) +
    at(left, bottom) * (1 - dx) * dy +
    at(right, bottom) * dx * dy
  );
}
