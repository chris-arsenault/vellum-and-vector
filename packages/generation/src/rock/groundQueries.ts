import { baselineRock, hardestRock, hardnessOf, rockCatalogue } from "./rockCatalogue";
import type { RockKind } from "./rockCatalogue";
import type { GroundQuery } from "./ground";

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
export const surfaceResistance: GroundQuery<number> = {
  start: 0,
  rock: (_, { strength }) => strength,
};
/** Its resistance against ordinary rock. */
export const surfaceRelative: GroundQuery<number> = {
  start: 0,
  rock: (_, { strength }) => strength / baselineRock,
};
/** Its resistance as a share of the hardest rock there is. */
export const surfaceShareOfHardest: GroundQuery<number> = {
  start: 0,
  rock: (_, { strength }) => strength / hardestRock,
};
/** How hard it is for anything judging its character, in [0, 1]. */
export const surfaceHardness: GroundQuery<number> = {
  start: 0,
  rock: (_, { strength }) => hardnessOf(strength),
};
/** How broken it is: its rock's joints, or the fractures that crossed it. */
export const surfaceOpenness: GroundQuery<number> = {
  start: 0,
  rock: (_, { kind }, { fracture }) => Math.max(kind.jointing, fracture),
};
/**
 * How firmly it stands against ordinary rock's 1, for anything that scales with it without wearing it:
 * how far apart thrust sheets break, how sharp its fine relief, how narrow its channels, how slowly
 * water seeps through. One limit, so these readers cannot drift apart.
 */
export const surfaceStanding: GroundQuery<number> = {
  start: 1,
  rock: (_, { strength }) => Math.max(0.6, Math.min(1.6, strength / baselineRock)),
};
