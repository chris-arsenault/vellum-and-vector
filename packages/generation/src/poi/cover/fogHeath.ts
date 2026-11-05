// @needsResolution carry: a carried place may not resolve on a finer map (ADR 0009).
import { foggedFrom, woodlandTrees } from "../../canonry/ecologyEnvironment";
import type { GenerationState } from "../../process";
import { notApplicable, type PoiEntry } from "../poiContract";
import { namingCultureNear } from "../poiPlaces";
import { fieldOf, grassCoverAt, treeCoverAt } from "../poiReads";
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
  spanOf,
  withinOwn,
} from "./coverShared";

/** Area at which a fog coast is half as great as they get: 2,000 square kilometres. */
const typicalArea = 2e9;
const fogAt = (state: GenerationState, cell: number) => fieldOf(state).FogForcing.get(cell);
const isA = isFamily("fog");
const places = landscapePlaces("fogHeath", "fog", fogAt);
const factors = countryFactors(places, typicalArea, fogAt);

export const fogHeath: PoiEntry = {
  id: "fogHeath",
  group: "cover",
  name: "Fog heath",
  recognition: {
    distinct:
      "Land whose biome class is Fog heath or Moss forest: living cover under a system's fog forcing, heath on open ground and moss forest where trees took hold. Both are the one fog family; plain grassland or forest is the same cover with no fog on it.",
    isA,
  },
  existence: {
    statement:
      "Emerges on the coast a Pressure front faces, or wherever a system's fog lies over living cover. Whether it is heath or moss forest is its property, read from its trees and published as its biome.",
    way: "emerges",
    requires: notApplicable("Its class reads the fog and the cover; nothing else precedes it."),
    suitability: notApplicable("The fog's reach sets it, and nothing chooses a site."),
    places,
  },
  publication: {
    statement:
      "Each region publishes as a fog coast on the ecology layer, outlined by the biome class margin and named for its biome; a region of under three cells publishes nothing.",
    moment: "geography",
    record: landscapeRecord("fog", "fog", places),
  },
  fields: {
    statement:
      "Fog wets its ground and feeds its growth, which is the fog forcing acting through the ecology on every fogged cell; the heath writes nothing of its own.",
    ...coverWrites,
  },
  acrossMaps: developedCountry(
    "Fog forcing and cover capture onto the child, whose ecology finds the heath on finer ground. A captured name goes to the nearest within two parent cells, or goes.",
    isA
  ),
  movement: {
    statement:
      "Roads pay for any trees on it as for any others; fog itself asks nothing the router does not charge, and it adds no cost of its own.",
    ...coverCosts,
  },
  others: {
    statement:
      "It shares no ground with another landscape or with water. It faces an upwelling front at sea and runs into grassland or forest inland, where the fog gives out.",
    needs: notApplicable("It reads a forcing directly, which more than one place may raise."),
    excludes: otherLandscapes("fogHeath"),
    contains: notApplicable("Nothing is known to stand only on a heath."),
    pairsWith: borders("upwellingFront", "grassland", "forest"),
  },
  people: {
    statement:
      "Rough pasture, peat and moss, wet air in dry country; and a coast where ships and travellers lose their way.",
    offers: (state, place) => ({
      food: 0.4 * meanOver(state, place, grassCoverAt),
      water: meanOver(state, place, fogAt),
      materials: 0.3 * meanOver(state, place, treeCoverAt),
    }),
    threatens: (state, place) => [
      {
        hazard: "lost in fog",
        reach: hazardReach(state, place),
        severity: meanOver(state, place, fogAt) / 2,
      },
    ],
  },
  time: {
    statement:
      "It lasts while the fog does. When the forcing falls away it becomes plain forest if trees stand, plain grassland if they do not.",
    fate(state, place) {
      if (meanOver(state, place, fogAt) >= foggedFrom) return { fate: "persists" };
      return meanOver(state, place, treeCoverAt) >= woodlandTrees
        ? { fate: "becomes", kind: "forest" }
        : { fate: "becomes", kind: "grassland" };
    },
  },
  visibility: {
    statement:
      "It weighs by its breadth along a coast and by how sharply it breaks from dry country beside it; a town on it carries it.",
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
