// @needsResolution carry: a carried place may not resolve on a finer map (ADR 0009).
import type { GenerationState } from "../../process";
import { carryWhereItLands } from "../poiCarry";
import { notApplicable, type PoiEntry, type PoiPlace } from "../poiContract";
import { namingCultureNear, within } from "../poiPlaces";
import { cellSpan, fieldOf, treeCoverAt } from "../poiReads";
import { weighed } from "../poiVisibilityRules";
import { isFamily, landscapePlaces, landscapeRecord } from "./coverLandscape";
import {
  borders,
  canopyAt,
  countryCounterpart,
  countryFactors,
  coverCosts,
  coverWrites,
  fireAt,
  hazardReach,
  meanOver,
  movesOrGoes,
  oldStand,
  otherLandscapes,
  spanOf,
  standsIn,
  verdureAt,
  withinOwn,
} from "./coverShared";

/** Area at which a forest is half as great as forests get: 50,000 square kilometres. */
// length-unit: fraction
const typicalArea = 0.003125;
/** The mean ecological damage past which a canopy does not come back within the epoch. */
const lostCanopy = 0.5;
const isA = isFamily("forest");
const places = landscapePlaces("forest", "forest", treeCoverAt);
const factors = countryFactors(places, typicalArea, treeCoverAt);
const counterpart = countryCounterpart(isA);
const unrealized = movesOrGoes(counterpart);
const nearby = (state: GenerationState) => 3 * cellSpan(state);

/** Gathering's own shape: trees times productivity, with the game they hold; a stilled wood gives little. */
function foodOf(state: GenerationState, place: PoiPlace) {
  const map = fieldOf(state),
    stilled = meanOver(state, place, (_s, cell) => map.Stillness.get(cell)),
    gathered = meanOver(
      state,
      place,
      (s, cell) =>
        treeCoverAt(s, cell) * Math.min(1, map.Productivity.get(cell) * 3) +
        map.Herbivores.get(cell)
    );
  return Math.min(1, gathered) * (1 - 0.8 * stilled);
}
const standShare = (state: GenerationState, place: PoiPlace) =>
  meanOver(state, place, (s, cell) => (oldStand(s, cell) ? 1 : 0));

export const forest: PoiEntry = {
  id: "forest",
  group: "cover",
  name: "Forest",
  recognition: {
    distinct:
      "Land whose biome class is in the forest family, as the biome layer shows it: Woodland, Temperate forest, Boreal forest or Rainforest. Grassland is the family below the tree line of those classes; ember groves, rime forests and moss forests are trees too, but a system's forcing puts them in families of their own. A halo or an old stand may lie over it, since those are rules, not classes.",
    isA,
  },
  existence: {
    statement:
      "Emerges where the plant cohorts close canopy under the climate and soil. Boreal, temperate, dry and montane are its properties, read from its means and published as its biome.",
    way: "emerges",
    requires: notApplicable(
      "Nothing is required beyond the canopy its class reads; seeds reach any ground the cohorts can grow on."
    ),
    suitability: notApplicable("No process picks a forest's site: dispersal and growth make it."),
    places,
  },
  publication: {
    statement:
      "Each region publishes as a forest on the ecology layer, outlined by the biome class margin and named for its biome; a region of under three cells publishes nothing.",
    moment: "geography",
    record: landscapeRecord("forest", "forest", places),
  },
  fields: {
    statement:
      "A forest binds its soil, takes rain in and returns it to the air. Those are the soil and climate processes reading its cover over the whole field, so cutting it changes all three with no effect of its own.",
    ...coverWrites,
  },
  acrossMaps: {
    statement:
      "The cover bands capture onto the refined map and the regional ecology grows them, so a forest refines by developing: glades and treelines appear where finer slope and water ask for them, and it writes only the child. A captured forest's name goes to the forest nearest where it lands; if none stands within two parent cells, it goes.",
    carry: carryWhereItLands,
    realize: notApplicable(
      "Captured canopy needs no forcing: the regional ecology grows it, and `regionalAuthority` already holds authored forest polygons at woodland."
    ),
    counterpart,
    unrealized,
    settle: unrealized,
    schedule: notApplicable("A forest does nothing at refinement's other points."),
  },
  movement: {
    statement:
      "Roads pay for trees in proportion to their density, roots slow channels cutting in, and Greenwood's roots travel fastest through closed canopy. Each of those is a generator cost that reads the cover of every cell, so the forest adds none of its own.",
    ...coverCosts,
  },
  others: {
    statement:
      "It shares no ground with another landscape or with water. It shelters shrines, ruins and springs, runs into grassland, wetland and clearings at its edges, and stands near the towns it supplies.",
    needs: notApplicable("A forest needs no other place, only ground and climate."),
    excludes: otherLandscapes("forest"),
    contains: standsIn("shrine", "ruin", "spring", "greenwoodStand"),
    pairsWith: [
      ...borders("grassland", "wetland", "clearance"),
      { kind: "settlement", holds: within(nearby) },
    ],
  },
  people: {
    statement:
      "Timber and fuel first, then game and gathered food, thin in stilled woods; cover for those who know it; old stands are sacred and hold sap people tap. Dry-season canopy burns.",
    offers: (state, place) => ({
      materials: meanOver(state, place, canopyAt),
      food: foodOf(state, place),
      defence: 0.3 * meanOver(state, place, treeCoverAt),
      sanctity: Math.max(standShare(state, place), meanOver(state, place, verdureAt)),
    }),
    threatens(state, place) {
      const fire = meanOver(state, place, fireAt);
      return fire > 0
        ? [{ hazard: "wildfire", reach: hazardReach(state, place), severity: Math.min(1, fire) }]
        : [];
    },
  },
  time: {
    statement:
      "Forest persists while cohorts renew; ageing canopy may hold a Greenwood stand, a stilled one stands past its span, and buried stands become coal. Fire, flood or clearing past what the epoch regrows leaves open grass.",
    fate(state, place) {
      const damage = meanOver(state, place, (_s, cell) =>
        fieldOf(state).EcologicalDamage.get(cell)
      );
      return damage > lostCanopy ? { fate: "becomes", kind: "grassland" } : { fate: "persists" };
    },
  },
  visibility: {
    statement:
      "A forest weighs mainly by how much country it covers, then by how abruptly it stands out of open land; a small wood on a plain outranks the same wood in forested hills, and a town named after it carries it.",
    ...factors,
    importance: weighed(factors, { magnitude: 0.6, localConditions: 0.25, isolation: 0.15 }),
  },
  naming: {
    statement:
      "Named by the people nearest; the ecology gives it a class name, and towns at its edge may take its name.",
    namedBy: namingCultureNear,
    takesNameFrom: notApplicable(
      "A forest is older than what stands at its edge; names run out of it."
    ),
    lendsNameTo: [{ kind: "settlement", holds: withinOwn(spanOf) }],
  },
};
