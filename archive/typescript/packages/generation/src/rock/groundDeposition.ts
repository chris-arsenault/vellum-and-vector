import type { PhysicalField } from "../world/field";
import type { FlowCause, Pool } from "../coupling/flows";
import type { MaterialLayer } from "./rockColumn";
import { facetShare, facetSurface } from "./groundShares";
import { deposit } from "./groundLedger";

/** Pond level in the supplied height units; a lower occupied facet fills before higher ground. */
export function pondLevel(
  land: number,
  landShare: number,
  cut: number,
  cutShare: number,
  meanDepth: number
) {
  if (landShare <= 0) return cut + meanDepth / cutShare;
  if (cutShare <= 0) return land + meanDepth / landShare;
  const lower = Math.min(land, cut),
    upper = Math.max(land, cut),
    lowerShare = land <= cut ? landShare : cutShare,
    room = (upper - lower) * lowerShare;
  return meanDepth <= room
    ? lower + meanDepth / lowerShare
    : upper + (meanDepth - room) / (landShare + cutShare);
}

/** Settling cargo fills local accommodation, leaving rejected material with its carrier. */
export function depositPond(
  map: PhysicalField,
  cell: number,
  requested: number,
  maximumSurface: number,
  cause: FlowCause,
  from: Pool,
  material: MaterialLayer
) {
  const level = Math.min(
    maximumSurface,
    pondLevel(
      facetSurface(map, cell, "land"),
      facetShare(map, cell, "land"),
      facetSurface(map, cell, "cut"),
      facetShare(map, cell, "cut"),
      Math.max(0, requested)
    )
  );
  let accepted = 0;
  for (const facet of ["land", "cut"] as const) {
    const depth =
      Math.max(0, level - facetSurface(map, cell, facet)) * facetShare(map, cell, facet);
    if (depth > 0) accepted += deposit(map, cell, depth, cause, from, material, facet);
  }
  return accepted;
}
