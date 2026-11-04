import type { GenerationState } from "../../process";
import { carryWhereItLands, costNear, counterpartOf, goes, movesTo, stays } from "../poiCarry";
import { notApplicable, type PoiEntry, type PoiFieldChange, type PoiPlace } from "../poiContract";
import { holds, namingCultureNear, regionPlaces, within } from "../poiPlaces";
import { adjacent, cellSpan, fieldOf, isLand, magicRule, upwellingAt } from "../poiReads";
import { aloneAmong, attachment, drawnWhen, sized, standsOut } from "../poiVisibilityRules";
import { intensityOf, magicFieldOf, peakOf, weightedArea } from "./anomalyReads";

/** Square metres of crossing rays at which a lattice is half as great as lattices get. */
const typicalArea = 2e10;
/** What a confused sea adds to a boat's passage, per unit of intensity share. */
const swell = 2;
/** How much a standing pattern slows what the current carries through it. */
const currentDrag = 1.25;
/** The reach of Pressure's rays if the system states none. */
const defaultRayDistance = 2_000_000;

const pressureAt = intensityOf("pressure");
const isLattice = magicRule("pressure", "lattice"),
  isCrush = magicRule("pressure", "crush"),
  isFront = magicRule("pressure", "front");
const isA = (state: GenerationState, cell: number) =>
  isLattice(state, cell) && !isCrush(state, cell) && !isFront(state, cell);
const places = regionPlaces("interferenceLattice", isA, pressureAt);
const around = (state: GenerationState) => 8 * cellSpan(state);
const rayReach = (state: GenerationState) =>
  magicFieldOf(state, "pressure")?.definition.parameters.rayDistance ?? defaultRayDistance;
const area = (state: GenerationState, place: PoiPlace) => weightedArea(state, place, () => 1);
const peakPressure = (state: GenerationState, place: PoiPlace) =>
  peakOf(state, place, pressureAt) / 1000;
const counterpart = counterpartOf(isA, 1);
const factors = {
  magnitude: sized(area, typicalArea),
  localConditions: standsOut(pressureAt, around),
  isolation: aloneAmong(places, (state) => 2 * around(state)),
  cultural: attachment((state) => 2 * around(state)),
};
/** A band the rays have already written, held at its present value over a place's cells. */
const held =
  (band: "Upwelling" | "FogForcing") =>
  (state: GenerationState, place: PoiPlace): PoiFieldChange[] =>
    place.cells
      .filter((cell) => fieldOf(state)[band].get(cell) > 0)
      .map((cell) => ({
        change: "atLeast",
        band,
        cell,
        value: fieldOf(state)[band].get(cell),
      }));
/** The land its nodes reach, from each place cell to the shore cells beside it. */
function shoreOf(state: GenerationState, place: PoiPlace) {
  const shore = new Set<number>();
  for (const cell of place.cells)
    for (const next of adjacent(state, cell)) if (isLand(state, next)) shore.add(next);
  return [...shore];
}

export const interferenceLattice: PoiEntry = {
  id: "interferenceLattice",
  group: "anomalies",
  name: "Interference lattice",
  recognition: {
    distinct:
      "A cell of Pressure's lattice rule, where intensity and the rule's own noise both pass its levels, that is neither crush zone nor upwelling front. The noise term makes it a pattern of nodes, not a solid sheet. A crush zone is the same rays at a far higher intensity with no pattern; a front needs ocean and upwelling; a wake reads the wake channel and a locus is the rays' source.",
    isA,
  },
  existence: {
    statement:
      "Emerges where Pressure rays, thinned by distance and split by shelves and islands, cross in open water without the force to crush or lift it: a standing pattern over the basin.",
    way: "emerges",
    requires: (state, cell) => pressureAt(state, cell) > 0,
    suitability: notApplicable("Rays and basin geometry set the pattern; nothing chooses a site."),
    places,
  },
  fields: {
    statement:
      "Faint rays move little: a node over shallow water holds what lift and fog the rays already gave it, and where the pattern meets a coast it adds to the coast's stress. Over deep water it changes no medium at all.",
    terrain: (state, place) =>
      shoreOf(state, place)
        .filter((cell) => fieldOf(state).ExternalCoastalForcing.get(cell) > 0)
        .map((cell) => ({
          change: "atLeast",
          band: "ExternalCoastalForcing",
          cell,
          value: fieldOf(state).ExternalCoastalForcing.get(cell),
        })),
    water: held("Upwelling"),
    climate: held("FogForcing"),
    cover: notApplicable(
      "It stands on the sea, where nothing grows; fog reaches a coast's cover through the fog forcing it holds."
    ),
    magic: notApplicable(
      "It is a pattern in Pressure's rays, neither a source nor a store; its effect on what the current carries is in its movement."
    ),
  },
  acrossMaps: {
    statement:
      "The captured rays are the refined map's field: they are copied, not re-derived, and the lattice rule grows again over them with its noise, so the pattern resolves into finer nodes. The name moves to the nearest node, or goes if the frame holds none. Rays do not read a round's water.",
    carry: carryWhereItLands,
    realize: notApplicable("The copied rays make the pattern; the seabed need provide nothing."),
    counterpart,
    unrealized: (state, carried) =>
      counterpart(state, carried) >= 0 ? movesTo(counterpart)(state, carried) : goes(),
    settle: stays,
  },
  movement: {
    statement:
      "A confused standing sea slows boats in proportion to its force, and sails and oars both lose headway across it, though it bars nothing. What the current carries is held back in the pattern. It affects nothing on land.",
    roads: notApplicable("Rays run only through connected ocean; no road stands on them."),
    boats: (state, place, cell) =>
      place.cells.includes(cell) ? 1 + (swell * pressureAt(state, cell)) / 1000 : 1,
    drainage: notApplicable("It lies in the sea, past the end of every drainage network."),
    magic: costNear(currentDrag),
    crosses: notApplicable("A swell is something to cross, not a way across anything."),
  },
  others: {
    statement:
      "A lattice lies in the rays of a locus, between the crush zones and fronts those rays make where they strengthen or shoal. A rogue impact on a coast may lie along the same rays.",
    needs: notApplicable(
      "Its test reads Pressure intensity, and the locus that sends the rays may lie beyond this map."
    ),
    excludes: [
      { kind: "crushZone", holds },
      { kind: "upwellingFront", holds },
    ],
    contains: notApplicable("A pattern of nodes on open water holds no other place."),
    pairsWith: [
      { kind: "pressureLocus", holds: within(rayReach) },
      { kind: "crushZone", holds: within(around) },
      { kind: "upwellingFront", holds: within(around) },
      { kind: "rogueWaveImpact", holds: within(around) },
    ],
  },
  people: {
    statement:
      "Where a node crosses shallow water it lifts a little food, and sky-readers and divers study the pattern; otherwise it is a stretch of sea that wears down boats and rations.",
    offers: (state, place) => ({
      food: peakOf(state, place, upwellingAt),
      sanctity: factors.magnitude(state, place) / 4,
    }),
    threatens: (state, place) => [
      {
        hazard: "confused sea",
        reach: 2 * cellSpan(state),
        severity: Math.min(1, swell * peakPressure(state, place)),
      },
    ],
  },
  time: {
    statement:
      "Rays renew continuously, so a lattice holds as long as its basin does; a changed coast or a new shelf shifts its nodes, and an epoch's closing leaves no mark of where they were.",
    fate: () => ({ fate: "persists" }),
  },
  visibility: {
    statement:
      "A lattice shows by the extent of sea it patterns and how far it stands out from fainter rays around it; hardly anyone lives on one, so only a coast town near one carries a small one.",
    ...factors,
    visibleAt: drawnWhen(factors, { magnitude: 0.5, localConditions: 0.3, isolation: 0.2 }),
  },
  naming: {
    statement:
      "Named by the pilots of the nearest coast, after the headland their course turns on; open water gives nothing a lattice's name.",
    namedBy: namingCultureNear,
    takesNameFrom: [{ kind: "headland", holds: within(around) }],
    lendsNameTo: notApplicable("Nothing that stands anywhere stands on a pattern of swell."),
  },
};
