// @needsResolution carry: a carried place may not resolve on a finer map (ADR 0009).
import { stilledFrom } from "../../world/ecologyEnvironment";
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
  stillnessAt,
} from "./coverShared";

/** Area at which a rime forest is half as great as they get: 2,000 square kilometres. */
const typicalArea = 2e9;
const isA = isFamily("rime");
const places = landscapePlaces("rimeForest", "rime", stillnessAt);
const factors = countryFactors(places, typicalArea, stillnessAt);

export const rimeForest: PoiEntry = {
  id: "rimeForest",
  group: "cover",
  name: "Rime forest",
  recognition: {
    distinct:
      "Land whose biome class is Rime forest: stilled ground where old trees stand. Glow-lichen barrens are the same stillness with no cover to speak of, and a plain forest is the same canopy with no stillness on it.",
    isA,
  },
  existence: {
    statement:
      "Emerges where a system's stillness slows living processes over a canopy, so trees stand past their span.",
    way: "emerges",
    requires: notApplicable(
      "Its class reads the stillness and the canopy; nothing else precedes it."
    ),
    suitability: notApplicable("The stillness's reach sets it, and nothing chooses a site."),
    places,
  },
  publication: {
    statement:
      "Each region publishes as a rime forest on the ecology layer, outlined by the biome class margin, with the system strongest in it; a region of under three cells publishes nothing.",
    moment: "geography",
    record: landscapeRecord("rime", "rime", places),
  },
  fields: {
    statement:
      "Its trees grow and rot slowly, which is stillness acting through the ecology on every stilled cell; the forest writes nothing of its own.",
    ...coverWrites,
  },
  acrossMaps: developedCountry(
    "Stillness and cover capture onto the child, whose ecology finds the forest on finer ground. A captured forest's name goes to the nearest within two parent cells, or goes.",
    isA
  ),
  movement: {
    statement:
      "Roads pay for its trees as for any others, and Greenwood's roots read its canopy as any other; it adds no cost of its own.",
    ...coverCosts,
  },
  others: {
    statement:
      "It shares no ground with another landscape or with water. It lies under an aurora field and runs into glow-lichen barrens where the trees give out.",
    needs: notApplicable("It reads a forcing directly, which more than one place may raise."),
    excludes: otherLandscapes("rimeForest"),
    contains: notApplicable("Nothing is known to stand only in a rime forest."),
    pairsWith: borders("auroraField", "glowBarrens"),
  },
  people: {
    statement:
      "Old slow timber and an awe of what does not change, with little to eat: stilled woods feed no one. The cold and the silence kill the unprepared.",
    offers: (state, place) => ({
      materials: meanOver(state, place, canopyAt),
      sanctity: meanOver(state, place, stillnessAt),
    }),
    threatens: (state, place) => [
      {
        hazard: "stilling cold",
        reach: hazardReach(state, place),
        severity: meanOver(state, place, stillnessAt) / 2,
      },
    ],
  },
  time: {
    statement:
      "It lasts while the stillness does, and changes little while it does. When the forcing falls away the trees start to age again and it becomes plain forest.",
    fate: (state, place) =>
      meanOver(state, place, stillnessAt) < stilledFrom
        ? { fate: "becomes", kind: "forest" }
        : { fate: "persists" },
  },
  visibility: {
    statement:
      "It weighs by how far its stillness stands from the country around and then by its size; a town tied to it carries it.",
    ...factors,
    importance: weighed(factors, { magnitude: 0.35, localConditions: 0.45, isolation: 0.2 }),
  },
  naming: {
    statement: "Named by the people nearest, who rarely settle close enough to lend it to a town.",
    namedBy: namingCultureNear,
    takesNameFrom: notApplicable("Its name comes from what it is, not from a place beside it."),
    lendsNameTo: notApplicable("Few take the name of a place they keep away from."),
  },
};
