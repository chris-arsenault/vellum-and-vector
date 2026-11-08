import { baselineRock, hardestRock, hardnessOf, rockCatalogue } from "./rockCatalogue";
import type { RockKind } from "./rockCatalogue";
import type { GroundQuery } from "./ground";
import { averageGroundQuery, groundFact } from "./groundQuery";

/**
 * Reads of the surface that many readers share. A reader with its own question writes its own query
 * beside itself; nothing here knows who asks.
 */
/** The kind of rock at the surface. */
export const surfaceKind: GroundQuery<RockKind> = {
  start: rockCatalogue.strata,
  rock: (_, { kind }) => kind,
};
/** Its resistance as altered here, on the catalogue's scale. */
export const surfaceResistance = averageGroundQuery({
  start: 0,
  rock: (_, { strength }) => strength,
});
/** Its resistance against ordinary rock. */
export const surfaceRelative = averageGroundQuery({
  start: 0,
  rock: (_, { strength }) => strength / baselineRock,
});
/** Its resistance as a share of the hardest rock there is. */
export const surfaceShareOfHardest = averageGroundQuery({
  start: 0,
  rock: (_, { strength }) => strength / hardestRock,
});
/** How hard it is for anything judging its character, in [0, 1]. */
export const surfaceHardness = averageGroundQuery({
  start: 0,
  rock: (_, { strength }) => hardnessOf(strength),
});
/** How broken it is: its rock's joints, or the fractures that crossed it. */
export const surfaceOpenness = averageGroundQuery({
  start: 0,
  rock: (_, layer, { fracture }) => Math.max(groundFact(layer, "jointing"), fracture),
});
/** Porosity of the retained constituents across all occupied rock surfaces. */
export const surfacePorosity = averageGroundQuery({
  start: 0,
  rock: (_, layer) => groundFact(layer, "porosity"),
});
/**
 * How firmly it stands against ordinary rock's 1, for anything that scales with it without wearing it:
 * how far apart thrust sheets break, how sharp its fine relief, how narrow its channels, how slowly
 * water seeps through. One limit, so these readers cannot drift apart.
 */
export const surfaceStanding = averageGroundQuery({
  start: 1,
  rock: (_, { strength }) => Math.max(0.6, Math.min(1.6, strength / baselineRock)),
});
