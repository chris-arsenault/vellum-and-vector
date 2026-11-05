// @needsResolution carry: a carried place may not resolve on a finer map (ADR 0009).
import { quickenedFrom } from "../../canonry/ecologyEnvironment";
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
  fireAt,
  hazardReach,
  meanOver,
  otherLandscapes,
  quickeningAt,
  spanOf,
  withinOwn,
} from "./coverShared";

/** Area at which an ember grove is half as great as they get: 2,000 square kilometres. */
const typicalArea = 2e9;
const isA = isFamily("ember");
const places = landscapePlaces("emberGrove", "ember", quickeningAt);
const factors = countryFactors(places, typicalArea, quickeningAt);

export const emberGrove: PoiEntry = {
  id: "emberGrove",
  group: "cover",
  name: "Ember grove",
  recognition: {
    distinct:
      "Land whose biome class is Ember grove: quickened ground where trees took hold. A thaw meadow is the same quickening with no closed canopy, and a thawed halo is Fire's rule, which an ember grove may lie under or outrun.",
    isA,
  },
  existence: {
    statement:
      "Emerges where a system's quickening runs living processes fast enough over canopy to make a grove of it, wherever the forcing reaches.",
    way: "emerges",
    requires: notApplicable(
      "Its class reads the quickening and the canopy; nothing else precedes it."
    ),
    suitability: notApplicable("The quickening's reach sets it, and nothing chooses a site."),
    places,
  },
  publication: {
    statement:
      "Each region publishes as an ember grove on the ecology layer, outlined by the biome class margin, with the system strongest in it; a region of under three cells publishes nothing.",
    moment: "geography",
    record: landscapeRecord("ember", "ember", places),
  },
  fields: {
    statement:
      "Its trees turn over and burn fast, which is quickening acting through the ecology on every quickened cell; the grove writes nothing of its own.",
    ...coverWrites,
  },
  acrossMaps: developedCountry(
    "Quickening and cover capture onto the child, whose ecology finds the grove on finer ground. A captured grove's name goes to the nearest grove within two parent cells, or goes.",
    isA
  ),
  movement: {
    statement:
      "Roads pay for its trees as for any others, and Greenwood's roots read its canopy as any other; it adds no cost of its own.",
    ...coverCosts,
  },
  others: {
    statement:
      "It shares no ground with another landscape or with water. It usually lies on or beside a thawed halo, and runs into thaw meadow where the canopy thins.",
    needs: notApplicable("It reads a forcing directly, which more than one place may raise."),
    excludes: otherLandscapes("emberGrove"),
    contains: notApplicable("Nothing is known to stand only in a grove."),
    pairsWith: borders("thawedHalo", "thawMeadow"),
  },
  people: {
    statement:
      "Fast timber and fuel, with fruit in every season and a reverence for its heat. It burns often and fast.",
    offers: (state, place) => ({
      materials: meanOver(state, place, canopyAt),
      food: meanOver(state, place, quickeningAt) / 2,
      sanctity: meanOver(state, place, quickeningAt) / 2,
    }),
    threatens: (state, place) => [
      {
        hazard: "fast fire",
        reach: hazardReach(state, place),
        severity: Math.min(
          1,
          meanOver(state, place, fireAt) + meanOver(state, place, quickeningAt) / 2
        ),
      },
    ],
  },
  time: {
    statement:
      "A grove lasts while the quickening does. When the forcing falls away, the trees remain and it becomes plain forest.",
    fate: (state, place) =>
      meanOver(state, place, quickeningAt) < quickenedFrom
        ? { fate: "becomes", kind: "forest" }
        : { fate: "persists" },
  },
  visibility: {
    statement:
      "It weighs by how far its quickening stands from the country around and then by its size; a town at its edge carries it.",
    ...factors,
    importance: weighed(factors, { magnitude: 0.35, localConditions: 0.45, isolation: 0.2 }),
  },
  naming: {
    statement: "Named by the people nearest, and towns at its edge may take the name.",
    namedBy: namingCultureNear,
    takesNameFrom: notApplicable("Its name comes from what it is, not from a place beside it."),
    lendsNameTo: [{ kind: "settlement", holds: withinOwn(spanOf) }],
  },
};
