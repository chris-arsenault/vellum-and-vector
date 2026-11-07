// @needsResolution carry: a carried place may not resolve on a finer map (ADR 0009).
import { craterRelief } from "../../world/geologicalFeatures";
import type { GenerationState } from "../../process";
import { rimCost } from "../../regional/causes/landmark";
import { carryWhereItLands, costNear, stays } from "../poiCarry";
import { notApplicable, type PoiEntry, type PoiFate, type PoiPlace } from "../poiContract";
import { holds, namingCultureNear, rulePlaces, within } from "../poiPlaces";
import { ruleRecord } from "../poiRecords";
import { fieldOf, magicRule, magicValue, metres } from "../poiReads";
import { aloneAmong, attachment, sized, standsOut, weighed } from "../poiVisibilityRules";
import { eventOf, eventPlaces, eventRecord, onPlaces } from "./reliefEvents";
import {
  areaOf,
  loweredAsCaptured,
  meanOf,
  nearestOrFloor,
  reliefOf,
  sameSpot,
  sitingAdmits,
  sitingSuits,
  spans,
} from "./reliefShape";

/** Relief and area at which a crater is half as great as craters get: a world crater's. */
const typicalRelief = 150,
  typicalArea = 700_000_000;
const craterLake = magicRule("fire", "crater");
const lakePlaces = rulePlaces("crater", "fire", "crater");
const pits = eventPlaces(
  "crater",
  (state, event) =>
    event.kind === "impact" &&
    craterRelief(state, event) >= state.physical!.profile.ImpactVisibleRelief,
  (event) => event.radius
);
const onPit = onPlaces("crater", pits);
const isA = (state: GenerationState, cell: number) => onPit(state, cell) || craterLake(state, cell);
const places = (state: GenerationState) => [...pits(state), ...lakePlaces(state)];
const excavationAt = (state: GenerationState, cell: number) =>
  metres(fieldOf(state).ImpactExcavation.get(cell));
const pitRecord = eventRecord({
  kind: "crater",
  name: (event) => `Impact crater ${event.id.split(":").at(-1)}`,
  attributes: (state, event) => ({ relief: craterRelief(state, event) }),
});
const lakeRecord = ruleRecord("fire", "crater");
const counterpart = nearestOrFloor(isA);
const fallenSource = (state: GenerationState, place: PoiPlace) =>
  magicValue(state, "fire", "source", place.anchor) / 1000;
const factors = {
  magnitude: meanOf(sized(reliefOf, typicalRelief), sized(areaOf, typicalArea)),
  localConditions: standsOut(excavationAt, spans(6)),
  isolation: aloneAmong(places, spans(12)),
  cultural: attachment(spans(8)),
};

export const crater: PoiEntry = {
  id: "crater",
  group: "relief",
  name: "Crater",
  recognition: {
    distinct:
      "A cell within the radius of an impact the generator recorded, while the rim still stands the generator's visible relief above its floor and plain, or a cell of Fire's crater-lake rule. Only a falling body is recorded so, and a caldera is a recorded collapse. Ejecta lies outside the rim and is its own kind. Fire's crater lake is the same pit with water and metal in it, a place of its own on the magic layer.",
    isA,
  },
  existence: {
    statement:
      "Both: falling bodies strike at epochs the generator chooses for any ground, and an impact-ring record emplaces one of a chosen size and maintains its rim and floor, publishing as that record. Water, sediment and uplift then work on what was left.",
    way: "both",
    requires: sitingAdmits("impact-ring"),
    suitability: sitingSuits("impact-ring"),
    places,
  },
  publication: {
    statement:
      "A recorded impact publishes as the disk of its pit, with the relief that survives; Fire's crater lake publishes as that rule's class.",
    moment: "magic",
    record: (state, place) =>
      eventOf(state, place) ? pitRecord(state, place) : lakeRecord(state, place),
  },
  fields: {
    statement:
      "A crater is a pit with a raised rim in shocked, fractured rock, a closed basin that holds water, and a store of fallen metal Fire reads as a finite source. Its heat fades after the fall, with a burning epoch at first.",
    terrain: notApplicable("The impact itself excavates, raises the rim and hardens the rock."),
    water: notApplicable("Lake filling reads the closed pit like any other depression."),
    climate: notApplicable(
      "A fall's darkened years have no band; the map sees the pit, not the winter after it."
    ),
    cover: notApplicable(
      "The fan around it is barren by its own entry; life returns to the pit through ecology."
    ),
    magic: notApplicable("The impact's shock writes its fractures and its heat."),
  },
  acrossMaps: {
    statement:
      "A captured crater is realized as a floor no higher than the parent's, with dear ground the network runs around. An impact-ring record is re-placed and maintained by its own cause; maps below the world record no impacts, so an emergent crater's counterpart is the lowest ground near it, and the record stays.",
    carry: carryWhereItLands,
    realize: (state, carried) => loweredAsCaptured(state, carried, counterpart(state, carried)),
    counterpart,
    unrealized: stays,
    settle: notApplicable("A round's water may fill its lake without moving the pit."),
    schedule: notApplicable("An impact-ring record has its landmark cause; a pit needs no step."),
  },
  movement: {
    statement:
      "A rim is a ring of dear ground that turns water and roads around it; the fractured rock beneath conducts Fire and anything else the crust carries.",
    roads: notApplicable("The ruling-grade cost already reads its rim."),
    boats: notApplicable("A crater lake is closed; it joins no network boats travel."),
    drainage: (state, place) => costNear(rimCost)(state, place),
    magic: notApplicable("Crust-borne magic spreads by the fracture conductance the shock opened."),
    links: notApplicable("A crater joins nothing."),
    crosses: notApplicable("A ring bars routes; it takes none across anything."),
  },
  others: {
    statement:
      "A crater has its ejecta around it, a lake and a compass deviation in it, and placers in the gravels below; it is never on the spot of a volcano's caldera or a dome.",
    needs: notApplicable("A falling body needs no ground prepared."),
    excludes: [
      { kind: "caldera", holds: sameSpot },
      { kind: "dome", holds: sameSpot },
    ],
    contains: [
      { kind: "lake", holds },
      { kind: "compassDeviation", holds },
    ],
    pairsWith: [
      { kind: "ejectaFan", holds: within(spans(8)) },
      { kind: "placer", holds: within(spans(10)) },
      { kind: "killingGround", holds: within(spans(4)) },
    ],
  },
  people: {
    statement:
      "A crater holds fallen metal people dig for, in proportion to what still releases Fire, and it is a marked place for those who remember the fall. While its heat lasts the floor is a burning field.",
    offers: (state, place) => ({
      materials: fallenSource(state, place),
      sanctity: factors.magnitude(state, place) / 2,
    }),
    threatens: (state, place) =>
      fieldOf(state).ImpactHeat.get(place.anchor) > 0
        ? [
            {
              hazard: "burning ground",
              reach: spans(2)(state),
              severity: fieldOf(state).ImpactHeat.get(place.anchor) / 1000,
            },
          ]
        : [],
  },
  time: {
    statement:
      "A crater is at its sharpest the epoch it falls; rims wear, floors fill, lakes come and go, and the rock stays hard. When it no longer reads as a pit, only its fan and gravels remain.",
    fate(state, place): PoiFate {
      return isA(state, place.anchor)
        ? { fate: "persists" }
        : { fate: "ends", leaves: "ejectaFan" };
    },
  },
  visibility: {
    statement:
      "A crater shows while its form survives, by surviving relief and width; a young sharp pit in plains shows long before a worn one in hills, and a town on its rim carries it.",
    ...factors,
    importance: weighed(factors, { magnitude: 0.6, localConditions: 0.3, isolation: 0.1 }),
  },
  naming: {
    statement: "Named by those who live near it, often for the fall itself where it is remembered.",
    namedBy: namingCultureNear,
    takesNameFrom: notApplicable("A crater is older than anything nearby that could lend a name."),
    lendsNameTo: [
      { kind: "lake", holds },
      { kind: "ejectaFan", holds: within(spans(8)) },
    ],
  },
};
