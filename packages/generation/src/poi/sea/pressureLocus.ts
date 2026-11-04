import { deepOceanZone } from "../../canonry/geography";
import { deepSiteScore } from "../../canonry/magicSources";
import type { GenerationState } from "../../process";
import { carryWhereItLands, counterpartOf, movesTo, stays } from "../poiCarry";
import { notApplicable, type PoiEntry, type PoiPlace } from "../poiContract";
import { rulePlaces, within } from "../poiPlaces";
import { ruleRecord } from "../poiRecords";
import { cellsWithin, fieldOf, gap, isSea, magicRule, metres } from "../poiReads";
import { aloneAmong, attachment, sized, standsOut, weighed } from "../poiVisibilityRules";
import { depthAt, namedFromShore, near, pressureAt, pressureLength } from "./seaShared";

/** Depth at which a locus is half as great as they get, and the depth that half-suits a site. */
const typicalDepth = 4000;
/** A preset ray's reach, where the system's parameters are absent. */
const presetRays = 2_000_000;
/** The surface water around a locus that is broken, 30 km, and the extra cost of crossing it. */
const brokenReach = near(30_000),
  brokenWater = 3;

const isA = magicRule("pressure", "locus");
const places = rulePlaces("pressureLocus", "pressure", "locus");
const rays = (state: GenerationState) => pressureLength(state, "rayDistance", presetRays);
const raysThin = (state: GenerationState) => rays(state) / 2;
const depthOf = (state: GenerationState, place: PoiPlace) => depthAt(state, place.anchor);
const counterpart = counterpartOf(isA, 2);

const factors = {
  magnitude: sized(depthOf, typicalDepth),
  localConditions: standsOut(pressureAt, raysThin),
  /** The system spaces its loci half a ray's reach apart; a further one rules more ocean. */
  isolation: aloneAmong(places, raysThin),
  cultural: attachment(rays),
};

/** The site's worth, through the score the system itself ranks its picks by. */
function deepAndSteep(state: GenerationState, cell: number) {
  const score = metres(deepSiteScore(fieldOf(state), cell));
  return score / (score + typicalDepth);
}

export const pressureLocus: PoiEntry = {
  id: "pressureLocus",
  group: "sea",
  name: "Pressure locus",
  recognition: {
    distinct:
      "A member of Pressure's locus rule: the system's source channel is set on the cell. It is the origin of the system's rays, sited in deep ocean and firing continuously. A rogue impact is a near-shore origin marked in another channel that fires once; a crush zone is where rays pile up, whether or not they started there.",
    isA,
  },
  existence: {
    statement:
      "Sited by the Pressure system: it ranks ocean cells by depth and by the drop around them, then spaces its picks half a ray's reach apart. It fires its rays from there for as long as it stands.",
    way: "sited",
    requires: (state, cell) =>
      isSea(state, cell) && fieldOf(state).BathymetricZoneCodes.get(cell) === deepOceanZone,
    suitability: deepAndSteep,
    places,
  },
  publication: {
    statement: "Every locus publishes as the system's class, a site at its source.",
    moment: "magic",
    record: ruleRecord("pressure", "locus"),
  },
  fields: {
    statement:
      "A locus is the source of the system's force. Everything it does arrives by ray, in the places those rays reach.",
    terrain: notApplicable(
      "Sediment does not reach the abyssal bed it stands on, so there is nothing to hold; if the bed rises onto the shelf, the locus ends."
    ),
    water: notApplicable(
      "A ray lifts water only where it shoals; over the deep cell it starts from, nothing reaches the surface."
    ),
    climate: notApplicable(
      "The water is moved far from it, on the shoals, and the climate reads that front; the deep cell changes no air."
    ),
    cover: notApplicable(
      "No light reaches its depth, so aquatic productivity is already nothing here; Pressure's toxicity reaches life through ecology."
    ),
    magic: notApplicable(
      "It is the source: the system writes its source channel and traces its rays from it."
    ),
  },
  acrossMaps: {
    statement:
      "A refined map does not retrace rays, and its captured intensity stands, so a locus is carried for what it means and not to fire again. It keeps where it lands, or moves to a locus cell the finer map holds.",
    carry: carryWhereItLands,
    realize: notApplicable(
      "The captured field stands, so the finer sea need not provide a source."
    ),
    counterpart,
    unrealized: stays,
    settle: (state, carried) =>
      isSea(state, carried.cell) ? stays() : movesTo(counterpart)(state, carried),
    schedule: notApplicable("A refined map does not fire a captured locus."),
  },
  movement: {
    statement:
      "Boats pay to cross the broken water above it, fading with distance. Magic does not pay at a locus: it is where the system's force begins, and rays read geometry alone.",
    roads: notApplicable("It stands on the deep ocean bed; no road comes near."),
    boats(state, place) {
      const reach = brokenReach(state);
      return cellsWithin(state, place.anchor, reach)
        .filter((cell) => isSea(state, cell))
        .map((cell) => ({
          cell,
          factor: 1 + brokenWater * Math.max(0, 1 - gap(state, place.anchor, cell) / reach),
        }));
    },
    drainage: notApplicable("It lies in deep water, beyond where the drainage network ends."),
    magic: notApplicable("Rays leave it along straight paths and read no carrier's cost."),
    links: notApplicable("A locus joins no two cells."),
    crosses: notApplicable("It bars nothing and opens nothing; it is a point in open ocean."),
  },
  others: {
    statement:
      "A locus makes the crush zones and fronts its rays reach, and it sits in the deep where other loci keep their distance. A wake and a rogue impact have their own origins and owe it nothing.",
    needs: notApplicable("It needs only deep ocean, which its requirement states."),
    excludes: [
      {
        kind: "pressureLocus",
        holds: (state, a, b) => a !== b && gap(state, a.anchor, b.anchor) < raysThin(state),
      },
    ],
    contains: notApplicable("A locus is one cell."),
    pairsWith: [
      { kind: "crushZone", holds: within(rays) },
      { kind: "upwellingFront", holds: within(rays) },
    ],
  },
  people: {
    statement:
      "A locus is the deepest charge for Pressure's divers and a holy depth to their peoples, if any can reach it. Its open-water danger is the surge above it; the far-reaching damage is told by the crush zones and impacts it feeds.",
    offers: (state, place) => ({
      power: pressureAt(state, place.anchor),
      sanctity: factors.magnitude(state, place),
    }),
    threatens: (state, place) => [
      {
        hazard: "broken water",
        reach: brokenReach(state),
        severity: pressureAt(state, place.anchor),
      },
    ],
  },
  time: {
    statement:
      "A locus is renewed continuously and holds while its water stays deep. If uplift or a closing ocean carries its cell onto the shelf it ends, and the system sites another next epoch.",
    fate: (state, place) =>
      fieldOf(state).BathymetricZoneCodes.get(place.anchor) === deepOceanZone
        ? { fate: "persists" }
        : { fate: "ends" },
  },
  visibility: {
    statement:
      "A locus shows chiefly by standing alone: it is the rare centre of an ocean's force, and how much ocean it rules matters more than its own depth. The system already spaces them, and a Pressure culture's devotion carries one from far off.",
    ...factors,
    importance: weighed(factors, { magnitude: 0.2, localConditions: 0.3, isolation: 0.5 }),
  },
  naming: {
    statement: "Named by peoples whose divers or ships can reach it; the rest go unnamed.",
    namedBy: namedFromShore(raysThin),
    takesNameFrom: notApplicable("A locus is older than any shore's names."),
    lendsNameTo: [{ kind: "crushZone", holds: within(rays) }],
  },
};
