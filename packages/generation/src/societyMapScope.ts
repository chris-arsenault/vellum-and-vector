import { population, type SocietyCommunity } from "@atlas/domain";
import type { GenerationState } from "./process";
import type { SettlementHierarchy } from "./societyHierarchy";
import { defaultSocietyProfile } from "./societyProfile";

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
