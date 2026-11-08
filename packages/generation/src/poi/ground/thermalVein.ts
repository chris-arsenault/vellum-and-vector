// @needsResolution carry: a carried place may not resolve on a finer map (ADR 0009).
import { MapScale } from "@atlas/domain";
import { mapScale } from "../../worldSignificance";
import type { GenerationState } from "../../process";
import { tappingReach } from "../../societyColdAge";
import { carryWhereItLands, costNear, counterpartOf } from "../poiCarry";
import { notApplicable, type PoiEntry, type PoiPlace } from "../poiContract";
import { holds, namingCultureNear, rulePlaces, within } from "../poiPlaces";
import { cellSpan, celsiusAt, iceAt, magicValue, shareAround } from "../poiReads";
import { ruleRecord } from "../poiRecords";
import { aloneAmong, attachment, sized, standsOut, weighed } from "../poiVisibilityRules";
import { aroundOf, lengthOf, movesOrGoes, sealedAt, veinAt } from "./groundReads";

/** A course length at which a vein is half as great as veins get, a regional conduit, in metres. */
const typicalLength = MapScale.length(0.025);
/** How far a burst of steam and gas reaches from the fracture, in metres. */
// length-unit: fraction
const burstReach = 0.0005;
/** Water finds fractured rock an easier way down than sound rock. */
const fracturedDrainage = 0.8;
/** Going over ground kept thawed in frost country is easier than over the frost around it. */
const thawedGoing = 0.85;

const fireAt = (state: GenerationState, cell: number) =>
  magicValue(state, "fire", "intensity", cell);
const strengthOf = (state: GenerationState, place: PoiPlace) =>
  Math.min(1, fireAt(state, place.anchor) / 1000);
const reachOf = (state: GenerationState) =>
  Math.max(aroundOf(state), mapScale(state).resolveMeasure(tappingReach));
const places = rulePlaces("thermalVein", "fire", "vein");
const counterpart = counterpartOf(veinAt, 1);
const factors = {
  magnitude: (state: GenerationState, place: PoiPlace) =>
    (sized(lengthOf, typicalLength)(state, place) + strengthOf(state, place)) / 2,
  localConditions: standsOut(fireAt, aroundOf),
  isolation: aloneAmong(places, (state) => 2 * aroundOf(state)),
  cultural: attachment(reachOf),
};
/** Ground kept clear of ice with ice beside it: a thawed way through frozen country. */
const thawedThrough = (state: GenerationState, cell: number) =>
  iceAt(state, cell) <= 0 && shareAround(state, cell, (next) => iceAt(state, next) > 0) > 0;

export const thermalVein: PoiEntry = {
  id: "thermalVein",
  group: "ground",
  name: "Thermal vein",
  recognition: {
    distinct:
      "A cell of Fire's vein rule: strong Fire intensity held in rock whose fracture conductance is high, grown as a course along the conduit. Fracture is what separates it: a thawed halo has the warmth with little fracture, a hot spring has the heat with wet ground or standing water and needs no fracture, a Fire core is a located source and not its course, and a mine is a work on a vein, not the ore. Only the system's rule decides; no size enters.",
    isA: veinAt,
  },
  existence: {
    statement:
      "Emerges as Fire propagates: conduits open along fractures from heat maxima under land, and a vein is where the ore stands in the rock while the conduit is fed. With Fire disabled there are none, since nothing else in the data records ore in rock.",
    way: "emerges",
    requires: notApplicable(
      "The vein rule tests Fire's own intensity and the fracture it runs in; nothing has to be there first."
    ),
    suitability: notApplicable(
      "Fire's propagation grows veins; no process chooses a cell for one."
    ),
    places,
  },
  publication: {
    statement: "Every vein Fire grows publishes as its rule's class, along Fire's own course.",
    moment: "magic",
    record: ruleRecord("fire", "vein"),
  },
  fields: {
    statement:
      "A vein changes the fields through Fire's writes by intensity, which act wherever Fire stands whether or not a vein is there, so the place adds nothing of its own.",
    terrain: notApplicable(
      "Magic's rock writes harden the rock by Fire's intensity (magicFeedback on the world, declareRockWrites in refinement)."
    ),
    water: notApplicable(
      "The river warmth process carries Fire's heat forcing down every river (riverWarmth)."
    ),
    climate: notApplicable(
      "magicThermalFeedback writes every system's heat and melt to ExternalHeatForcing and Temperature."
    ),
    cover: notApplicable("magicLivingFeedback writes Quickening by Fire's intensity."),
    magic: notApplicable(
      "Conduit opening writes FractureConductance by Fire's intensity (magicFeedback, declareRockWrites), and the conduit's stock is Fire's own."
    ),
  },
  acrossMaps: {
    statement:
      "A captured vein lands on the refined map, and the child's Fire regrows it along the fracture it inherits; if no vein develops within a parent span of where it lands, the vein goes, because the ore's reach on finer ground is Fire's to decide.",
    carry: carryWhereItLands,
    realize: notApplicable(
      "Conduit opening (declareRockWrites) keeps the child's fractures open where Fire stands."
    ),
    counterpart,
    unrealized: movesOrGoes(counterpart),
    settle: notApplicable("Rock does not move with a round's water; Fire re-grows the course."),
    schedule: notApplicable("A vein does nothing at refinement's other points."),
  },
  movement: {
    statement:
      "Water follows open fractures down. In frost country the thawed strip is easier going than the ice beside it, and gives a route across a glacier's edge.",
    roads: (state, place) =>
      place.cells
        .filter((cell) => celsiusAt(state, cell) <= 0 && iceAt(state, cell) <= 0)
        .map((cell) => ({ cell, factor: thawedGoing })),
    boats: notApplicable("A vein is in rock; a river crossing it carries boats as before."),
    drainage: costNear(fracturedDrainage),
    magic: notApplicable(
      "Fire's fracture propagation already runs along FractureConductance wherever it is open (magicPropagation)."
    ),
    links: notApplicable("A vein joins no two cells for walkers."),
    crosses: (state, place) => (place.cells.some((c) => thawedThrough(state, c)) ? ["ice"] : []),
  },
  others: {
    statement:
      "A vein runs from a Fire core and feeds what lies along it: hot springs where it meets wet ground, mines cut into it, forges that crack its cores. It is the rock a vent would be if the sea covered it, so the two never share a cell. Sealed, it is a basalt flat.",
    needs: notApplicable(
      "Its rule already reads the Fire that feeds it, and no other kind of place has to stand first."
    ),
    excludes: [{ kind: "vent", holds: (_state, a, b) => b.cells.includes(a.anchor) }],
    contains: [{ kind: "mine", holds }],
    pairsWith: [
      { kind: "spring", holds: within(aroundOf) },
      { kind: "forge", holds: within(reachOf) },
      { kind: "thawedHalo", holds: within(aroundOf) },
    ],
  },
  people: {
    statement:
      "A vein offers ore and fire cores to those who can reach it, and warmth a cold-age band can live on; opened further, it bursts steam and gas along the fracture.",
    offers(state, place) {
      const strength = strengthOf(state, place);
      return { materials: strength, power: strength / 2 };
    },
    threatens: (state, place) => [
      {
        hazard: "steam and gas burst",
        reach: mapScale(state).length(burstReach),
        severity: strengthOf(state, place),
      },
    ],
  },
  time: {
    statement:
      "A vein lasts while its conduit is fed. When the conduit has carried its budget it seals and goes cold, leaving a scar of sinter and basalt over spent ore that the crust carries and erosion may exhume; new strain can reopen it, and the same fracture is a vein again.",
    fate: (state, place) =>
      sealedAt(state, "fire", place.anchor)
        ? { fate: "ends", leaves: "basaltFlat" }
        : { fate: "persists" },
  },
  visibility: {
    statement:
      "A vein shows by its course's length and strength together, and by standing hotter than the country around it. A short vein a town depends on shows for that town.",
    ...factors,
    importance: weighed(factors, { magnitude: 0.5, localConditions: 0.3, isolation: 0.2 }),
  },
  naming: {
    statement:
      "Named by the people who live within reach of it, for the mine or town that works it; a vein with no one near it goes unnamed.",
    namedBy: namingCultureNear,
    takesNameFrom: notApplicable(
      "A vein is found and named on its own account; others name after it."
    ),
    lendsNameTo: [
      { kind: "mine", holds: within((state) => cellSpan(state)) },
      { kind: "settlement", holds: within(reachOf) },
    ],
  },
};
