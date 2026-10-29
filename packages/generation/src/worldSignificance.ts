import { spatial } from "@atlas/domain";
import type { GenerationState } from "./process";

/** World publication is independent of mesh density and viewport zoom. */
export function isWorldGeography(state: GenerationState) {
  return state.domain.world.areas[state.domain.scope.areaId].profile === "world";
}

export interface WorldExtent {
  area: number;
  span: number;
}
export function worldExtent(state: GenerationState): WorldExtent {
  const bounds = spatial.bounds(state.domain.world.reference.domain);
  return {
    area: spatial.area(state.domain.world.reference.domain),
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
export const landscapeMinimumBreadth = 12_000;
/** The characteristic landscape must occupy a majority of its interpreted envelope. */
export const landscapeCoherence = 0.6;
/** A broad landscape needs either a distinct margin or sustained interior character. */
export const landscapeContrast = 0.15;
/** Absolute extent prevents a small world from promoting every local habitat. */
export const landscapeMinimumArea = 2_000_000_000;
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
  evidence: LandscapeEvidence
) {
  const share = kind === "wetland" ? wetlandWorldShare : landscapeWorldShare;
  const minimum = Math.max(landscapeMinimumArea, world.area * share);
  if (evidence.area < minimum || evidence.breadth < landscapeMinimumBreadth)
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
export const largeDomainSpan = 900_000;
/** Absolute continental area also triggers subdivision on very large worlds. */
export const largeDomainArea = 1.2e12;
export function largeWorldDomain(area: number, span: number, land: number) {
  return (
    span >= largeDomainSpan && (area >= land * largeDomainLandShare || area >= largeDomainArea)
  );
}

/** A mapped river needs substantial water, drainage and a geographically meaningful course. */
export const worldRiverDischarge = 350;
export const worldRiverCatchment = 20_000_000_000;
export const worldRiverLength = 200_000;
/** A powerful shorter outlet can link a major lake or basin to the sea. */
export const worldOutletDischarge = 1_500;
export interface RiverEvidence {
  discharge: number;
  catchment: number;
  length: number;
  outlet: boolean;
}
export function riverSignificance(e: RiverEvidence) {
  const substantial = e.discharge >= worldRiverDischarge && e.catchment >= worldRiverCatchment;
  return decision(
    substantial &&
      (e.length >= worldRiverLength || (e.outlet && e.discharge >= worldOutletDischarge)),
    "major water transport and drainage role"
  );
}

/** Prominence measures separation from surrounding relief, not elevation alone. */
export const worldPeakProminence = 1_000;
/** Isolation allows a smaller but distinctive solitary mountain to matter globally. */
export const worldPeakIsolation = 60_000;
/** Extreme prominence stands out even within an extensive mountain system. */
export const worldPeakExtremeProminence = 1_800;
export function summitSignificance(prominence: number, isolation: number) {
  return decision(
    prominence >= worldPeakExtremeProminence ||
      (prominence >= worldPeakProminence && isolation >= worldPeakIsolation),
    "exceptional prominence or isolated mountain"
  );
}
/** Falls require both a real drop and water; a dry cliff is not a waterfall. */
export const worldFallsDrop = 40;
export const worldFallsDischarge = 250;
/** A very high cascade can qualify at a lower, still substantial, discharge. */
export const worldFallsExtremeDrop = 200;
export const worldFallsCascadeDischarge = 40;
export function fallsSignificance(drop: number, discharge: number) {
  return decision(
    (drop >= worldFallsDrop && discharge >= worldFallsDischarge) ||
      (drop >= worldFallsExtremeDrop && discharge >= worldFallsCascadeDischarge),
    "exceptional channel drop with sustained flow"
  );
}
/** Mountain systems have relief as well as a broad, connected physical footprint. */
export const worldRangeArea = 8_000_000_000;
export const worldRangeBreadth = 15_000;
export const worldRangeSpan = 100_000;
export const worldRangeRelief = 600;
export function rangeSignificance(e: LandscapeEvidence, relief: number, span: number) {
  return decision(
    e.area >= worldRangeArea &&
      e.breadth >= worldRangeBreadth &&
      span >= worldRangeSpan &&
      relief >= worldRangeRelief &&
      e.coherence >= landscapeCoherence,
    "broad mountain system with substantial relief"
  );
}
/** Lakes remain physical water whether or not their identity belongs on the World map. */
export const worldLakeArea = 2_000_000_000;
export const worldExceptionalLakeArea = 300_000_000;
export const worldLakeDepth = 200;
export function lakeSignificance(area: number, depth: number, throughflow: number) {
  return decision(
    area >= worldLakeArea ||
      (area >= worldExceptionalLakeArea &&
        (depth >= worldLakeDepth || throughflow >= worldOutletDischarge)),
    "major waterbody or exceptional deep or through-flowing lake"
  );
}

/** Candidate seas already carry coastal-constriction and sill evidence from marineRegions. */
export const worldSeaArea = 8e9;
export const worldOceanArea = 50e9;
export const worldMarineBreadth = 30_000;
export function marineSignificance(area: number, breadth: number, type: "sea" | "ocean") {
  return decision(
    area >= (type === "sea" ? worldSeaArea : worldOceanArea) && breadth >= worldMarineBreadth,
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
