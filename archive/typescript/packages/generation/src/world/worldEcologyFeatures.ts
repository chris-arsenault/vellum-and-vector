import { canonicalGeometry, classMarginInterpolator, spatial } from "@atlas/domain";
import type { GenerationState } from "../process";
import { landscapeMinimumArea, mapScale } from "../worldSignificance";
import type { BiomeRule, BiomeSummary } from "./ecologyBiomes";
import {
  geographicContour,
  fillSmallHoles,
  membershipSampler,
  areaGeometry,
} from "./geographicContours";
import { projectedValues } from "./atlasSampling";
import type { RegionMembers } from "./regionMembers";
import type { Geometry } from "geojson";

/**
 * The dry part of a landscape inside the map: the map's footprint and its standing water
 * (sea and lakes, as one shape) are prepared once, since every landscape is cut by them.
 */
function dryExtents(state: GenerationState) {
  const clip = spatial.intersectionWith(state.domain.scope.footprint),
    water = [
      ...(state.surface.ocean ? [state.surface.ocean] : []),
      ...(state.surface.lakes ?? []).map((lake) => lake.geometry),
    ],
    subtract = water.length ? spatial.differenceFrom(spatial.unionAll(water)) : null;
  return (shape: Geometry) => {
    const extent = areaGeometry(clip(canonicalGeometry(state.domain.world.reference, shape)));
    return extent && subtract ? areaGeometry(subtract(extent)) : extent;
  };
}

/** What every landscape's outline reads, prepared once: the biome raster and the dry extent. */
export function landscapeSurface(state: GenerationState) {
  const work = state.physical!,
    map = work.map,
    codes = projectedValues(work, map.BiomeCodes, true);
  return {
    codes,
    field: { ...state.surface, channels: { biome: codes }, overlays: [] },
    dry: dryExtents(state),
    /** A hole smaller than the least landscape at this map's scale closes unless water fills it. */
    smallHole: mapScale(state).resolveMeasure(landscapeMinimumArea),
    wet: (i: number) => map.WaterKindCodes.get(i) !== 0,
  };
}
export type LandscapeSurface = ReturnType<typeof landscapeSurface>;
/** A family's signed margin against the other classes, from the biome raster's class weights. */
export const familyMargin = (surface: LandscapeSurface, family: (code: number) => boolean) =>
  classMarginInterpolator(surface.field, "biome", family);
/**
 * A landscape piece's outline: the class margin, where it meets the neighbouring pieces at the
 * line its share passes theirs, read together, then cut by the sea and lakes.
 */
export function landscapeExtent(
  state: GenerationState,
  surface: LandscapeSurface,
  margin: ReturnType<typeof familyMargin>,
  piece: RegionMembers,
  own: (i: number) => number,
  others: (i: number) => number
) {
  const ownShare = membershipSampler(state, own),
    otherShare = membershipSampler(state, others),
    at = (x: number, y: number) =>
      Math.min(margin({ x, y, z: 0 }), ownShare(x, y) - Math.max(0.1, otherShare(x, y))),
    shape = geographicContour(state, piece, at, 0);
  return shape ? surface.dry(fillSmallHoles(state, shape, surface.smallHole, surface.wet)) : null;
}
/** A landscape's published attributes, from its biome rule and its means. */
export const landscapeAttributes = (rule: BiomeRule, summary: BiomeSummary) => ({
  sourceAlgorithm: "atlas-world-geography-1",
  biome: rule.name(summary),
  system: rule.system?.(summary) ?? null,
  treeCover: summary.broadleaf + summary.conifer,
  grassCover: summary.grass,
  wetlandCover: summary.wetland,
  temperature: summary.temperature,
  moisture: summary.moisture,
});
