import type { GenerationState } from "../process";
import { poiCatalogue } from "./catalogue";
import type { PoiClaim, PoiEntry, PoiMoment, PoiOrigin, PoiPlace } from "./poiContract";
import type { PoiKindId } from "./poiKinds";
import { heldFor } from "./poiReads";

const reached: Record<PoiMoment, (state: GenerationState) => boolean> = {
  geography: () => true,
  magic: (state) => Boolean(state.physical?.magic),
  // A refined map starts with the society its parent captured.
  society: (state) => "regional" in state || Boolean(state.society),
};
/** Whether a kind's places exist yet on this map. */
function exists(state: GenerationState, kind: PoiKindId) {
  const moment = poiCatalogue[kind].publication.moment;
  return typeof moment === "string" && reached[moment](state);
}
/** A kind's declared origins, or none. */
export function originsOf(entry: PoiEntry): readonly PoiOrigin[] {
  const origins = entry.existence.origins;
  return origins && !("slot" in origins) ? origins : [];
}
/** Each origin in order, given what those before it claimed; an origin waits for what it reads. */
export function resolveClaims(state: GenerationState, origins: readonly PoiOrigin[]) {
  const claimed = new Map<number, PoiClaim>();
  for (const origin of origins) {
    if (!origin.reads.every((kind) => exists(state, kind))) continue;
    for (const found of origin.finds(state, claimed))
      if (!claimed.has(found.anchor)) claimed.set(found.anchor, { ...found, origin: origin.id });
  }
  return claimed;
}
/** What a kind's origins claim on this map, kept until the fields change. */
export const claimsOf = (
  state: GenerationState,
  kind: PoiKindId,
  origins: readonly PoiOrigin[]
): ReadonlyMap<number, PoiClaim> =>
  heldFor(state, `origins:${kind}`, () =>
    state.physical ? resolveClaims(state, origins) : new Map<number, PoiClaim>()
  );
/** A kind's places, as its origins claim them. */
export const placesFromOrigins =
  (kind: PoiKindId, origins: readonly PoiOrigin[]) =>
  (state: GenerationState): readonly PoiPlace[] =>
    [...claimsOf(state, kind, origins).values()].map((claim) => ({
      id: `${kind}:${claim.anchor}`,
      kind,
      cells: claim.cells ?? [claim.anchor],
      anchor: claim.anchor,
      origin: claim.origin,
    }));
