import { gridPosition, neighbors, spatial } from "@atlas/domain";
import type { GenerationState, HumanRound } from "./process";
import { Feature } from "./world/codes";
import { nearestSocietySample } from "./societySpatial";
import { dryLand, societyValue } from "./societySupport";

/** A camp whose mark the mesh still resolves. */
export interface RuinField {
  round: HumanRound;
  ruin: HumanRound["ruins"][number];
  mark: string;
  at: { x: number; y: number };
}

/**
 * A camp of an earlier round is a latent site the present prefers, not a World feature: a
 * band of a few dozen people is far below the mesh. What the mesh does resolve is the ground
 * the band changed: a vein it tapped until the conduit sealed into a basalt scar, or a weir
 * line the sea has since drowned into a reflecting shoal. Where a camp stood on such ground
 * there is a ruin field, which the ruin entry publishes (ADR 0005).
 */
export function ruinFields(state: GenerationState): RuinField[] {
  const grid = state.surface,
    covers = spatial.geometryCoverage(grid.scope.footprint),
    fields: RuinField[] = [];
  for (const round of state.rounds ?? [])
    for (const ruin of round.ruins) {
      const cell = nearestSocietySample(grid, ruin, (i) => dryLand(state, i));
      if (cell < 0) continue;
      const ground = [cell, ...neighbors(grid, cell, true, covers)];
      const mark = ground.some((i) => societyValue(state, "magic:fire:feature:scar", i) > 0)
        ? "a sealed vein"
        : ground.some((i) => drownedShoal(state, i))
          ? "a drowned weir line"
          : null;
      if (mark) fields.push({ round, ruin, mark, at: gridPosition(grid, cell) });
    }
  return fields;
}
/** Sea over a cell the cold age built a weir on: the shoal flag survives the drowning. */
function drownedShoal(state: GenerationState, i: number) {
  const physical = state.physical;
  if (!physical || societyValue(state, "water", i) !== 1) return false;
  const cell = i >= 0 && i < physical.samples.length ? physical.samples.get(i) : -1;
  return cell >= 0 && (physical.map.FeatureFlags.get(cell) & Feature.Shoal) !== 0;
}
