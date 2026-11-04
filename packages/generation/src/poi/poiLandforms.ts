import type { GenerationState } from "../process";
import { poiCatalogue } from "./catalogue";
import { placesOf } from "./poiPublish";
import { fieldOf, isLand, releaseHeld } from "./poiReads";

/** Every kind's landform mark on its places, so a place and its terrain code agree. */
export function markPoiLandforms(state: GenerationState) {
  releaseHeld(state);
  const codes = fieldOf(state).LandformCodes;
  for (const entry of Object.values(poiCatalogue)) {
    const mark = entry.recognition.landform;
    if (!mark || "slot" in mark) continue;
    for (const { anchor } of placesOf(state, entry))
      if (isLand(state, anchor) && !mark.yieldsTo?.includes(codes.get(anchor)))
        codes.set(anchor, mark.code);
  }
  releaseHeld(state);
}
