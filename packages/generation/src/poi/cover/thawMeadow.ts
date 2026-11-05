// @needsResolution carry: a carried place may not resolve on a finer map (ADR 0009).
import { quickenedFrom } from "../../canonry/ecologyEnvironment";
import { notApplicable, type PoiEntry } from "../poiContract";
import { namingCultureNear } from "../poiPlaces";
import { grassCoverAt } from "../poiReads";
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
  quickeningAt,
  spanOf,
  withinOwn,
} from "./coverShared";

/** Area at which a thaw meadow is half as great as they get: 2,000 square kilometres. */
const typicalArea = 2e9;
const isA = isFamily("thaw");
const places = landscapePlaces("thawMeadow", "thaw", quickeningAt);
const factors = countryFactors(places, typicalArea, quickeningAt);

export const thawMeadow: PoiEntry = {
  id: "thawMeadow",
  group: "cover",
  name: "Thaw meadow",
  recognition: {
    distinct:
      "Land whose biome class is Thaw meadow: quickened ground with living cover but no closed canopy. An ember grove is the same quickening under trees, and plain grassland is the same grass with no forcing on it.",
    isA,
  },
  existence: {
    statement:
      "Emerges where a system's quickening keeps open ground growing, wherever the forcing reaches, in cold country as readily as warm.",
    way: "emerges",
    requires: notApplicable(
      "Its class reads the quickening and the cover; nothing else precedes it."
    ),
    suitability: notApplicable("The quickening's reach sets it, and nothing chooses a site."),
    places,
  },
  publication: {
    statement:
      "Each region publishes as a thaw meadow on the ecology layer, outlined by the biome class margin, with the system strongest in it; a region of under three cells publishes nothing.",
    moment: "geography",
    record: landscapeRecord("thaw", "thaw", places),
  },
  fields: {
    statement:
      "Its grass grows and burns fast, which is quickening acting through the ecology on every quickened cell; the meadow writes nothing of its own.",
    ...coverWrites,
  },
  acrossMaps: developedCountry(
    "Quickening and cover capture onto the child, whose ecology finds the meadow on finer ground. A captured meadow's name goes to the nearest meadow within two parent cells, or goes.",
    isA
  ),
  movement: {
    statement: "Open grass is what road costs are written against; it adds no cost of its own.",
    ...coverCosts,
  },
  others: {
    statement:
      "It shares no ground with another landscape or with water. It usually lies on or beside a thawed halo, and runs into ember grove where trees close.",
    needs: notApplicable("It reads a forcing directly, which more than one place may raise."),
    excludes: otherLandscapes("thawMeadow"),
    contains: notApplicable("Nothing is known to stand only in a meadow."),
    pairsWith: borders("thawedHalo", "emberGrove"),
  },
  people: {
    statement:
      "Rich quick pasture and a season where the country around has none. It carries fire fast when it dries.",
    offers: (state, place) => ({
      food: Math.min(
        1,
        meanOver(state, place, grassCoverAt) + meanOver(state, place, quickeningAt) / 2
      ),
      sanctity: meanOver(state, place, quickeningAt) / 2,
    }),
    threatens: (state, place) => [
      {
        hazard: "grass fire",
        reach: hazardReach(state, place),
        severity: meanOver(state, place, quickeningAt) / 2,
      },
    ],
  },
  time: {
    statement:
      "A meadow lasts while the quickening does. When the forcing falls away, what grows there remains as plain grassland.",
    fate: (state, place) =>
      meanOver(state, place, quickeningAt) < quickenedFrom
        ? { fate: "becomes", kind: "grassland" }
        : { fate: "persists" },
  },
  visibility: {
    statement:
      "It weighs by how far its quickening stands from the country around: green in frozen country is what people travel to see. Size matters less, and a town at its edge carries it.",
    ...factors,
    importance: weighed(factors, { magnitude: 0.3, localConditions: 0.5, isolation: 0.2 }),
  },
  naming: {
    statement: "Named by the herders nearest, and towns at its edge may take the name.",
    namedBy: namingCultureNear,
    takesNameFrom: notApplicable("Its name comes from what it is, not from a place beside it."),
    lendsNameTo: [{ kind: "settlement", holds: withinOwn(spanOf) }],
  },
};
