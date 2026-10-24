import { population, type SocietyCommunity } from "@atlas/domain";
import type { GenerationState } from "./process";
import type { SettlementHierarchy } from "./societyHierarchy";

export function isWorldSociety(state: GenerationState) {
  return state.domain.world.areas[state.domain.scope.areaId].profile === "world";
}

/** Concentrated residents that make a town, or the remains of one, a World feature. */
export const worldSettlementResidents = 5000;
/** The remains of a settlement are a World feature when the settlement once was one. */
export function isMajorRuin(c: Pick<SocietyCommunity, "founded" | "settlement">) {
  return Boolean(c.founded) && (c.settlement?.peak ?? 0) >= worldSettlementResidents;
}
/** Publication is a creation-profile decision, independent of viewport and numerical resolution. */
export function isMajorSettlement(c: SocietyCommunity, hierarchy: SettlementHierarchy) {
  if (!c.founded) return false;
  if (c.status !== "inhabited") return isMajorRuin(c);
  return (
    hierarchy.settlementRole === "capital" ||
    hierarchy.settlementRole === "regionalCapital" ||
    Math.min(population(c), c.settlement?.population ?? 0) >= worldSettlementResidents
  );
}
