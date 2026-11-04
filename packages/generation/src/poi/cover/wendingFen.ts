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
  hazardReach,
  meanOver,
  otherLandscapes,
  verdureAt,
} from "./coverShared";

/** Area at which a Wending fen is half as great as they get: 500 square kilometres. */
const typicalArea = 5e8;
const isA = isFamily("wending");
const places = landscapePlaces("wendingFen", "wending", verdureAt);
const factors = countryFactors(places, typicalArea, verdureAt);

export const wendingFen: PoiEntry = {
  id: "wendingFen",
  group: "cover",
  name: "Wending fen",
  recognition: {
    distinct:
      "Land whose biome class is Wending fen: strong verdure over standing wetland, where a river braids through living ground. A plain wetland has the water without the verdure.",
    isA,
  },
  existence: {
    statement: "Emerges where Greenwood's verdure meets ground the water keeps wet.",
    way: "emerges",
    requires: notApplicable("Its class reads verdure and wetland; nothing else precedes it."),
    suitability: notApplicable("Greenwood's reach sets it, and nothing chooses a site."),
    places,
  },
  publication: {
    statement:
      "Each region publishes as a Wending fen on the ecology layer, outlined by the biome class margin; a region of under three cells publishes nothing.",
    moment: "geography",
    record: landscapeRecord("wending", "wending", places),
  },
  fields: {
    statement:
      "Its growth is verdure acting through the ecology on every greened cell; the fen writes nothing of its own.",
    ...coverWrites,
  },
  acrossMaps: developedCountry(
    "Verdure, water and cover capture onto the child, whose ecology finds the fen on finer ground. A captured fen's name goes to the nearest within two parent cells, or goes.",
    isA
  ),
  movement: {
    statement: "Roads pay for its wet ground as the path search charges all soaked ground.",
    ...coverCosts,
  },
  others: {
    statement: "It shares no ground with another landscape, and runs into wetlands and Deepwood.",
    needs: notApplicable("It reads a forcing directly, which more than one place may raise."),
    excludes: otherLandscapes("wendingFen"),
    contains: notApplicable("Nothing is known to stand only in a Wending fen."),
    pairsWith: borders("wetland", "deepwood"),
  },
  people: {
    statement:
      "Rich eating and sweet water for those who know its channels, and it swallows those who do not.",
    offers: (state, place) => ({
      food: meanOver(state, place, verdureAt),
      water: meanOver(state, place, verdureAt),
    }),
    threatens: (state, place) => [
      {
        hazard: "channels that shift",
        reach: hazardReach(state, place),
        severity: meanOver(state, place, verdureAt) / 3,
      },
    ],
  },
  time: {
    statement: "It lasts while verdure holds, and returns to plain wetland when it falls away.",
    fate: (state, place) =>
      meanOver(state, place, verdureAt) < 0.3
        ? { fate: "becomes", kind: "wetland" }
        : { fate: "persists" },
  },
  visibility: {
    statement: "It weighs by its verdure over the country around and by its size.",
    ...factors,
    importance: weighed(factors, { magnitude: 0.4, localConditions: 0.4, isolation: 0.2 }),
  },
  naming: {
    statement: "Named by the people nearest.",
    namedBy: namingCultureNear,
    takesNameFrom: notApplicable("Its name comes from what it is, not from a place beside it."),
    lendsNameTo: notApplicable("Towns keep to its edge and take their own names."),
  },
};
