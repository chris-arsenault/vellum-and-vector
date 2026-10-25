import { semanticId, type SocietyCommunity, type SocietyPolity } from "@atlas/domain";
import type { GenerationState } from "./process";
import { applySocietyEvent, unitRadius } from "./societyHazards";
import { isWorldSociety } from "./societyMapScope";

/** A town this large is worth a siege; a camp or a village changes hands without one. */
const besiegedTown = 100;
/** Magnitude of a siege when the polity fragmented, and when it collapsed outright. */
const siegeMagnitude = { fragmented: 0.6, collapsed: 0.9 } as const;
/** Radius of a located siege at a profile fine enough to hold one, metres. */
const siegeRadius = 5000;

/**
 * A polity that falls from active to fragmented or collapsed has lost its towns to someone:
 * each settled community it claimed and no longer controls is besieged, a located event with
 * the casualties, displacement, ruin and damaged works the hazard rules already give an
 * event. The dead it leaves are what Salt's death origin reads; the bible's battlefields and
 * sieges exist without a war simulation.
 */
export function besiegeLost(
  state: GenerationState,
  polity: SocietyPolity,
  previous: SocietyPolity["status"],
  era: string
) {
  if (previous !== "active" || polity.status === "active") return;
  const region = state.society!.region,
    control = region.politics!.control,
    magnitude = siegeMagnitude[polity.status];
  for (const c of region.communities) {
    if (!lostTown(c, polity, control)) continue;
    applySocietyEvent(state, {
      id: semanticId(state.domain.world.id, "society-event", `${era}:${polity.id}:${c.id}:siege`),
      era,
      kind: "siege",
      position: c.position,
      radius: isWorldSociety(state) ? unitRadius(c) : siegeRadius,
      magnitude,
      casualties: 0,
      displaced: 0,
      communities: [],
      causes: [`${era}: ${polity.id} lost its hold on ${c.name} and the town was besieged.`],
    });
  }
}
/** A settled town the polity claimed and no longer controls. */
function lostTown(c: SocietyCommunity, polity: SocietyPolity, control: Record<string, string>) {
  if (!polity.claims.includes(c.id) || control[c.id] === polity.id) return false;
  return c.status === "inhabited" && (c.settlement?.population ?? 0) >= besiegedTown;
}
