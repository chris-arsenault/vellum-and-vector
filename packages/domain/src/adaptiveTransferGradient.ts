import { adaptiveCell, type AdaptiveTopology } from "./adaptiveTopology";
import { ByteCache } from "./byteCache";

export type TransferSamples = ArrayLike<number> | ((index: number) => number);
const transferGradientCacheBytes = 256 * 1024;
/** Face-weighted least squares with the same neighbor extrema limiter used by remeshing. */
export function transferGradients(topology: AdaptiveTopology, sample: (i: number) => number) {
  const cache = new ByteCache<number, [number, number]>(transferGradientCacheBytes);
  return (i: number): [number, number] => {
    const previous = cache.get(i);
    if (previous) return previous;
    const box = adaptiveCell(topology, i),
      value = sample(i);
    let xx = 0,
      xy = 0,
      yy = 0,
      vx = 0,
      vy = 0,
      low = value,
      high = value;
    for (let at = topology.offsets[i]; at < topology.offsets[i + 1]; at++) {
      const j = topology.neighbors[at],
        other = adaptiveCell(topology, j),
        dx = (other[0] + other[2] - box[0] - box[2]) / 2,
        dy = (other[1] + other[3] - box[1] - box[3]) / 2,
        weight = topology.faceLengths[at] / topology.distances[at] ** 2,
        next = sample(j),
        delta = next - value;
      xx += weight * dx * dx;
      xy += weight * dx * dy;
      yy += weight * dy * dy;
      vx += weight * dx * delta;
      vy += weight * dy * delta;
      low = Math.min(low, next);
      high = Math.max(high, next);
    }
    const determinant = xx * yy - xy * xy,
      x = determinant > 0 ? (vx * yy - vy * xy) / determinant : 0,
      y = determinant > 0 ? (vy * xx - vx * xy) / determinant : 0,
      excursion = (Math.abs(x) * (box[2] - box[0]) + Math.abs(y) * (box[3] - box[1])) / 2,
      factor =
        excursion > 0 ? Math.min(1, (value - low) / excursion, (high - value) / excursion) : 1;
    const result: [number, number] = [x * factor, y * factor];
    cache.set(i, result, 96);
    return result;
  };
}
