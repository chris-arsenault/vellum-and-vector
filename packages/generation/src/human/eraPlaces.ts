import { ask } from "../coupling/answers";
import type { GenerationState } from "../process";
import type { PhysicalContext } from "../world/context";
import type { PhysicalField } from "../world/field";
import { leadingOf } from "./identityReads";
import { peoplePerBuiltKm2 } from "./passFacts";
import { denseZones, ruinSites } from "./placeClassifier";
import { recordCountry } from "./placeCountry";
import { knownPlaces, recordPlaces, recordRemains } from "./placeRegistry";
import { goingOn } from "./travel";

/** What recording an era's places needs to know of the map's settings. */
export interface EraPlaces {
  map: PhysicalField;
  context: PhysicalContext;
  era: string;
  years: number;
  /** The townsfolk that make a town on this map. */
  least: number;
  /** The townsfolk places are ranked against, where the map shows places smaller than towns. */
  town?: number;
  /** The travel distance over which a place is felt. */
  range: number;
  /** Travellers a year that make a road. */
  roadTravellers: number;
}
/**
 * The places an era leaves: the dense zones of the land as it now stands, matched to the
 * places already known, so a town keeps its name through the eras it lives in; the ruins of
 * what stands no longer; the tongue each new place is named in; and the country and ways
 * around the living places.
 */
export function recordEraPlaces(state: GenerationState, setting: EraPlaces) {
  const { map, context, era, least } = setting;
  // A place already known lasts while half a town's people remain.
  recordPlaces(
    state,
    denseZones(map, ask(map, "support", context), least / 2, ask(map, "presence", context)),
    era,
    least,
    setting.town ?? least
  );
  // Remains as large as a town's buildings, where no known place stands, are ruins too.
  recordRemains(state, ruinSites(map, least / peoplePerBuiltKm2), era);
  // A place is named in the tongue most of its people spoke when it was first seen.
  const tongues = leadingOf(map, "tongue");
  for (const place of knownPlaces(state))
    if (!place.tongue && !place.abandoned && tongues.code[place.anchor])
      place.tongue = tongues.code[place.anchor];
  recordCountry(state, {
    map,
    step: goingOn(map, context),
    range: setting.range,
    roadTravellers: setting.roadTravellers,
    years: setting.years,
  });
}
