import type { GenerationState } from "../process";
import type { PhysicalField } from "./field";
import { alignedNeighbor } from "./atmosphere";
import { clamp } from "./math";
import { carryOut, settle, shed, spoilSoil } from "../rock/groundLedger";

/**
 * What a storm track does to the ground it crosses, once per epoch after the climate pass:
 * it scours soil in proportion to the slope it falls on, and on bare ground it drives a share
 * of the sediment downwind as dunes. Cover holds both soil and sand in place.
 */
export function stormWrites(state: GenerationState) {
  const work = state.physical!,
    map = work.map,
    p = work.profile;
  if (!map.coverage.reduce(map.StormTrack, (tracked, value) => tracked + (value ? 1 : 0), 0))
    return;
  for (let i = 0; i < map.mesh.count; i++) {
    const track = map.StormTrack.get(i) / 1000;
    if (track <= 0 || map.WaterKindCodes.get(i) !== 0) continue;
    const scour = p.StormScour * track * clamp(map.Slope.get(i) / 0.05, 0, 1);
    spoilSoil(map, i, scour, "storms");
    map.SoilWater.set(i, map.SoilWater.get(i) * (1 - scour));
    if (bare(map, i)) driveDunes(map, i, p.DuneMobility * track);
  }
}
const bare = (map: PhysicalField, i: number) =>
  map.TreeCover.get(i) + map.GrassCover.get(i) + map.WetlandCover.get(i) < 0.12;
/**
 * Sand leaves a bare cell for its downwind neighbour; the sea swallows what reaches it. The
 * sand is sediment the budget already counted when it was first laid down, so the move
 * changes thicknesses and nothing in the produced, deposited and exported totals.
 */
function driveDunes(map: PhysicalField, i: number, share: number) {
  const moving = map.SedimentThickness.get(i) * share;
  if (moving <= 0) return;
  const target = alignedNeighbor(map, i, map.WindX.get(i) / 1000, map.WindY.get(i) / 1000);
  if (target < 0) return;
  const volume = (moving * map.mesh.area(i)) / 1024;
  shed(map, i, volume, "pressure");
  if (map.WaterKindCodes.get(target) === 1) carryOut(map, volume, "pressure");
  else settle(map, target, volume);
}
