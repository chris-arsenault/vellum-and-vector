import { baselineRock, hardestRock, hardnessOf, rockCatalogue } from "./rockCatalogue";
import type { RockKind } from "./rockCatalogue";
import type { GroundQuery } from "./ground";
import { averageGroundQuery, groundFact } from "./groundQuery";
import { compileMix, materialGives } from "./modes";
import type { MaterialLayer } from "./rockColumn";
import type { GroundSectionLayer } from "./groundShares";

/** Exposure of the nearest matching material, including solid beds above it. Depths are native. */
export function sectionExposure(
  section: readonly GroundSectionLayer[],
  reach: number,
  accepts: (layer: GroundSectionLayer) => boolean = (layer) => layer.medium === "rock"
) {
  const host = section.find(accepts);
  if (!host || reach <= 0) return 0;
  return Math.max(0, 1 - (section[0].top - host.top) / reach);
}

/** Average a material response through a finite depth, including loose cover and basement. */
export function sectionResponse(
  section: readonly GroundSectionLayer[],
  reach: number,
  response: (layer: GroundSectionLayer) => number
) {
  if (!section.length || reach <= 0) return 0;
  const floor = section[0].top - reach;
  let value = 0,
    thickness = 0;
  for (const layer of section) {
    const depth = Math.max(
      0,
      layer.top - Math.max(floor, layer.basement ? -Infinity : layer.bottom)
    );
    if (depth <= 0) continue;
    value += response(layer) * depth;
    thickness += depth;
  }
  return thickness > 0 ? value / thickness : 0;
}

/** Retained host thickness and the part reached from the surface, for a finite hosted inventory. */
export function sectionInventory(
  section: readonly GroundSectionLayer[],
  reach: number,
  concentration: (layer: GroundSectionLayer) => number
) {
  let available = 0,
    reached = 0;
  if (!section.length) return { available, reached };
  const surface = section[0].top;
  for (const layer of section) {
    const share = concentration(layer);
    if (share <= 0) continue;
    available += layer.depth * share;
    reached += Math.max(0, Math.min(layer.depth, reach - (surface - layer.top))) * share;
  }
  return { available, reached };
}

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

export interface YieldingPlane {
  response: number;
  compliance: number;
  mobility: number;
  slopeX: number;
  slopeY: number;
  kind: number;
  thickness: number;
  overburden: number;
  capStrength: number;
  strength: number;
  traversed: number;
  capWork: number;
}
const shear = compileMix({ shear: 1 });
const unselectedPlane: YieldingPlane = {
  response: 0,
  compliance: 0,
  mobility: 0,
  slopeX: 0,
  slopeY: 0,
  kind: 0,
  thickness: 0,
  overburden: 0,
  capStrength: 0,
  strength: 0,
  traversed: 0,
  capWork: 0,
};
/** Select the bed most responsive to this loading, keeping its weakness and signed dip together.
 * Each occupied facet resolves its own beds before their mechanical responses are combined. */
export function yieldingPlane(
  loading: (material: Readonly<MaterialLayer>) => number = () => 1,
  extent: "foundation" | "retained" | "detachment" = "foundation"
): GroundQuery<YieldingPlane> {
  return {
    start: { ...unselectedPlane },
    throughColumn: true,
    loose: (best, layer) => ({
      ...best,
      traversed: best.traversed + layer.thickness,
      capWork: best.capWork + layer.thickness * layer.strength,
    }),
    rock: (best, { material, thickness, retainedThickness, strength }) => {
      thickness = extent === "foundation" ? thickness : retainedThickness;
      if (thickness <= 0) return best;
      const compliance = materialGives(shear, material),
        mobility = compliance / (1 + compliance),
        response = loading(material) * mobility,
        capStrength = best.traversed > 0 ? best.capWork / best.traversed : strength,
        eligible = extent !== "detachment" || (best.traversed > 0 && capStrength > strength);
      const chosen =
        eligible && Math.abs(response) > Math.abs(best.response)
          ? {
              ...best,
              response,
              compliance,
              mobility,
              slopeX: material.bedSlopeX,
              slopeY: material.bedSlopeY,
              kind: material.kind,
              thickness,
              overburden: best.traversed,
              strength,
              capStrength,
            }
          : best;
      return {
        ...chosen,
        traversed: best.traversed + thickness,
        capWork: best.capWork + thickness * strength,
      };
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
        kind: share > 0.5 ? cut.kind : land.kind,
        thickness: land.thickness * (1 - share) + cut.thickness * share,
        overburden: land.overburden * (1 - share) + cut.overburden * share,
        capStrength: land.capStrength * (1 - share) + cut.capStrength * share,
        strength: land.strength * (1 - share) + cut.strength * share,
        traversed: land.traversed * (1 - share) + cut.traversed * share,
        capWork: land.capWork * (1 - share) + cut.capWork * share,
      };
    },
  };
}
/** Adjacent retained seams connect where their inclined intervals meet, not merely their rock names. */
export function seamContinuity(
  a: YieldingPlane,
  b: YieldingPlane,
  surfaceOffset: number,
  dx: number,
  dy: number
) {
  if (a.kind !== b.kind || a.overburden <= 0 || b.overburden <= 0) return 0;
  const prediction = ((a.slopeX + b.slopeX) * dx) / 2 + ((a.slopeY + b.slopeY) * dy) / 2,
    top = surfaceOffset - b.overburden + a.overburden - prediction,
    overlap = Math.max(0, Math.min(0, top) - Math.max(-a.thickness, top - b.thickness)),
    width = (a.thickness + b.thickness) / 2;
  return width > 0 ? overlap / width : 0;
}
/** A stiff cap transmits shortening farther over a continuous yielding bed. */
export function detachmentSpread(plane: YieldingPlane, continuity: number) {
  const contrast = Math.max(0, plane.capStrength - plane.strength) / Math.max(1, plane.capStrength),
    geometry = Math.sqrt(plane.overburden / Math.max(1, plane.thickness));
  return plane.mobility * contrast * continuity * geometry;
}
