import type { GenerationState } from "../../process";
import { carryWhereItLands } from "../poiCarry";
import { notApplicable, type PoiEntry, type PoiPlace } from "../poiContract";
import { namingCultureNear, regionPlaces, within } from "../poiPlaces";
import { cellSpan, fieldOf, treeCoverAt } from "../poiReads";
import { drawnWhen } from "../poiVisibilityRules";
import {
  borders,
  canopyAt,
  ceilingsHeld,
  countryCounterpart,
  countryFactors,
  floorsHeld,
  hazardReach,
  isKind,
  meanOver,
  movesOrGoes,
  oldStand,
  onPlace,
  rootCarriage,
  sharesNoGround,
  spanOf,
  standsIn,
  verdureHeld,
  withinOwn,
} from "./coverShared";

/** Area at which a forest is half as great as forests get: 50,000 square kilometres. */
const typicalArea = 5e10;
/** The road's charge for trees, as the map router's ground factor holds it. */
const roadPerTree = 0.8;
/** The binding roots add to the resistance a channel cuts through, as `surfaceResistance` holds it. */
const channelPerTree = 1.2;
/** The mean ecological damage past which a canopy does not come back within the epoch. */
const lostCanopy = 0.5;
const isA = isKind("forest");
const places = regionPlaces("forest", isA, treeCoverAt);
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
      "Land the ecology classes as Woodland, Temperate, Boreal or Rainforest, Deepwood, Rime forest, Moss forest or Ember grove (BiomeCodes: TreeCover at least 0.15, or at least 0.4 under 2 degrees), or a Greenwood stand rule cell, on ground not classed wetland, ice or water. Grassland is the same test failing on tree share, or a warm Savanna at the same share (over 18 degrees); wetland is ground with wetness over 0.5, whatever stands on it; a halo or wild zone over the trees takes the cell.",
    isA,
  },
  existence: {
    statement:
      "Emerges where the plant cohorts close canopy under the climate and soil. Greenwood's old stands are this kind: Greenwood adds a stand where canopy of 0.6 reaches 800 years, and the forest's other classes (conifer or broadleaf share, stillness, fog, verdure) are its properties, read from the biome name, not kinds of their own.",
    way: "emerges",
    requires: notApplicable(
      "Nothing is required beyond the canopy its test reads; seeds reach any ground the cohorts can grow on."
    ),
    suitability: notApplicable("No process picks a forest's site: dispersal and growth make it."),
    places,
  },
  fields: {
    statement:
      "A forest binds its soil, takes rain in and returns it to the air: roots hold the soil and the stable slope, the canopy keeps rain out of quick runoff, and transpiration feeds the air columns passing over it. Cut it and all three go. An old stand also holds Greenwood's verdure.",
    terrain: floorsHeld("SoilDepth"),
    water(state, place) {
      return [...floorsHeld("Infiltration")(state, place), ...ceilingsHeld("Runoff")(state, place)];
    },
    climate: floorsHeld("Evapotranspiration"),
    cover: notApplicable(
      "Canopy is what it is: shade and seed fall are already inside the ecology's cohorts, and a declared change would count them twice."
    ),
    magic: verdureHeld(oldStand),
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
  },
  movement: {
    statement:
      "Roads pay for trees in proportion to their density, as the map router charges them; regional ways do not read cover yet, and world routes must not pay twice. Roots slow channels cutting in, and Greenwood's roots travel fastest through closed canopy.",
    roads: onPlace((state, cell) => 1 + roadPerTree * treeCoverAt(state, cell)),
    boats: notApplicable("A river through a forest carries boats as any other reach."),
    drainage: onPlace((state, cell) => 1 + channelPerTree * treeCoverAt(state, cell)),
    magic: onPlace(rootCarriage),
    crosses: notApplicable("Trees are something to cross, not a way over a barrier."),
  },
  others: {
    statement:
      "It shares no ground with other cover or with wetland. It shelters shrines, ruins and springs, runs into grassland, wetland and clearings at its edges, and stands near the towns it supplies.",
    needs: notApplicable("A forest needs no other place, only ground and climate."),
    excludes: sharesNoGround(
      "grassland",
      "barren",
      "thawedHalo",
      "wildZone",
      "clearance",
      "wetland",
      "lake"
    ),
    contains: standsIn("shrine", "ruin", "spring"),
    pairsWith: [
      ...borders("grassland", "wetland", "clearance"),
      { kind: "settlement", holds: within(nearby) },
    ],
  },
  people: {
    statement:
      "Timber and fuel first, then game and gathered food, thin in stilled woods; cover for those who know it; old stands are sacred and hold sap people tap. Dry-season canopy burns.",
    offers(state, place) {
      const verdure = meanOver(state, place, (_s, cell) => fieldOf(state).Verdure.get(cell));
      return {
        materials: meanOver(state, place, canopyAt),
        food: foodOf(state, place),
        defence: 0.3 * meanOver(state, place, treeCoverAt),
        sanctity: Math.max(standShare(state, place), verdure),
      };
    },
    threatens(state, place) {
      const fire = meanOver(state, place, (_s, cell) => fieldOf(state).FireActivity.get(cell));
      return fire > 0
        ? [{ hazard: "wildfire", reach: hazardReach(state, place), severity: Math.min(1, fire) }]
        : [];
    },
  },
  time: {
    statement:
      "Forest persists while cohorts renew; ageing canopy may become a Greenwood stand, a stilled one stands past its span, and buried stands become coal. Fire, flood or clearing past what the epoch regrows leaves open grass.",
    fate(state, place) {
      const damage = meanOver(state, place, (_s, cell) =>
        fieldOf(state).EcologicalDamage.get(cell)
      );
      return damage > lostCanopy ? { fate: "becomes", kind: "grassland" } : { fate: "persists" };
    },
  },
  visibility: {
    statement:
      "A forest shows mainly by how much country it covers, then by how abruptly it stands out of open land; a small wood on a plain outranks the same wood in forested hills, and a town named after it carries it.",
    ...factors,
    visibleAt: drawnWhen(factors, { magnitude: 0.6, localConditions: 0.25, isolation: 0.15 }),
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
