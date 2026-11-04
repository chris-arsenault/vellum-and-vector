import type { GenerationState } from "../../process";
import { carryWhereItLands, counterpartOf, movesTo, stays } from "../poiCarry";
import { notApplicable, type PoiEntry, type PoiFieldChange, type PoiPlace } from "../poiContract";
import { cellPlaces, within } from "../poiPlaces";
import { adjacent, cellSpan, fieldOf, gap, isSea, magicRule } from "../poiReads";
import { aloneAmong, attachment, drawnWhen, sized, standsOut } from "../poiVisibilityRules";
import { depthAt, namedFromShore, pressureAt, pressureLength } from "./seaShared";

/** The deep ocean's bathymetric zone, below the shelf break. */
const deepZone = 4;
/** Depth at which a locus is half as great as they get, and the depth that half-suits a site. */
const typicalDepth = 4000;
/** How the system's siting weighs a steep drop around a cell: metres of depth per unit gradient. */
const dropWeight = 10_000;
/** A preset ray's reach, where the system's parameters are absent. */
const presetRays = 2_000_000;
/** Cells around a locus whose surface water is broken, and the extra cost of crossing it. */
const brokenCells = 3,
  brokenWater = 3;

const isA = magicRule("pressure", "locus");
const places = cellPlaces("pressureLocus", isA);
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

/** The site's worth as the system reads it: depth, more for a steep drop around it. */
function deepAndSteep(state: GenerationState, cell: number) {
  const here = depthAt(state, cell);
  let drop = 0,
    neighbours = 0;
  for (const next of adjacent(state, cell)) {
    drop += Math.max(0, here - depthAt(state, next)) / gap(state, cell, next);
    neighbours++;
  }
  const score = here + (neighbours ? (drop * dropWeight) / neighbours : 0);
  return score / (score + typicalDepth);
}
/** The bed under a locus keeps its depth: no sediment fills a site that fires continuously. */
const heldDeep = (state: GenerationState, place: PoiPlace): readonly PoiFieldChange[] => [
  {
    change: "atMost",
    band: "Elevation",
    cell: place.anchor,
    value: fieldOf(state).Elevation.get(place.anchor),
  },
];

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
      isSea(state, cell) && fieldOf(state).BathymetricZoneCodes.get(cell) === deepZone,
    suitability: deepAndSteep,
    places,
  },
  fields: {
    statement:
      "A locus is the source of the system's force. It holds the deep bed under it open, and everything else it does arrives by ray, in the places those rays reach.",
    terrain: heldDeep,
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
      "It is the source: the system writes its source channel and traces its rays from it. PoiFieldChange has no band for a magic channel, so this cannot be declared here."
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
  },
  movement: {
    statement:
      "Boats pay to cross the broken water above it, fading with distance. Magic does not pay at a locus: it is where the system's force begins, and rays read geometry alone.",
    roads: notApplicable("It stands on the deep ocean bed; no road comes near."),
    boats(state, place, cell) {
      const reach = brokenCells * cellSpan(state),
        d = gap(state, place.anchor, cell);
      return isSea(state, cell) && d < reach ? 1 + brokenWater * (1 - d / reach) : 1;
    },
    drainage: notApplicable("It lies in deep water, beyond where the drainage network ends."),
    magic: notApplicable("Rays leave it along straight paths and read no carrier's cost."),
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
        reach: brokenCells * cellSpan(state),
        severity: pressureAt(state, place.anchor),
      },
    ],
  },
  time: {
    statement:
      "A locus is renewed continuously and holds while its water stays deep. If uplift or a closing ocean carries its cell onto the shelf it ends, and the system sites another next epoch.",
    fate: (state, place) =>
      fieldOf(state).BathymetricZoneCodes.get(place.anchor) === deepZone
        ? { fate: "persists" }
        : { fate: "ends" },
  },
  visibility: {
    statement:
      "A locus shows chiefly by standing alone: it is the rare centre of an ocean's force, and how much ocean it rules matters more than its own depth. The system already spaces them, and a Pressure culture's devotion carries one from far off.",
    ...factors,
    visibleAt: drawnWhen(factors, { magnitude: 0.2, localConditions: 0.3, isolation: 0.5 }),
  },
  naming: {
    statement: "Named by peoples whose divers or ships can reach it; the rest go unnamed.",
    namedBy: namedFromShore(raysThin),
    takesNameFrom: notApplicable("A locus is older than any shore's names."),
    lendsNameTo: [{ kind: "crushZone", holds: within(rays) }],
  },
};
