// @needsResolution carry: a carried place may not resolve on a finer map (ADR 0009).
import type { GenerationState } from "../../process";
import { carryWhereItLands, costNear, counterpartOf, stays } from "../poiCarry";
import { notApplicable, type PoiEntry, type PoiFieldChange, type PoiPlace } from "../poiContract";
import { namingCultureNear, rulePlaces, settlementWithin, within } from "../poiPlaces";
import { ruleRecord } from "../poiRecords";
import { fieldOf, geothermalAt, magicRule, magicValue, metres, toNative } from "../poiReads";
import { aloneAmong, attachment, standsOut, weighed } from "../poiVisibilityRules";
import { areaOf, spans } from "./waterReads";

/** The depth a plume loses a third of its reach over, in metres. */
const plumeDepth = 300;
/** Below this depth, in metres, boats feel a vent's warmed water and gas. */
const shoalVent = 50;
/** Metres of sediment a vent's circulation leaves on its mound. */
const flushedSediment = 1;
/** Sea-surface warmth, in the band's native tenths of a degree, of a shallow vent. */
const warmedWater = 30;
/** Per-mille upwelling a shallow plume raises. */
const plumeLift = 500;
/** Carbon a vent's chemistry feeds, in the band's kilograms a square metre a year. */
const ventLife = 1;

const isA = magicRule("fire", "vent");
const heatAt = (state: GenerationState, cell: number) =>
  Math.max(geothermalAt(state, cell), magicValue(state, "fire", "intensity", cell) / 1000);
const places = rulePlaces("vent", "fire", "vent");
const depthOf = (state: GenerationState, place: PoiPlace) =>
  metres(fieldOf(state).WaterDepths.get(place.anchor));
/** How much of a vent's heat reaches the surface; nothing of a deep one does. */
const reachesSurface = (state: GenerationState, place: PoiPlace) =>
  Math.exp(-depthOf(state, place) / plumeDepth);
const heatOf = (state: GenerationState, place: PoiPlace) => heatAt(state, place.anchor);
const around = spans(10);
const counterpart = counterpartOf(isA, 1);
const factors = {
  magnitude: (state: GenerationState, place: PoiPlace) =>
    (heatOf(state, place) + areaOf(state, place) / (areaOf(state, place) + 1e8)) / 2,
  localConditions: standsOut(geothermalAt, around),
  isolation: aloneAmong(places, around),
  cultural: attachment(around),
};

/** Its circulation flushes the mound clear of the sediment settling everywhere else. */
const flushedMound = (_state: GenerationState, place: PoiPlace): readonly PoiFieldChange[] =>
  place.cells.map((cell) => ({
    change: "atMost",
    band: "SedimentThickness",
    cell,
    value: toNative(flushedSediment),
  }));
/**
 * A shallow vent's plume rises through the water, warming it and drawing up what lies below.
 * Nothing of a deep one arrives, so the surface keeps whatever the currents gave it.
 */
const plume = (state: GenerationState, place: PoiPlace): readonly PoiFieldChange[] => {
  const reach = reachesSurface(state, place),
    warmth = Math.round(warmedWater * reach),
    lift = Math.round(plumeLift * reach);
  if (warmth <= 0) return [];
  return place.cells.flatMap((cell): PoiFieldChange[] => [
    { change: "atLeast", band: "SeaSurfaceAnomaly", cell, value: warmth },
    { change: "atLeast", band: "Upwelling", cell, value: lift },
  ]);
};
/** Life on the vent feeds on its chemistry, in the dark, where nothing else grows. */
const ventFauna = (_state: GenerationState, place: PoiPlace): readonly PoiFieldChange[] =>
  place.cells.map((cell) => ({
    change: "atLeast",
    band: "AquaticProductivity",
    cell,
    value: ventLife,
  }));

export const vent: PoiEntry = {
  id: "vent",
  group: "water",
  name: "Hydrothermal vent",
  recognition: {
    distinct:
      "A cell in Fire's vent rule, as Fire itself grows it: Ocean water with Fire intensity or geothermal heat over the rule's seed. Being under the sea is what tells it from a hot spring, which is Fire's spring rule on land or lake; the heat on the sea floor tells it from an upwelling front, which is cold water raised by wind; and a thermal vein is the same conduit in the crust with no opening to water.",
    isA,
  },
  existence: {
    statement:
      "Emerges where Fire's conduit or the geothermal heat of a ridge or plume reaches the sea floor; Fire's own rule grows it and keeps it, and it needs nothing else above it.",
    way: "emerges",
    requires: notApplicable(
      "Fire's rule reads the water and heat itself; nothing else is required."
    ),
    suitability: notApplicable("Heat comes up where the crust lets it; nothing chooses."),
    places,
  },
  publication: {
    statement: "Every vent publishes as Fire's vent rule, the class the map's magic reads.",
    moment: "magic",
    record: ruleRecord("fire", "vent"),
  },
  fields: {
    statement:
      "A vent is a source of heat and minerals at the sea floor: it keeps its mound clear of sediment, warms and lifts the water when shallow, and feeds life by chemistry. Fire's heat there is already the magic's effect.",
    terrain: flushedMound,
    water: plume,
    climate: notApplicable(
      "Only the sea surface reaches the air, and the water field carries what little warmth arrives there."
    ),
    cover: ventFauna,
    magic: notApplicable(
      "Fire's source and heat are the rule's own reading, and a vent adds nothing to the stock beyond what its conduit holds."
    ),
  },
  acrossMaps: {
    statement:
      "A captured vent lands on the finer sea floor, where the parent's heat comes down with the shared media and the rule reads it again. Nobody can see one to dispute it, so with no counterpart it stays where it landed.",
    carry: carryWhereItLands,
    realize: notApplicable(
      "The regional shared media carry the parent's Geothermal across the map."
    ),
    counterpart,
    unrealized: stays,
    settle: notApplicable("A sea-floor vent has no relation to a round's water."),
    schedule: notApplicable("A vent has no step in refinement's schedule; Fire's rule reads it."),
  },
  movement: {
    statement:
      "Boats give a shallow vent's warm gassy water a wide berth and deep ones never notice it. Fire runs easily through its fractured conduit. Nothing on land or in the drainage reaches it.",
    roads: notApplicable("A vent is under the sea; ways do not enter it."),
    boats: (state, place) =>
      depthOf(state, place) < shoalVent ? costNear(2, spans(1))(state, place) : [],
    drainage: notApplicable("Rivers end at the shore; the sea floor is no part of the network."),
    magic: { crust: costNear(0.7) },
    links: notApplicable("A vent joins no two cells."),
    crosses: notApplicable("A vent is a point on the sea floor that no route crosses."),
  },
  others: {
    statement:
      "A vent lies under the sea, so it is never a hot spring. It lies along the same heat as a thermal vein or a volcano, and pairs with the upwelling its plume adds to.",
    needs: notApplicable("Its rule reads the sea it needs."),
    excludes: [
      { kind: "spring", holds: (_state, a, b) => a.cells.includes(b.anchor) },
      { kind: "lake", holds: (_state, a, b) => b.cells.includes(a.anchor) },
    ],
    contains: notApplicable("A vent field is one place and holds no other kind."),
    pairsWith: [
      { kind: "thermalVein", holds: within(around) },
      { kind: "volcano", holds: within(around) },
      { kind: "upwellingFront", holds: within(around) },
    ],
  },
  people: {
    statement:
      "A shallow vent gives fish and strange minerals to divers; a great one is a holy terror to those who see the sea boil above it. A deep one touches no one.",
    offers(state, place) {
      const reach = reachesSurface(state, place);
      return { food: reach * heatOf(state, place), materials: reach / 2, sanctity: reach / 2 };
    },
    threatens: (state, place) =>
      depthOf(state, place) < shoalVent
        ? [
            {
              hazard: "boiling water and gas",
              reach: spans(1)(state),
              severity: heatOf(state, place),
            },
          ]
        : [],
  },
  time: {
    statement:
      "A vent lasts as long as heat reaches its floor. When the conduit is sealed or the heat moves on it goes, leaving nothing a map carries; if the sea withdraws, it is a thermal vein under dry ground.",
    fate(state, place) {
      if (fieldOf(state).WaterKindCodes.get(place.anchor) !== 1)
        return { fate: "becomes", kind: "thermalVein" };
      return isA(state, place.anchor) ? { fate: "persists" } : { fate: "ends" };
    },
  },
  visibility: {
    statement:
      "A vent shows by its heat and its extent, and how sharply it stands from the cold sea floor; being out of sight it is rarely attached to people, so a capital's sailors are the only tie.",
    ...factors,
    importance: weighed(factors, { magnitude: 0.5, localConditions: 0.3, isolation: 0.2 }),
  },
  naming: {
    statement:
      "Most vents have no name; only one near people, whose water visibly boils, gets one from its sailors.",
    namedBy: (state, place) =>
      depthOf(state, place) < shoalVent && settlementWithin(state, place.anchor, 2 * around(state))
        ? namingCultureNear(state, place)
        : null,
    takesNameFrom: notApplicable("No nearby place gives a name to what lies under the sea."),
    lendsNameTo: notApplicable("Nothing takes the name of a thing out of sight."),
  },
};
