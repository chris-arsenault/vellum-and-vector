import type { GenerationState } from "../process";
import { poiCatalogue } from "./catalogue";
import { placesOf } from "./poiPublish";
import type { PoiEntry, PoiLandformMark } from "./poiContract";
import { fieldOf, isLand, releaseHeld } from "./poiReads";

const markOf = (entry: PoiEntry) => {
  const mark = entry.recognition.landform;
  return mark && !("slot" in mark) ? mark : null;
};
/** The kinds with a mark; those that yield come last, so what they yield to is already there. */
const marking = () =>
  Object.values(poiCatalogue)
    .filter(markOf)
    .sort((a, b) => Number(Boolean(markOf(a)?.yieldsTo)) - Number(Boolean(markOf(b)?.yieldsTo)));

/** Every kind's landform mark on its places, so a place and its terrain code agree. */
export function markPoiLandforms(state: GenerationState) {
  releaseHeld(state);
  const codes = fieldOf(state).LandformCodes;
  for (const entry of marking()) {
    const mark = entry.recognition.landform as PoiLandformMark;
    for (const { anchor } of placesOf(state, entry))
      if (isLand(state, anchor) && !mark.yieldsTo?.includes(codes.get(anchor)))
        codes.set(anchor, mark.code);
  }
  releaseHeld(state);
}
