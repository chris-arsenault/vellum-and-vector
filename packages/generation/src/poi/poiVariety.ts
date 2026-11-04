import type { GenerationState } from "../process";
import type { PoiEntry, PoiPlace, PoiVariety } from "./poiContract";

/**
 * What each place was chosen to be. It outlives what a state keeps until its fields change: the
 * ground a place's own variety shapes must not choose its variety again.
 */
const chosen = new WeakMap<GenerationState, Map<string, string>>();

/** A place's variety, chosen the first time it is asked for and kept for the run. */
export function varietyOf(state: GenerationState, variety: PoiVariety, place: PoiPlace) {
  let kept = chosen.get(state);
  if (!kept) chosen.set(state, (kept = new Map()));
  let value = kept.get(place.id);
  if (value === undefined) kept.set(place.id, (value = variety.of(state, place)));
  return value;
}
/** A place's variety if its kind has them. */
export function varietyOfEntry(state: GenerationState, entry: PoiEntry, place: PoiPlace) {
  const variety = entry.variety;
  return variety && "of" in variety ? varietyOf(state, variety, place) : undefined;
}
