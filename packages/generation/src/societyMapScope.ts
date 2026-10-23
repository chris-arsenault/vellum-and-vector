import { population, type SocietyCommunity } from "@atlas/domain";
import type { GenerationState } from "./process";
import type { SettlementHierarchy } from "./societyHierarchy";

export function isWorldSociety(state: GenerationState) {
  return state.domain.world.areas[state.domain.scope.areaId].profile === "world";
}

/** Publication is a creation-profile decision, independent of viewport and numerical resolution. */
export function isMajorSettlement(c: SocietyCommunity, hierarchy: SettlementHierarchy) {
  if (!c.founded) return false;
  if (c.status !== "inhabited") return (c.settlement?.peak ?? 0) >= 5000;
  return (
    hierarchy.settlementRole === "capital" ||
    hierarchy.settlementRole === "regionalCapital" ||
    Math.min(population(c), c.settlement?.population ?? 0) >= 5000
  );
}
