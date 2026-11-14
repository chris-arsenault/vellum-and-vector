import type { MagicCondition, MagicFeatureRule } from "./magicSystems";

/** The condition and rule builders the Canonry presets are written with. */
export const at = (field: string, min: number): MagicCondition => ({ field, min });
export const oneOf = (field: string, values: number[]): MagicCondition => ({ field, values });
export const land = oneOf("water", [0, 2]);
export const ocean = oneOf("water", [1]);
/** Rules whose places are points: located sources and the site complexes classified around them. */
const siteRules = new Set([
  "core",
  "spring",
  "wellspring",
  "sinkhole",
  "vent",
  "well",
  "locus",
  "rogue",
  "breach",
  "crater",
  "oasis",
  "door",
]);
const courseRules = new Set(["vein", "wake", "steam", "placer"]);
export const feature = (
  id: string,
  name: string,
  priority: number,
  seeds: MagicCondition[][],
  retains?: MagicCondition[][],
  coverage?: MagicFeatureRule["coverage"]
): MagicFeatureRule => ({
  id,
  name,
  priority,
  seeds,
  cartography: siteRules.has(id) ? "site" : courseRules.has(id) ? "course" : "area",
  ...(retains ? { retains } : {}),
  ...(coverage ? { coverage } : {}),
});
/** A class covers its cell in proportion to its intensity above the retain threshold. */
export const covers = (floor: number, full = 1000): MagicFeatureRule["coverage"] => ({
  field: "intensity",
  floor,
  full,
});
