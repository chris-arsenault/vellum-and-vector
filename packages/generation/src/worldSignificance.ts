import { MapScale, spatial, compactGeometryBounds } from "@atlas/domain";
import type { GenerationState } from "./process";

/** World publication is independent of mesh density and viewport zoom. */
export function isWorldGeography(state: GenerationState) {
  return state.domain.world.areas[state.domain.scope.areaId].profile === "world";
}

/** Generation and publication judge dimensions in the same map-owned frame. */
export function mapScale(
  state: Pick<GenerationState, "surface" | "domain"> & Partial<Pick<GenerationState, "physical">>
): MapScale {
  return (
    state.physical?.map.scale ??
    MapScale.fromBounds(
      state.surface.bounds,
      state.surface.scope.resolution ??
        Math.sqrt(
          spatial.area(state.domain.scope.footprint) / Math.max(1, state.surface.active.length)
        )
    )
  );
}

export interface WorldExtent {
  area: number;
  span: number;
}
/** The extent a map's shares are taken of: the World's domain, or a finer map's own footprint. */
export function worldExtent(state: GenerationState): WorldExtent {
  const shape = isWorldGeography(state)
      ? state.domain.world.reference.domain
      : state.domain.scope.footprint,
    bounds = compactGeometryBounds(state.domain.world.reference, shape);
  return {
    area: spatial.area(shape),
    span: Math.hypot(bounds[2] - bounds[0], bounds[3] - bounds[1]),
  };
}
export interface GeographicJudgment {
  publish: boolean;
  reason: string;
}
const decision = (publish: boolean, reason: string): GeographicJudgment => ({ publish, reason });

/** Broad forest, grassland and barren provinces need more extent than a distinctive wetland. */
export const landscapeWorldShare = 0.0015;
/** A wetland complex's hydrological identity can warrant a smaller footprint. */
export const wetlandWorldShare = 0.0003;
/** A ribbon of local habitat is not a broad landscape, regardless of its total length. */
export const landscapeMinimumBreadth = MapScale.length(0.003);
/** The characteristic landscape must occupy a majority of its interpreted envelope. */
export const landscapeCoherence = 0.6;
/** A broad landscape needs either a distinct margin or sustained interior character. */
export const landscapeContrast = 0.15;
/** Absolute extent prevents a small world from promoting every local habitat. */
export const landscapeMinimumArea = MapScale.area(0.000125);
/** Interior character can establish a landscape with a gradual outer transition. */
export const landscapeStrongInterior = 0.75;
export interface LandscapeEvidence {
  area: number;
  breadth: number;
  coherence: number;
  contrast: number;
  strength: number;
}
export function landscapeSignificance(
  world: WorldExtent,
  kind: string,
  evidence: LandscapeEvidence,
  scale: MapScale
) {
  const share = kind === "wetland" ? wetlandWorldShare : landscapeWorldShare;
  const minimum = Math.max(scale.resolveMeasure(landscapeMinimumArea), world.area * share);
  if (evidence.area < minimum || evidence.breadth < scale.resolveMeasure(landscapeMinimumBreadth))
    return decision(false, "local extent or narrow habitat");
  if (evidence.coherence < landscapeCoherence)
    return decision(false, "dispersed patches without a coherent landscape");
  return decision(
    evidence.contrast >= landscapeContrast || evidence.strength >= landscapeStrongInterior,
    "sustained landscape with a distinct margin or strong interior character"
  );
}

/** Large-domain subdivision is independent of the minimum size of a named region. */
export const largeDomainLandShare = 0.2;
/** Continental span, not a small land-share ceiling, activates internal subdivision. */
export const largeDomainSpan = MapScale.length(0.225);
/** Absolute continental area also triggers subdivision on very large worlds. */
export const largeDomainArea = MapScale.area(0.075);
export function largeWorldDomain(area: number, span: number, land: number, scale: MapScale) {
  return (
    span >= scale.resolveMeasure(largeDomainSpan) &&
    (area >= land * largeDomainLandShare || area >= scale.resolveMeasure(largeDomainArea))
  );
}

/** A mapped river needs substantial water, drainage and a geographically meaningful course. */
export const worldRiverDischarge = MapScale.volume(5.46875e-18);
export const worldRiverCatchment = MapScale.area(0.00125);
export const worldRiverLength = MapScale.length(0.05);
/** A powerful shorter outlet can link a major lake or basin to the sea. */
export const worldOutletDischarge = MapScale.volume(2.34375e-17);
export interface RiverEvidence {
  discharge: number;
  catchment: number;
  length: number;
  outlet: boolean;
}
export function riverSignificance(e: RiverEvidence, scale: MapScale) {
  const substantial =
    e.discharge >= scale.resolveMeasure(worldRiverDischarge) &&
    e.catchment >= scale.resolveMeasure(worldRiverCatchment);
  return decision(
    substantial &&
      (e.length >= scale.resolveMeasure(worldRiverLength) ||
        (e.outlet && e.discharge >= scale.resolveMeasure(worldOutletDischarge))),
    "major water transport and drainage role"
  );
}

/** Which of a mapped river's tests a course fails: what a report says of a latent one. */
export function riverShortfalls(e: RiverEvidence, scale: MapScale) {
  const failed: string[] = [];
  if (e.discharge < scale.resolveMeasure(worldRiverDischarge)) failed.push("discharge");
  if (e.catchment < scale.resolveMeasure(worldRiverCatchment)) failed.push("catchment");
  const shortOutlet = !e.outlet || e.discharge < scale.resolveMeasure(worldOutletDischarge);
  if (e.length < scale.resolveMeasure(worldRiverLength) && shortOutlet) failed.push("length");
  return failed;
}

/** How far a peak's isolation is searched, at the World's scale. */
export const worldPeakIsolation = MapScale.length(0.015);
/** Falls require both a real drop and water; a dry cliff is not a waterfall. */
export const worldFallsDrop = MapScale.length(0.00001, 0.5);
export const worldFallsDischarge = MapScale.volume(3.90625e-18);
/**
 * Mountain systems have relief as well as a broad, connected physical footprint. Unlike a landscape
 * they may branch: a range and the spurs that join it are one system, however little of their
 * envelope they fill.
 */
export const worldRangeArea = MapScale.area(0.0005);
export const worldRangeBreadth = MapScale.length(0.00375);
export const worldRangeSpan = MapScale.length(0.025);
export const worldRangeRelief = MapScale.length(0.00015, 0.5);
export function rangeSignificance(
  e: LandscapeEvidence,
  relief: number,
  span: number,
  scale: MapScale
) {
  return decision(
    e.area >= scale.resolveMeasure(worldRangeArea) &&
      e.breadth >= scale.resolveMeasure(worldRangeBreadth) &&
      span >= scale.resolveMeasure(worldRangeSpan) &&
      relief >= scale.resolveMeasure(worldRangeRelief),
    "broad mountain system with substantial relief"
  );
}
/** Lakes remain physical water whether or not their identity belongs on the World map. */
export const worldExceptionalLakeArea = MapScale.area(0.00001875);
export const worldLakeDepth = MapScale.length(0.00005, 0.5);

/** Candidate seas already carry coastal-constriction and sill evidence from marineRegions. */
export const worldSeaArea = MapScale.area(0.0005);
export const worldOceanArea = MapScale.area(0.003125);
export const worldMarineBreadth = MapScale.length(0.0075);
export function marineSignificance(
  area: number,
  breadth: number,
  type: "sea" | "ocean",
  scale: MapScale
) {
  return decision(
    area >= scale.resolveMeasure(type === "sea" ? worldSeaArea : worldOceanArea) &&
      breadth >= scale.resolveMeasure(worldMarineBreadth),
    "substantial coastal basin or open ocean domain"
  );
}

export interface IndependenceEvidence {
  residents: number;
  capacity: number;
  years: number;
  connectedResidents: number;
  institution: boolean;
}
/** A computational community needs a viable political base to found a successor state. */
export const independentBaseResidents = 1_000;
export const independentBaseYears = 100;
export const independentRegionalResidents = 5_000;
export const independentInstitutionResidents = 2_000;
export function independenceSignificance(e: IndependenceEvidence) {
  const viable =
    e.residents >= independentBaseResidents &&
    e.capacity >= e.residents &&
    e.years >= independentBaseYears;
  return decision(
    viable &&
      (e.connectedResidents >= independentRegionalResidents ||
        (e.institution && e.residents >= independentInstitutionResidents)),
    "sustained independent authority with a viable population and institutional or regional base"
  );
}
