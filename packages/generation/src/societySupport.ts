import { MapScale, type SocietySupport, type FieldChannelName } from "@atlas/domain";
import type { GenerationState } from "./process";
import { mapScale } from "./worldSignificance";
import { coastalNeighbors } from "./societySpatial";
export { channelAccess } from "./societyChannelAccess";

export const emptySupport = (): SocietySupport => ({
  farming: 0,
  grazing: 0,
  gathering: 0,
  fishing: 0,
  water: 0,
  capacity: 0,
});
export function societyValue(
  state: GenerationState,
  channel: FieldChannelName,
  i: number,
  fallback = 0
) {
  const values = state.surface.channels[channel];
  return values && i >= 0 && i < values.length ? values.get(i) : fallback;
}
export function dryLand(state: Pick<GenerationState, "surface">, i: number) {
  const { active, channels: c } = state.surface;
  if (i < 0 || i >= active.length) return false;
  return Boolean(
    active.get(i) &&
    (c.WaterKindCodes
      ? c.WaterKindCodes.get(i) === 0
      : (c.Elevation?.get(i) ?? 0) > (c.EffectiveSeaLevel?.get(i) ?? 0))
  );
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
  const value = (name: FieldChannelName, fallback = 0) => societyValue(state, name, i, fallback);
  const temperature = value("Temperature", 450);
  const growing = Math.exp(-Math.pow((temperature - 480) / 200, 2));
  const scale = mapScale(state);
  const moisture = Math.max(
    0,
    Math.min(
      1,
      value(
        "Moisture",
        (1000 * value("Rainfall", MapScale.inUnits(scale.length(1.25e-7), "mm"))) /
          MapScale.inUnits(scale.length(2.5e-7), "mm")
      ) / 1000
    )
  );
  const soil = Math.min(1, value("SoilDepth", scale.length(7.5e-8)) / scale.length(1.25e-7));
  const slope = value("Slope");
  const water = Math.min(1, Math.max(moisture, river, storedSoilWater(state, i)));
  const grass = value("GrassCover", 0.2);
  const trees = value("TreeCover", 0.2);
  const productivity = Math.max(0, value("Productivity", 0.1));
  const quickening = value("Quickening"),
    stillness = value("Stillness");
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
  const gathering = 2 * trees * Math.min(1, productivity * 3) + 2 * value("Herbivores");
  const fishing = river * (0.5 + 4 * value("AquaticFauna")) + coast;
  return {
    farming,
    grazing,
    gathering,
    fishing,
    water,
    capacity:
      (farming + grazing + gathering + fishing) *
      (1 - Math.min(1, value("IceThickness") / scale.length(0.00025))),
  };
}
/**
 * The catch a shore cell can land from the sea beside it: the sea's fauna, more where a
 * front upwells, almost nothing beside a Pressure crush zone.
 */
export function coastalFishery(state: GenerationState) {
  const grid = state.surface,
    result = grid.coverage.scratch("float64", "society-coastal-fishery", grid.active.length);
  result.retain();
  const water = grid.channels.WaterKindCodes;
  if (!water) return result;
  const adjacent = coastalNeighbors(state);
  for (let i = 0; i < result.length; i++) {
    if (!dryLand(state, i)) continue;
    let count = 0,
      fauna = 0,
      upwelling = -Infinity,
      pressure = -Infinity;
    for (const j of adjacent.at(i)) {
      if (water.get(j) !== 1) continue;
      count++;
      fauna += societyValue(state, "AquaticFauna", j);
      upwelling = Math.max(upwelling, societyValue(state, "Upwelling", j) / 1000);
      pressure = Math.max(pressure, societyValue(state, "magic:pressure:intensity", j));
    }
    if (!count) continue;
    // A full upwelling front doubles the catch.
    result.set(i, (0.5 + (4 * fauna) / count + 2 * upwelling) * (pressure >= 360 ? 0.3 : 1));
  }
  return result;
}
/** The water a cell's soil can hold, metres: its depth times a porosity that rises with carbon. */
export function soilWaterCapacity(state: GenerationState, i: number) {
  const depth = societyValue(state, "SoilDepth", i, mapScale(state).length(7.5e-8));
  const carbon = Math.min(1, societyValue(state, "SoilCarbon", i) / 30);
  return depth * (0.12 + carbon * 0.15);
}
function storedSoilWater(state: GenerationState, i: number) {
  return (
    societyValue(state, "SoilWater", i) /
    Math.max(mapScale(state).length(2.5e-9), soilWaterCapacity(state, i))
  );
}
