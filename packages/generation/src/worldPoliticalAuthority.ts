import { population, type SocietyCommunity, type SocietyPolity } from "@atlas/domain";
import type { GenerationState } from "./process";
import { communityReach } from "./societyContact";
import { generationFeatures } from "./generationFeatures";
import { independenceSignificance } from "./worldSignificance";

/** An independent regional base must remain in practical contact with its proposed seat. */
const independentBaseReach = 250_000;

export function independentPoliticalBase(
  state: GenerationState,
  parent: SocietyPolity,
  years: number
) {
  const region = state.society!.region,
    politics = region.politics!,
    heldSeats = new Set(politics.polities.map((p) => p.seat));
  const candidates = region.communities.filter(
    (c) =>
      politics.sovereignty[c.id] === parent.id &&
      !politics.control[c.id] &&
      c.status === "inhabited" &&
      !heldSeats.has(c.id)
  );
  candidates.sort((a, b) => population(b) - population(a) || a.id.localeCompare(b.id));
  for (const seat of candidates) {
    const distances = communityReach(region, region.communities.indexOf(seat)),
      base = candidates.filter(
        (c) => distances[region.communities.indexOf(c)] <= independentBaseReach
      ),
      judgment = independenceSignificance({
        residents: population(seat),
        capacity: seat.support.capacity,
        years,
        connectedResidents: base.reduce(
          (sum, c) => sum + Math.min(population(c), c.support.capacity),
          0
        ),
        institution: institutionAt(state, seat),
      });
    if (judgment.publish) return base;
  }
  return [];
}
function institutionAt(state: GenerationState, seat: SocietyCommunity) {
  for (const feature of generationFeatures(state, { kind: "institution" }))
    if (feature.attributes.communityId === seat.id) return true;
  return false;
}
