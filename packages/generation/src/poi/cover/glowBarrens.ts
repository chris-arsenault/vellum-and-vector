// @needsResolution carry: a carried place may not resolve on a finer map (ADR 0009).
import { stilledFrom } from "../../canonry/ecologyEnvironment";
import { notApplicable, type PoiEntry } from "../poiContract";
import { namingCultureNear } from "../poiPlaces";
import { rockAt } from "../poiReads";
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
  stillnessAt,
  waterlessRoads,
} from "./coverShared";

/** Area at which glow-lichen barrens are half as great as they get: 2,000 square kilometres. */
const typicalArea = 2e9;
const isA = isFamily("glow");
const places = landscapePlaces("glowBarrens", "glow", stillnessAt);
const factors = countryFactors(places, typicalArea, stillnessAt);

export const glowBarrens: PoiEntry = {
  id: "glowBarrens",
  group: "cover",
  name: "Glow-lichen barrens",
  recognition: {
    distinct:
      "Land whose biome class is Glow-lichen barrens: stilled ground under the cover line, where lichen lives on bare charged rock. A rime forest is the same stillness over trees, and plain barren land is the same bareness with no stillness on it.",
    isA,
  },
  existence: {
    statement:
      "Emerges where a system's stillness lies on ground too bare to hold other cover; the lichen adds no cover of its own.",
    way: "emerges",
    requires: notApplicable(
      "Its class reads the stillness and the bareness; nothing else precedes it."
    ),
    suitability: notApplicable("The stillness's reach sets it, and nothing chooses a site."),
    places,
  },
  publication: {
    statement:
      "Each region publishes as glow-lichen barrens on the ecology layer, outlined by the biome class margin, with the system strongest in it; a region of under three cells publishes nothing.",
    moment: "geography",
    record: landscapeRecord("glow", "glow", places),
  },
  fields: {
    statement:
      "Bare ground sheds water and soil as any does, under the soil and climate processes, and stillness acts through the ecology on every stilled cell; the barrens write nothing of their own.",
    ...coverWrites,
  },
  acrossMaps: developedCountry(
    "Stillness and cover capture onto the child, whose ecology finds the barrens on finer ground. A captured name goes to the nearest within two parent cells, or goes.",
    isA
  ),
  movement: {
    statement:
      "Roads pay for waterless ground under the desert's own moisture line, as on any bare ground, which no router reads.",
    ...coverCosts,
    roads: waterlessRoads,
  },
  others: {
    statement:
      "It shares no ground with another landscape or with water. It lies under an aurora field and runs into rime forest where trees stand.",
    needs: notApplicable("It reads a forcing directly, which more than one place may raise."),
    excludes: otherLandscapes("glowBarrens"),
    contains: notApplicable("Nothing is known to stand only on these barrens."),
    pairsWith: borders("auroraField", "rimeForest"),
  },
  people: {
    statement: "Exposed stone and a light seen from far off, with nothing to eat or drink.",
    offers: (state, place) => ({
      materials: meanOver(state, place, rockAt),
      sanctity: meanOver(state, place, stillnessAt),
    }),
    threatens: (state, place) => [
      {
        hazard: "thirst and stilling cold",
        reach: hazardReach(state, place),
        severity: meanOver(state, place, stillnessAt) / 2,
      },
    ],
  },
  time: {
    statement:
      "It lasts while the stillness does. When the forcing falls away the lichen goes and it becomes plain barren land.",
    fate: (state, place) =>
      meanOver(state, place, stillnessAt) < stilledFrom
        ? { fate: "becomes", kind: "barren" }
        : { fate: "persists" },
  },
  visibility: {
    statement:
      "It weighs by how far it stands from the country around: its light is a landmark in dark country. A town tied to it carries it.",
    ...factors,
    importance: weighed(factors, { magnitude: 0.3, localConditions: 0.5, isolation: 0.2 }),
  },
  naming: {
    statement: "Named by the people on its edges, if any; it may go unnamed.",
    namedBy: namingCultureNear,
    takesNameFrom: notApplicable("Its name comes from what it is, not from a place beside it."),
    lendsNameTo: notApplicable("Few take the name of an empty place on purpose."),
  },
};
