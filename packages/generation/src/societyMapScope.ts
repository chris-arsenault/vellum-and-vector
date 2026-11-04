import { population, type SocietyCommunity, type SocietyRegion } from "@atlas/domain";
import type { GenerationState } from "./process";
import { settlementHierarchy, type SettlementHierarchy } from "./societyHierarchy";
import { defaultSocietyProfile, profileOf } from "./societyProfile";

export function isWorldSociety(state: GenerationState) {
  return state.domain.world.areas[state.domain.scope.areaId].profile === "world";
}

/** Concentrated residents that make a town, or the remains of one, a World feature. */
export const worldSettlementResidents = defaultSocietyProfile.townThreshold;
/** The remains of a settlement are a World feature when the settlement once was one. */
export function isMajorRuin(
  c: Pick<SocietyCommunity, "founded" | "settlement">,
  threshold = worldSettlementResidents
) {
  return Boolean(c.founded) && (c.settlement?.peak ?? 0) >= threshold;
}
/** Publication is a creation-profile decision, independent of viewport and numerical resolution. */
export function isMajorSettlement(
  c: SocietyCommunity,
  hierarchy: SettlementHierarchy,
  threshold = worldSettlementResidents
) {
  if (!c.founded) return false;
  if (c.status !== "inhabited") return isMajorRuin(c, threshold);
  return (
    hierarchy.settlementRole === "capital" ||
    hierarchy.settlementRole === "regionalCapital" ||
    Math.min(population(c), c.settlement?.population ?? 0) >= threshold
  );
}
/** The communities this map shows, and the hierarchy that chose them. */
export function mappedSociety(state: GenerationState, region: SocietyRegion) {
  const hierarchy = settlementHierarchy(region),
    threshold = profileOf(state).townThreshold;
  const mapped = new Set(
    region.communities
      .filter(
        (c) => !isWorldSociety(state) || isMajorSettlement(c, hierarchy.get(c.id)!, threshold)
      )
      .map((c) => c.id)
  );
  return { hierarchy, mapped };
}
