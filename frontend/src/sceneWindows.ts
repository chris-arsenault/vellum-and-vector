import { spatial, type Bounds, type World } from "@atlas/domain";

/** Query both sides of a seam; the map renderer repeats the returned canonical chart. */
export function sceneWindows(world: World, extent: Bounds): Bounds[] {
  if (world.reference.boundaryMode !== "cylinder") return [extent];
  const [west, , east] = spatial.bounds(world.reference.domain),
    width = east - west;
  const span = extent[2] - extent[0];
  if (span >= width) return [[west, extent[1], east, extent[3]]];
  const low = west + ((((extent[0] - west) % width) + width) % width),
    high = low + span;
  return high <= east
    ? [[low, extent[1], high, extent[3]]]
    : [
        [low, extent[1], east, extent[3]],
        [west, extent[1], west + high - east, extent[3]],
      ];
}
export function displayTolerance(resolution: number) {
  return Number.isFinite(resolution) && resolution > 0
    ? 2 ** Math.floor(Math.log2(resolution / 2))
    : 0;
}
