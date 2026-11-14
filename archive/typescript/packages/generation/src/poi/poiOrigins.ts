import { placesRecorded } from "../human/placeRegistry";
import type { GenerationState } from "../process";
import { poiCatalogue } from "./catalogue";
import type { PoiClaim, PoiEntry, PoiMoment, PoiOrigin, PoiPlace } from "./poiContract";
import type { PoiKindId } from "./poiKinds";
import { gap, heldFor } from "./poiReads";

/** Whether a cell stands at least `apart` metres from every cell taken. */
export function standsClear(
  state: GenerationState,
  taken: Iterable<number>,
  cell: number,
  apart: number
) {
  for (const other of taken) if (gap(state, cell, other) < apart) return false;
  return true;
}
/** Those candidates that pass, in order, each standing clear of everything claimed before it. */
export function spacedAmong(
  state: GenerationState,
  claimed: ReadonlyMap<number, PoiClaim>,
  candidates: readonly number[],
  apart: number,
  passes: (cell: number) => boolean
) {
  const taken = new Set(claimed.keys());
  for (const cell of candidates)
    if (passes(cell) && standsClear(state, taken, cell, apart)) taken.add(cell);
  return [...taken].filter((cell) => !claimed.has(cell)).map((anchor) => ({ anchor }));
}

const reached: Record<PoiMoment, (state: GenerationState) => boolean> = {
  geography: () => true,
  magic: (state) => Boolean(state.physical?.magic),
  // A refined map starts with the places its parent left; a map that lived its own people
  // has them once an era's places have been recorded.
  society: (state) => "regional" in state || placesRecorded(state),
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
      hostedBy: claim.hostedBy,
    }));
