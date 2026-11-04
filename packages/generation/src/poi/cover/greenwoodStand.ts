import type { GenerationState } from "../../process";
import { notApplicable, type PoiEntry } from "../poiContract";
import { namingCultureNear, rulePlaces } from "../poiPlaces";
import { ruleRecord } from "../poiRecords";
import { fieldOf, magicRule } from "../poiReads";
import { weighed } from "../poiVisibilityRules";
import {
  canopyAt,
  countryFactors,
  coverCosts,
  coverWrites,
  developedCountry,
  fireAt,
  hazardReach,
  meanOver,
  sharesNoGround,
  spanOf,
  standsIn,
  verdureAt,
  withinOwn,
} from "./coverShared";

/** Area at which a stand is half as great as stands get: 500 square kilometres. */
const typicalArea = 5e8;
/** The mean ecological damage past which a stand's old growth is gone. */
const lostGrowth = 0.5;
const isA = magicRule("greenwood", "stand");
const places = rulePlaces("greenwoodStand", "greenwood", "stand");
const factors = countryFactors(places, typicalArea, verdureAt);
const damageAt = (state: GenerationState, cell: number) =>
  fieldOf(state).EcologicalDamage.get(cell);

export const greenwoodStand: PoiEntry = {
  id: "greenwoodStand",
  group: "cover",
  name: "Old stand",
  recognition: {
    distinct:
      "Land marked by Greenwood's stand rule, and nothing else: the rule is the definition. It is a Greenwood source at strength: old closed canopy, or deep peat, that has had time. Verdant country is what travels out from it, and the forest around it is a landscape it lies over.",
    isA,
  },
  existence: {
    statement:
      "Emerges where canopy grows old and closed, or peat grows deep, and Greenwood's roots have carried strength to it. Sap people or herds carried to a cell can start one.",
    way: "emerges",
    requires: notApplicable("Its requirement is its rule: a Greenwood source at strength on land."),
    suitability: notApplicable("Age and depth set it, and nothing chooses a site."),
    places,
  },
  publication: {
    statement:
      "Published as Greenwood's old stand on the magic layer, outlined by the rule's coverage.",
    moment: "magic",
    record: ruleRecord("greenwood", "stand"),
  },
  fields: {
    statement:
      "A stand feeds verdure outward and refills its own sap. Greenwood's source and feedback write both from canopy age and intensity over the whole field, so the stand writes none.",
    ...coverWrites,
    magic: notApplicable(
      "Greenwood's sources refill sap at every source cell, and magic's feedback writes verdure over the whole field by intensity."
    ),
  },
  acrossMaps: developedCountry(
    "Greenwood's bands and the canopy's age capture onto the child, whose rule finds the stand on finer ground. A captured stand's name goes to the nearest within two parent cells, or goes.",
    isA
  ),
  movement: {
    statement:
      "Roads pay for its trees as for any others, and Greenwood's roots start here and travel by the living cover of every cell; it adds no cost of its own.",
    ...coverCosts,
  },
  others: {
    statement:
      "It shares no ground with standing water or with wild ground, which verdure knits shut. It stands in forest and holds verdant country around it.",
    needs: notApplicable("Its rule reads Greenwood's own source, which needs no other place."),
    excludes: sharesNoGround("lake", "wildZone"),
    contains: standsIn("shrine", "spring"),
    pairsWith: [{ kind: "verdantGround", holds: withinOwn(spanOf) }],
  },
  people: {
    statement:
      "Sap people tap and carry, old timber few dare cut, and a holy place above all. Being canopy, it burns.",
    offers: (state, place) => ({
      materials: meanOver(state, place, canopyAt) / 2,
      food: meanOver(state, place, verdureAt) / 2,
      sanctity: 1,
    }),
    threatens: (state, place) => {
      const fire = meanOver(state, place, fireAt);
      return fire > 0
        ? [{ hazard: "wildfire", reach: hazardReach(state, place), severity: Math.min(1, fire) }]
        : [];
    },
  },
  time: {
    statement:
      "A stand lasts as long as its old growth. Fire, flood or cutting past what the epoch regrows ends it and leaves forest to start ageing again.",
    fate: (state, place) =>
      meanOver(state, place, damageAt) > lostGrowth
        ? { fate: "ends", leaves: "forest" }
        : { fate: "persists" },
  },
  visibility: {
    statement:
      "A stand is small, so it weighs by how far its verdure stands from the country around and by the people tied to it; a town named after it carries it.",
    ...factors,
    importance: weighed(factors, { magnitude: 0.25, localConditions: 0.5, isolation: 0.25 }),
  },
  naming: {
    statement: "Named by the people nearest, and towns that tap it may take the name.",
    namedBy: namingCultureNear,
    takesNameFrom: notApplicable("It is older than the people who name it."),
    lendsNameTo: [{ kind: "settlement", holds: withinOwn(spanOf) }],
  },
};
