// @needsResolution carry: a carried place may not resolve on a finer map (ADR 0009).
import { notApplicable, type PoiEntry } from "../poiContract";
import { namingCultureNear } from "../poiPlaces";
import { weighed } from "../poiVisibilityRules";
import { isFamily, landscapePlaces, landscapeRecord } from "./coverLandscape";
import {
  borders,
  countryFactors,
  coverCosts,
  coverWrites,
  developedCountry,
  meanOver,
  otherLandscapes,
  verdureAt,
} from "./coverShared";

/** Area at which a Well meadow is half as great as they get: 200 square kilometres. */
// length-unit: fraction
const typicalArea = 0.0000125;
const isA = isFamily("well");
const places = landscapePlaces("wellMeadow", "well", verdureAt);
const factors = countryFactors(places, typicalArea, verdureAt);

export const wellMeadow: PoiEntry = {
  id: "wellMeadow",
  group: "cover",
  name: "Well meadow",
  recognition: {
    distinct:
      "Land whose biome class is Well meadow: strong verdure in open ground with little canopy, the green around a spring. A Deepwood is the same verdure under trees, and a plain grassland has no verdure.",
    isA,
  },
  existence: {
    statement: "Emerges where Greenwood's verdure reaches ground that has not closed to forest.",
    way: "emerges",
    requires: notApplicable("Its class reads verdure and cover; nothing else precedes it."),
    suitability: notApplicable("Greenwood's reach sets it, and nothing chooses a site."),
    places,
  },
  publication: {
    statement:
      "Each region publishes as a Well meadow on the ecology layer, outlined by the biome class margin; a region of under three cells publishes nothing.",
    moment: "geography",
    record: landscapeRecord("well", "well", places),
  },
  fields: {
    statement:
      "Its green is verdure acting through the ecology on every greened cell; the meadow writes nothing of its own.",
    ...coverWrites,
  },
  acrossMaps: developedCountry(
    "Verdure and cover capture onto the child, whose ecology finds the meadow on finer ground. A captured meadow's name goes to the nearest within two parent cells, or goes.",
    isA
  ),
  movement: {
    statement: "Open going for roads, which pay nothing special to cross it.",
    ...coverCosts,
  },
  others: {
    statement:
      "It shares no ground with another landscape or with water, and lies around a Greenwood spring and beside a Deepwood.",
    needs: notApplicable("It reads a forcing directly, which more than one place may raise."),
    excludes: otherLandscapes("wellMeadow"),
    contains: notApplicable("A spring may stand in it but is no part of what it is."),
    pairsWith: borders("spring", "deepwood"),
  },
  people: {
    statement: "Sweet grazing and healing water; people come to it and settle beside it.",
    offers: (state, place) => ({
      food: meanOver(state, place, verdureAt),
      water: meanOver(state, place, verdureAt),
      sanctity: meanOver(state, place, verdureAt) / 2,
    }),
    threatens: notApplicable("It endangers no one."),
  },
  time: {
    statement:
      "It lasts while verdure holds, and returns to plain grassland when it falls away; left alone under strong verdure it may close to forest.",
    fate: (state, place) =>
      meanOver(state, place, verdureAt) < 0.3
        ? { fate: "becomes", kind: "grassland" }
        : { fate: "persists" },
  },
  visibility: {
    statement:
      "It weighs by its verdure over the country around and by its size; a town tied to it carries it.",
    ...factors,
    importance: weighed(factors, { magnitude: 0.3, localConditions: 0.5, isolation: 0.2 }),
  },
  naming: {
    statement: "Named by the people nearest.",
    namedBy: namingCultureNear,
    takesNameFrom: notApplicable("Its name comes from what it is, not from a place beside it."),
    lendsNameTo: notApplicable("A town beside it takes a name through its own naming."),
  },
};
