// @needsResolution carry: a carried place may not resolve on a finer map (ADR 0009).
import type { GenerationState } from "../../process";
import { notApplicable, type PoiEntry } from "../poiContract";
import { namingCultureNear, rulePlaces } from "../poiPlaces";
import { ruleRecord } from "../poiRecords";
import { fieldOf, magicRule } from "../poiReads";
import { weighed } from "../poiVisibilityRules";
import {
  countryFactors,
  coverCosts,
  coverWrites,
  developedCountry,
  hazardReach,
  livingCoverAt,
  meanOver,
  sharesNoGround,
  spanOf,
  verdureAt,
  withinOwn,
} from "./coverShared";

/** Area at which verdant country is half as great as it gets: 20,000 square kilometres. */
// length-unit: fraction
const typicalArea = 0.00125;
const isA = magicRule("greenwood", "verdant");
const places = rulePlaces("verdantGround", "greenwood", "verdant");
const factors = countryFactors(places, typicalArea, verdureAt);
const saltedAt = (state: GenerationState, cell: number) => fieldOf(state).Salting.get(cell);

export const verdantGround: PoiEntry = {
  id: "verdantGround",
  group: "cover",
  name: "Verdant country",
  recognition: {
    distinct:
      "Land marked by Greenwood's verdant rule, and nothing else: the rule is the definition. It reads Greenwood's intensity and the verdure it has written, growing outward at lower strength. A stand is the source of it; forest or grassland on it are landscapes it lies over.",
    isA,
  },
  existence: {
    statement:
      "Emerges where Greenwood's roots carry strength out from a stand or spring through connected living cover and verdure takes hold.",
    way: "emerges",
    requires: notApplicable(
      "Its requirement is its rule: Greenwood's intensity and verdure on land."
    ),
    suitability: notApplicable("The roots' reach sets it, and nothing chooses a site."),
    places,
  },
  publication: {
    statement:
      "Published as Greenwood's verdant country on the magic layer, outlined by the rule's coverage.",
    moment: "magic",
    record: ruleRecord("greenwood", "verdant"),
  },
  fields: {
    statement:
      "Life here grows past what the climate allows, through verdure, which magic's feedback writes by intensity over the whole field and the ecology reads on every cell. The country writes none of it.",
    ...coverWrites,
  },
  acrossMaps: developedCountry(
    "Greenwood's bands capture onto the child, whose rule finds verdant country on finer ground. A captured name goes to the nearest within two parent cells, or goes.",
    isA
  ),
  movement: {
    statement:
      "Whatever grows on it charges roads as anywhere, and it is the ground Greenwood's roots travel best, by their own read of every cell's cover; it adds no cost of its own.",
    ...coverCosts,
  },
  others: {
    statement:
      "It shares no ground with standing water or a killing ground, which salt takes from it. It lies around an old stand or a Greenwood spring.",
    needs: notApplicable(
      "Its rule reads Greenwood's own field, which more than one source may raise."
    ),
    excludes: sharesNoGround("lake", "killingGround"),
    contains: notApplicable(
      "Nothing stands only on verdant country that it does not also carry elsewhere."
    ),
    pairsWith: [
      { kind: "greenwoodStand", holds: withinOwn(spanOf) },
      { kind: "spring", holds: withinOwn(spanOf) },
    ],
  },
  people: {
    statement:
      "Food beyond what the ground should give, with a kind of holiness to it. Left alone, growth closes fields and roads faster than people keep them open.",
    offers: (state, place) => ({
      food: Math.min(1, meanOver(state, place, livingCoverAt) + meanOver(state, place, verdureAt)),
      sanctity: meanOver(state, place, verdureAt) / 2,
    }),
    threatens: (state, place) => [
      {
        hazard: "overgrowth",
        reach: hazardReach(state, place),
        severity: meanOver(state, place, verdureAt) / 2,
      },
    ],
  },
  time: {
    statement:
      "It lasts while the roots feed it. Salt ends it; when the source goes, it fades as Greenwood's intensity falls and its rule no longer holds.",
    fate: (state, place) =>
      meanOver(state, place, saltedAt) > 0 ? { fate: "ends" } : { fate: "persists" },
  },
  visibility: {
    statement:
      "It weighs by its breadth and how far its verdure stands from the country around; a town on it carries it.",
    ...factors,
    importance: weighed(factors, { magnitude: 0.45, localConditions: 0.35, isolation: 0.2 }),
  },
  naming: {
    statement: "Named by the people nearest, and towns on it may take the name.",
    namedBy: namingCultureNear,
    takesNameFrom: notApplicable("Its name comes from what it is, not from a place beside it."),
    lendsNameTo: [{ kind: "settlement", holds: withinOwn(spanOf) }],
  },
};
