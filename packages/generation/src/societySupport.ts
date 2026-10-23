import { gridPosition, type SocietySupport } from "@atlas/domain";
import type { GenerationState } from "./process";

export const emptySupport = (): SocietySupport => ({
  farming: 0,
  grazing: 0,
  gathering: 0,
  fishing: 0,
  water: 0,
  capacity: 0,
});
export function societyValue(state: GenerationState, channel: string, i: number, fallback = 0) {
  return state.surface.channels[channel]?.[i] ?? fallback;
}
export function dryLand(state: GenerationState, i: number) {
  const { active, channels: c } = state.surface;
  return Boolean(active[i] && (c.water ? c.water[i] === 0 : c.elevation[i] > 0));
}
export function supportAt(state: GenerationState, i: number, river: number): SocietySupport {
  if (!dryLand(state, i)) return emptySupport();
  const value = (name: string, fallback = 0) => societyValue(state, name, i, fallback);
  const temperature = value("temperature", 15);
  const growing = Math.exp(-Math.pow((temperature - 18) / 20, 2));
  const moisture = Math.max(0, Math.min(1, value("moisture", value("rainfall", 0.5))));
  const soil = Math.min(1, value("soilDepth", 0.3) / 0.5);
  const slope = value("slope");
  const water = Math.max(moisture, river);
  const grass = value("grassCover", 0.2);
  const trees = value("treeCover", 0.2);
  const productivity = Math.max(0, value("productivity", 0.1));
  const farming = 35 * growing * soil * water * Math.exp(-slope * 12);
  const grazing = 5 * grass * growing;
  const gathering = 2 * trees * Math.min(1, productivity * 3);
  const fishing = river * (0.5 + 4 * value("aquaticFauna"));
  return {
    farming,
    grazing,
    gathering,
    fishing,
    water,
    capacity: (farming + grazing + gathering + fishing) * (1 - Math.min(1, value("ice"))),
  };
}

/** Sample every retained channel, including reaches omitted from visible cartography. */
export function channelAccess(state: GenerationState) {
  const grid = state.surface,
    result = new Float64Array(grid.active.length);
  const size = Math.max(1000, grid.scope.resolution ?? 1000);
  const buckets = channelBuckets(state, size);
  for (let i = 0; i < result.length; i++) {
    const p = gridPosition(grid, i),
      x = Math.floor(p.x / size),
      y = Math.floor(p.y / size);
    for (let dx = -1; dx <= 1; dx++)
      for (let dy = -1; dy <= 1; dy++)
        for (const [a, b, flow] of buckets.get(`${x + dx}:${y + dy}`) ?? [])
          result[i] = Math.max(
            result[i],
            Math.exp(-Math.hypot(a - p.x, b - p.y) / size) * (1 - Math.exp(-Math.max(0, flow)))
          );
  }
  return result;
}
function channelBuckets(state: GenerationState, size: number) {
  const buckets = new Map<string, [number, number, number][]>();
  for (const network of Object.values(state.domain.world.drainage ?? {})) {
    if (network.spaceId !== state.surface.scope.spaceId) continue;
    for (const reach of network.reaches)
      for (const [j, p] of reach.coordinates.entries()) {
        const key = `${Math.floor(p[0] / size)}:${Math.floor(p[1] / size)}`;
        const bucket = buckets.get(key) ?? [];
        bucket.push([p[0], p[1], reach.discharges[j] ?? 0]);
        buckets.set(key, bucket);
      }
  }
  return buckets;
}
