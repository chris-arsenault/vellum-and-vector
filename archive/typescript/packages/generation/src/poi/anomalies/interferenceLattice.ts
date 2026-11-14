// @needsResolution carry: a carried place may not resolve on a finer map (ADR 0009).
import { MapScale } from "@atlas/domain";
import { mapScale } from "../../worldSignificance";
import type { GenerationState } from "../../process";
import { carryWhereItLands, costNear, counterpartOf, goes, movesTo, stays } from "../poiCarry";
import { notApplicable, type PoiEntry, type PoiPlace } from "../poiContract";
import { namingCultureNear, rulePlaces, within } from "../poiPlaces";
import { ruleRecord } from "../poiRecords";
import { magicRule, upwellingAt } from "../poiReads";
import { aloneAmong, attachment, sized, standsOut, weighed } from "../poiVisibilityRules";
import { countryOf, intensityOf, magicFieldOf, peakOf, weightedArea } from "./anomalyReads";

/** Square metres of crossing rays at which a lattice is half as great as lattices get. */
const typicalArea = MapScale.area(0.00125);
/** What a confused sea adds to a boat's passage, per unit of intensity share. */
const swell = 2;
/** How much a standing pattern slows what the current carries through it. */
const currentDrag = 1.25;
/** The reach of Pressure's rays if the system states none. */
// length-unit: fraction
const defaultRayDistance = 0.5;
/** A lattice's country, and how far a confused sea troubles the water past it, in metres. */
const countryMetres = MapScale.length(0.01),
  confusedMetres = MapScale.length(0.0025);

const pressureAt = intensityOf("pressure");
const isA = magicRule("pressure", "lattice");
const places = rulePlaces("interferenceLattice", "pressure", "lattice");
const around = countryOf(countryMetres);
const rayReach = (state: GenerationState) =>
  magicFieldOf(state, "pressure")?.definition.parameters.rayDistance ??
  mapScale(state).length(defaultRayDistance);
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

export const interferenceLattice: PoiEntry = {
  id: "interferenceLattice",
  group: "anomalies",
  name: "Interference lattice",
  recognition: {
    distinct:
      "A cell of Pressure's lattice rule, where intensity and the rule's own noise both pass its levels. The noise term makes it a pattern of nodes, not a solid sheet. A crush zone is the same rays at a far higher intensity with no pattern; a front needs ocean and upwelling; a wake reads the wake channel and a locus is the rays' source.",
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
  publication: {
    statement:
      "Every connected pattern publishes as Pressure's lattice class, outlined by coverage.",
    moment: "magic",
    record: ruleRecord("pressure", "lattice"),
  },
  fields: {
    statement:
      "Faint rays move little, and what they move they move by intensity across the whole basin: lift and fog over shoals, stress on a coast. The pattern as a place adds nothing to a medium.",
    terrain: notApplicable("`magicCoastalFeedback` writes coastal forcing from Pressure's rays."),
    water: notApplicable("`magicOceanFeedback` writes upwelling from Pressure's rays."),
    climate: notApplicable("`magicOceanFeedback` writes fog forcing from Pressure's rays."),
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
    schedule: notApplicable("The copied rays are all a lattice brings to a refinement."),
  },
  movement: {
    statement:
      "A confused standing sea slows boats in proportion to its force, and sails and oars both lose headway across it, though it bars nothing. What the current carries is held back in the pattern. It affects nothing on land.",
    roads: notApplicable("Rays run only through connected ocean; no road stands on them."),
    boats: (state, place) =>
      place.cells.map((cell) => ({ cell, factor: 1 + (swell * pressureAt(state, cell)) / 1000 })),
    drainage: notApplicable("It lies in the sea, past the end of every drainage network."),
    magic: { current: costNear(currentDrag) },
    links: notApplicable("A swell joins nothing."),
    crosses: notApplicable("A swell is something to cross, not a way across anything."),
  },
  others: {
    statement:
      "A lattice lies in the rays of a locus, between the crush zones and fronts those rays make where they strengthen or shoal. A rogue impact on a coast may lie along the same rays.",
    needs: notApplicable(
      "Its test reads Pressure intensity, and the locus that sends the rays may lie beyond this map."
    ),
    excludes: notApplicable(
      "A cell carries a share of each class Pressure grows there, so a pattern can overlap a crush zone or a front."
    ),
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
        reach: mapScale(state).resolveMeasure(confusedMetres),
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
    importance: weighed(factors, { magnitude: 0.5, localConditions: 0.3, isolation: 0.2 }),
  },
  naming: {
    statement:
      "Named by the pilots of the nearest coast, after the headland their course turns on; open water gives nothing a lattice's name.",
    namedBy: namingCultureNear,
    takesNameFrom: [{ kind: "headland", holds: within(around) }],
    lendsNameTo: notApplicable("Nothing that stands anywhere stands on a pattern of swell."),
  },
};
