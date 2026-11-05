// @needsResolution carry: a carried place may not resolve on a finer map (ADR 0009).
import { notApplicable, type PoiEntry } from "../poiContract";
import { namingCultureNear } from "../poiPlaces";
import { weighed } from "../poiVisibilityRules";
import { isFamily, landscapePlaces, landscapeRecord } from "./coverLandscape";
import {
  borders,
  canopyAt,
  countryFactors,
  coverCosts,
  coverWrites,
  developedCountry,
  hazardReach,
  meanOver,
  otherLandscapes,
  verdureAt,
} from "./coverShared";

/** Area at which a Deepwood is half as great as they get: 2,000 square kilometres. */
const typicalArea = 2e9;
const isA = isFamily("deepwood");
const places = landscapePlaces("deepwood", "deepwood", verdureAt);
const factors = countryFactors(places, typicalArea, verdureAt);

export const deepwood: PoiEntry = {
  id: "deepwood",
  group: "cover",
  name: "Deepwood",
  recognition: {
    distinct:
      "Land whose biome class is Deepwood: strong verdure under a closed canopy. A Wending fen is that verdure over wetland, a Well meadow that verdure in open ground, and a plain forest the canopy without it.",
    isA,
  },
  existence: {
    statement: "Emerges where Greenwood's verdure quickens growth under standing forest.",
    way: "emerges",
    requires: notApplicable("Its class reads verdure and canopy; nothing else precedes it."),
    suitability: notApplicable("Greenwood's reach sets it, and nothing chooses a site."),
    places,
  },
  publication: {
    statement:
      "Each region publishes as a Deepwood on the ecology layer, outlined by the biome class margin; a region of under three cells publishes nothing.",
    moment: "geography",
    record: landscapeRecord("deepwood", "deepwood", places),
  },
  fields: {
    statement:
      "Its growth is verdure acting through the ecology on every greened cell; the wood writes nothing of its own.",
    ...coverWrites,
  },
  acrossMaps: developedCountry(
    "Verdure and cover capture onto the child, whose ecology finds the wood on finer ground. A captured wood's name goes to the nearest within two parent cells, or goes.",
    isA
  ),
  movement: {
    statement: "Roads pay for its trees as for any others, and Greenwood's roots read its canopy.",
    ...coverCosts,
  },
  others: {
    statement:
      "It shares no ground with another landscape or with water, and runs into stands of old growth and Well meadows.",
    needs: notApplicable("It reads a forcing directly, which more than one place may raise."),
    excludes: otherLandscapes("deepwood"),
    contains: notApplicable("Nothing is known to stand only in a Deepwood."),
    pairsWith: borders("greenwoodStand", "wellMeadow"),
  },
  people: {
    statement:
      "Timber and healing sap draw people to its edge; its growth takes back whatever they clear and leave.",
    offers: (state, place) => ({
      materials: meanOver(state, place, canopyAt),
      food: meanOver(state, place, verdureAt) / 2,
      sanctity: meanOver(state, place, verdureAt) / 2,
    }),
    threatens: (state, place) => [
      {
        hazard: "growth taking back the road",
        reach: hazardReach(state, place),
        severity: meanOver(state, place, verdureAt) / 3,
      },
    ],
  },
  time: {
    statement: "It lasts while verdure holds, and returns to plain forest when it falls away.",
    fate: (state, place) =>
      meanOver(state, place, verdureAt) < 0.3
        ? { fate: "becomes", kind: "forest" }
        : { fate: "persists" },
  },
  visibility: {
    statement:
      "It weighs by its verdure over the country around and by its size; a town tied to it carries it.",
    ...factors,
    importance: weighed(factors, { magnitude: 0.4, localConditions: 0.4, isolation: 0.2 }),
  },
  naming: {
    statement: "Named by the people nearest, whose towns at its edge may take its name.",
    namedBy: namingCultureNear,
    takesNameFrom: notApplicable("Its name comes from what it is, not from a place beside it."),
    lendsNameTo: notApplicable("A town at its edge takes a name through its own naming."),
  },
};
