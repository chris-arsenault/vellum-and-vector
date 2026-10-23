import { population, type SocietyCommunity } from "@atlas/domain";
import type { GenerationState } from "./process";

/** Authored traits belong to peoples, independently of culture, language or polity. */
export function peopleTrait(
  state: GenerationState,
  c: SocietyCommunity,
  key: string,
  fallback: number
) {
  const total = population(c);
  if (!total) return fallback;
  return (
    c.groups.reduce((sum, g) => {
      const value = Number(state.domain.world.entities[g.people]?.attributes[key] ?? fallback);
      return sum + g.count * (Number.isFinite(value) && value >= 0 ? value : fallback);
    }, 0) / total
  );
}
