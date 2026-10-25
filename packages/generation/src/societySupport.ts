import { gridPosition, neighbors, spatial, type SocietySupport } from "@atlas/domain";
import type { GenerationState } from "./process";
import { nativePosition } from "./canonry/atlasWorkspace";

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
/**
 * Livelihoods a cell supports, from the climate, soil, cover and water it has. Magic enters
 * through the fields it wrote: quickened country has a long season, stilled country grows
 * nothing to farm, and the coast beside an upwelling front is a fishery.
 */
export function supportAt(
  state: GenerationState,
  i: number,
  river: number,
  coast = 0
): SocietySupport {
  if (!dryLand(state, i)) return emptySupport();
  const value = (name: string, fallback = 0) => societyValue(state, name, i, fallback);
  const temperature = value("temperature", 15);
  const growing = Math.exp(-Math.pow((temperature - 18) / 20, 2));
  const moisture = Math.max(0, Math.min(1, value("moisture", value("rainfall", 0.5))));
  const soil = Math.min(1, value("soilDepth", 0.3) / 0.5);
  const slope = value("slope");
  const water = Math.min(1, Math.max(moisture, river, storedSoilWater(state, i)));
  const grass = value("grassCover", 0.2);
  const trees = value("treeCover", 0.2);
  const productivity = Math.max(0, value("productivity", 0.1));
  const quickening = value("quickening"),
    stillness = value("stillness");
  const farming =
    35 *
    growing *
    soil *
    water *
    Math.exp(-slope * 12) *
    (1 - 0.8 * trees) *
    (1 + 0.5 * quickening) *
    (1 - 0.8 * stillness);
  const grazing = 5 * grass * growing * (1 + 0.5 * quickening) * (1 - 0.5 * stillness);
  const gathering = 2 * trees * Math.min(1, productivity * 3) + 2 * value("herbivores");
  const fishing = river * (0.5 + 4 * value("aquaticFauna")) + coast;
  return {
    farming,
    grazing,
    gathering,
    fishing,
    water,
    capacity: (farming + grazing + gathering + fishing) * (1 - Math.min(1, value("ice"))),
  };
}
/**
 * The catch a shore cell can land from the sea beside it: the sea's fauna, more where a
 * front upwells, almost nothing beside a Pressure crush zone.
 */
export function coastalFishery(state: GenerationState) {
  const grid = state.surface,
    covers = spatial.geometryCoverage(grid.scope.footprint),
    result = new Float64Array(grid.active.length);
  const water = grid.channels.water;
  if (!water) return result;
  for (let i = 0; i < result.length; i++) {
    if (!dryLand(state, i)) continue;
    const sea = neighbors(grid, i, true, covers).filter((j) => water[j] === 1);
    if (!sea.length) continue;
    const fauna = sea.reduce((s, j) => s + societyValue(state, "aquaticFauna", j), 0) / sea.length,
      upwelling = Math.max(...sea.map((j) => societyValue(state, "upwelling", j))),
      crushed =
        Math.max(...sea.map((j) => societyValue(state, "magic:pressure:intensity", j))) >= 360;
    // Upwelling is a 0..1 ratio on the surface: a full front doubles the catch.
    result[i] = (0.5 + 4 * fauna + 2 * upwelling) * (crushed ? 0.3 : 1);
  }
  return result;
}
/** The water a cell's soil can hold, metres: its depth times a porosity that rises with carbon. */
export function soilWaterCapacity(state: GenerationState, i: number) {
  const depth = societyValue(state, "soilDepth", i, 0.3);
  const carbon = Math.min(1, societyValue(state, "soilCarbon", i) / 30);
  return depth * (0.12 + carbon * 0.15);
}
function storedSoilWater(state: GenerationState, i: number) {
  return societyValue(state, "soilWater", i) / Math.max(0.01, soilWaterCapacity(state, i));
}

/** Sample every retained channel, including reaches omitted from visible cartography. */
export function channelAccess(state: GenerationState) {
  const grid = state.surface,
    result = new Float64Array(grid.active.length);
  const size = Math.max(1000, grid.scope.resolution ?? 1000);
  const buckets = liveDrainage(state)
    ? liveChannelBuckets(state.physical!, size)
    : channelBuckets(state, size);
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
/**
 * The live mesh is read mid-cycle, and inside an epoch before any extraction, when it is
 * the only drainage there is; otherwise the retained network is the record.
 */
function liveDrainage(state: GenerationState) {
  if (!state.physical) return false;
  return Boolean(state.society?.cycle) || !state.domain.world.drainage?.[state.domain.scope.areaId];
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
function liveChannelBuckets(work: NonNullable<GenerationState["physical"]>, size: number) {
  const buckets = new Map<string, [number, number, number][]>();
  for (let i = 0; i < work.map.mesh.count; i++) {
    if (work.map.RiverOrders[i] <= 0) continue;
    const p = nativePosition(work, i);
    const key = `${Math.floor(p.x / size)}:${Math.floor(p.y / size)}`;
    const bucket = buckets.get(key) ?? [];
    bucket.push([p.x, p.y, work.map.FlowAccumulation[i]]);
    buckets.set(key, bucket);
  }
  return buckets;
}
