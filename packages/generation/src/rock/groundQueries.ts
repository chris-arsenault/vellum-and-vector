import { baselineRock, hardestRock, hardnessOf, rockCatalogue } from "./rockCatalogue";
import type { RockKind } from "./rockCatalogue";
import type { GroundQuery } from "./ground";
import { averageGroundQuery, groundFact } from "./groundQuery";
import { compileMix, materialGives } from "./modes";
import type { MaterialLayer } from "./rockColumn";

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

interface YieldingPlane {
  response: number;
  compliance: number;
  mobility: number;
  slopeX: number;
  slopeY: number;
}
const shear = compileMix({ shear: 1 });
/** Select the bed most responsive to this loading, keeping its weakness and signed dip together.
 * Each occupied facet resolves its own beds before their mechanical responses are combined. */
export function yieldingPlane(
  loading: (material: Readonly<MaterialLayer>) => number = () => 1
): GroundQuery<YieldingPlane> {
  return {
    start: { response: 0, compliance: 0, mobility: 0, slopeX: 0, slopeY: 0 },
    throughColumn: true,
    rock: (best, { material }) => {
      const compliance = materialGives(shear, material),
        mobility = compliance / (1 + compliance),
        response = loading(material) * mobility;
      return Math.abs(response) > Math.abs(best.response)
        ? { response, compliance, mobility, slopeX: material.bedSlopeX, slopeY: material.bedSlopeY }
        : best;
    },
    acrossFacets: (land, cut, share) => {
      const a = land.compliance * (1 - share),
        b = cut.compliance * share,
        compliance = a + b;
      return {
        response: land.response * (1 - share) + cut.response * share,
        compliance,
        mobility: land.mobility * (1 - share) + cut.mobility * share,
        slopeX: compliance > 0 ? (land.slopeX * a + cut.slopeX * b) / compliance : 0,
        slopeY: compliance > 0 ? (land.slopeY * a + cut.slopeY * b) / compliance : 0,
      };
    },
  };
}
