import { wardSeals } from "../../world/magicHallowed";
import type { GenerationState } from "../../process";
import type { PoiMagicCarrier, PoiCostList, PoiPlace } from "../poiContract";
import { fieldOf } from "../poiReads";
import { intensityOf, peakOf, weightedArea } from "./anomalyReads";

export const hallowedAt = intensityOf("hallowed");
export const peakWard = (state: GenerationState, place: PoiPlace) =>
  peakOf(state, place, hallowedAt) / 1000;
/** A place's ground area, in square metres. */
export const wardArea = (state: GenerationState, place: PoiPlace) =>
  weightedArea(state, place, () => 1);

/**
 * A carrier's cost through warded cells. The ward keeps out the same share of what is carried
 * as it scales away inside a ring (`applyWarding`), and seals the cell where it is strong.
 */
const barred: PoiCostList = (state, place) =>
  place.cells.flatMap((cell) => {
    const warding = fieldOf(state).Warding.get(cell);
    if (warding <= 0) return [];
    return [{ cell, factor: warding >= wardSeals ? Infinity : 1 / (1 - warding) }];
  });
/**
 * The carriers a ward bars. Not the crust: Fire's conduit reads Warding itself and does not
 * enter a sealed cell. Not the sea's current: a ward stands on land.
 */
export const wardedCarriers: Readonly<Partial<Record<PoiMagicCarrier, PoiCostList>>> = {
  river: barred,
  wind: barred,
  ice: barred,
};
