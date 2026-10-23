import { terrainSampleBands as input } from "./numericTiles";

/** The same masked central differences used by hillshade, prepared once per tile. */
export function terrainTile(samples: Float32Array, size: number) {
  const output = input + 2;
  const values = new Float32Array(size * size * output);
  const height = (pixel: number, fallback: number) =>
    samples[pixel * input + 1] > 0.99 ? samples[pixel * input] : fallback;
  for (let row = 0; row < size; row++)
    for (let col = 0; col < size; col++) {
      const pixel = row * size + col,
        at = pixel * input,
        target = pixel * output;
      values.set(samples.subarray(at, at + input), target);
      if (!samples[at + 1]) continue;
      const z = samples[at],
        step = 2 * samples[at + 5];
      if (!(step > 0)) continue;
      const east =
        (height(row * size + Math.min(size - 1, col + 1), z) -
          height(row * size + Math.max(0, col - 1), z)) /
        step;
      const north =
        (height(Math.max(0, row - 1) * size + col, z) -
          height(Math.min(size - 1, row + 1) * size + col, z)) /
        step;
      values[target + input] = east;
      values[target + input + 1] = north;
    }
  return values;
}
