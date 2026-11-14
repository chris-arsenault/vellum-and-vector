import type { GenerationState } from "../process";
import type { RegionalState } from "../regional/state";
import { poiCatalogue } from "./catalogue";
import type { PoiCostList, PoiLink, PoiMagicCarrier, PoiPlace } from "./poiContract";
import { fieldOf, heldFor } from "./poiReads";
import { carriedPlaces, placesOf } from "./poiPublish";

type Network = "roads" | "boats";

const multiply = (
  cost: Float64Array,
  state: GenerationState,
  list: PoiCostList,
  place: PoiPlace
) => {
  for (const { cell, factor } of list(state, place)) cost[cell] *= factor;
};
const unitCost = (state: GenerationState) => new Float64Array(fieldOf(state).mesh.count).fill(1);

/** A network's cost factor per cell over every place on this map; 1 where none changes it. */
export function networkFactors(state: GenerationState, network: Network): Float64Array {
  return heldFor(state, `cost:${network}`, () => {
    const cost = unitCost(state);
    for (const entry of Object.values(poiCatalogue)) {
      const list = entry.movement[network];
      if (typeof list !== "function") continue;
      for (const place of placesOf(state, entry)) multiply(cost, state, list as PoiCostList, place);
    }
    return cost;
  });
}

/**
 * The parent's places steer the drainage network as it grows on a refined map. They alone can:
 * the network is what the map's own places will be read from.
 */
export function drainageCosts(state: RegionalState, cost: Float64Array) {
  for (const { entry, place } of carriedPlaces(state)) {
    const list = entry.movement.drainage;
    if (typeof list === "function") multiply(cost, state, list as PoiCostList, place);
  }
}

/** One carrier's cost factor per cell, read once per evaluation cycle by magic's propagation. */
export function carrierFactors(state: GenerationState, carrier: PoiMagicCarrier): Float64Array {
  const cost = unitCost(state);
  for (const entry of Object.values(poiCatalogue)) {
    const magic = entry.movement.magic;
    if ("slot" in magic) continue;
    const list = magic[carrier];
    if (!list) continue;
    for (const place of placesOf(state, entry)) multiply(cost, state, list, place);
  }
  return cost;
}

/** Cells every place joins for walkers, each end leading to the other. */
export function placeLinks(state: GenerationState): Map<number, number> {
  return heldFor(state, "links", () => {
    const links = new Map<number, number>();
    for (const entry of Object.values(poiCatalogue)) {
      const list = entry.movement.links;
      if (typeof list !== "function") continue;
      for (const place of placesOf(state, entry))
        for (const { a, b } of (list as (s: GenerationState, p: PoiPlace) => readonly PoiLink[])(
          state,
          place
        )) {
          links.set(a, b);
          links.set(b, a);
        }
    }
    return links;
  });
}
