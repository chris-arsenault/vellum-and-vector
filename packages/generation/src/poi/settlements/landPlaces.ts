import type { AtlasFeature } from "@atlas/domain";
import { atlasName, nameMetadata } from "../../atlasNaming";
import { placeLand } from "../../human/placeFacts";
import { placePeoples } from "../../human/placePeoples";
import { knownPlaces, rankedSize, type KnownPlace } from "../../human/placeRegistry";
import { knownTraditions, traditionOf } from "../../human/traditions";
import { humanLayersOf } from "../../human/humanLayers";
import { leading } from "../../human/identityReads";
import { generatedFeature, generatedId } from "../../mapFeatures";
import type { GenerationState } from "../../process";
import { regionalFeature, regionalId } from "../../regional/extraction/features";
import type { RegionalState } from "../../regional/state";
import type { PoiPlace } from "../poiContract";
import { fieldOf } from "../poiReads";

/**
 * Settlements and ruins of a map that lived its own people: the places read from the land's
 * layers and kept by name through the eras. A living place is a settlement and an emptied one
 * the ruin of the same place. Each record states the land the place stands on.
 */
/** Townsfolk above which a place is a market for the country around it. */
const marketPeople = 4;

/** A place's rank among the living places of its map, by its townsfolk. */
function roleOf(place: KnownPlace, least: number) {
  return place.townPeople >= marketPeople * least ? "marketTown" : "settlement";
}
/** A place's standing among realms: its role, and the realm most of its people hold. */
function standing(state: GenerationState, place: KnownPlace, least: number) {
  const seatOf = knownTraditions(state).find((tradition) => tradition.seat === place.id),
    [allegiance] = leading(humanLayersOf(fieldOf(state)).column(place.anchor), "allegiance"),
    // A seat is its own realm's capital, whoever most of its people now hold with.
    realm = seatOf ?? traditionOf(state, allegiance),
    role = place.abandoned ? "settlement" : seatOf ? "capital" : roleOf(place, least);
  return { settlementRole: role, ...(realm ? { polityId: realm.entity } : {}) };
}
const refined = (state: GenerationState): state is RegionalState => "regional" in state;
/** The identity a place's own record has on this map. */
const recordId = (state: GenerationState, key: string) =>
  refined(state) ? regionalId(state, key) : generatedId(state, key);
/** The record a known place has on this map: the one it inherited, or the map's own. */
export const placeRecordId = (state: GenerationState, place: KnownPlace) =>
  place.adopted ?? recordId(state, place.id);
/** A settlement record of this map's own making: a refined map's are its products. */
function written(
  state: GenerationState,
  key: string,
  name: string,
  layer: string,
  geometry: AtlasFeature["geometry"],
  attributes: Record<string, unknown>
) {
  return refined(state)
    ? regionalFeature(state, key, "settlement", layer, geometry, attributes, name)
    : generatedFeature(state, key, name, "settlement", layer, geometry, attributes);
}
function record(state: GenerationState, place: KnownPlace, least: number): AtlasFeature {
  const land = placeLand(fieldOf(state), place),
    living = !place.abandoned,
    named = atlasName(state.domain.world, {
      key: place.id,
      kind: "settlement",
      position: land,
      // Its founders' tongue names it, and the name stays whoever lives there later.
      language: place.tongue ? traditionOf(state, place.tongue)?.entity : undefined,
      era: place.founded,
    }),
    townsfolk = Math.round(place.townPeople);
  const feature = written(
    state,
    place.id,
    named.name,
    living ? "settlements" : "ruins",
    { type: "Point", coordinates: [land.x, land.y] },
    {
      ...nameMetadata(named),
      placeKey: place.id,
      status: living ? "inhabited" : "abandoned",
      founded: place.founded,
      ...(place.abandoned ? { abandoned: place.abandoned } : {}),
      population: townsfolk,
      settlementPopulation: townsfolk,
      communityPopulation: Math.round(place.people),
      ruralPopulation: Math.round(Math.max(0, place.people - place.townPeople)),
      peakPopulation: Math.round(place.peak),
      // Its townsfolk and everyone on its ground at the end of each era it has stood through.
      history: place.history,
      ...standing(state, place, least),
      // Who lives here: the share of its people holding each tongue, faith, custom and realm.
      peoples: living ? placePeoples(state, fieldOf(state), place) : undefined,
      representedAreaKm2: land.zoneKm2,
      ...country(place),
      builtKm2: place.builtKm2,
      farmedKm2: land.farmedKm2,
      grazedKm2: land.grazedKm2,
      elevationMetres: Math.round(land.metres),
      riverOrder: land.river,
      coastal: land.coastal,
      siteKind: land.siteKind,
      siteReason: land.siteReason,
      fortress: false,
    }
  );
  feature.causes = [story(place, land.siteReason)];
  return feature;
}
/** The country that reaches the place most cheaply and feeds it. */
function country({ hinterland }: KnownPlace) {
  const whole = (value = 0) => Math.round(value);
  return {
    hinterlandKm2: whole(hinterland?.km2),
    hinterlandPeople: whole(hinterland?.people),
    hinterlandFarmedKm2: whole(hinterland?.farmedKm2),
    hinterlandGrazedKm2: whole(hinterland?.grazedKm2),
  };
}
/** Why the place is there, and what became of it. */
function story(place: KnownPlace, siteReason: string) {
  const gathered = `${place.founded}: people gathered here ${siteReason}`;
  return place.abandoned
    ? `${gathered}. ${place.abandoned}: the place could no longer feed a town, and its ${Math.round(place.peak)} townsfolk at its height are gone.`
    : `${gathered}; ${Math.round(place.townPeople)} now live here beyond what the place's own land feeds.`;
}
/** The living places of a map as settlements, or its emptied places as ruins. */
export function landPlaces(state: GenerationState, kind: "settlement" | "ruin"): PoiPlace[] {
  if (!state.physical) return [];
  const least = rankedSize(state);
  return (
    knownPlaces(state)
      // A place another grew over is part of that place and has no record of its own; a
      // place the map inherited already has its record.
      .filter(
        (place) =>
          !place.absorbedBy && !place.adopted && (kind === "ruin") === Boolean(place.abandoned)
      )
      .map((place) => {
        let built: AtlasFeature | undefined;
        return {
          id: recordId(state, place.id),
          kind,
          anchor: place.anchor,
          cells: place.cells.length ? place.cells : [place.anchor],
          get feature() {
            return (built ??= record(state, place, least));
          },
        };
      })
  );
}
