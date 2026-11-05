// @needsResolution carry: a carried place may not resolve on a finer map (ADR 0009).
import type { GenerationState } from "../../process";
import { carryWhereItLands, costNear, counterpartOf, goes, movesTo } from "../poiCarry";
import { notApplicable, type PoiEntry, type PoiFieldChange, type PoiPlace } from "../poiContract";
import { rulePlaces, within } from "../poiPlaces";
import { ruleRecord } from "../poiRecords";
import { fieldOf, isSea, magicRule } from "../poiReads";
import { aloneAmong, attachment, sized, standsOut, weighed } from "../poiVisibilityRules";
import { extentOf, namedFromShore, near, pressureAt, pressureLength, stormAt } from "./seaShared";

/** Length at which a wake is half as great as wakes get: half a preset wake's reach. */
const typicalLength = 350_000;
/** The most wave exposure the still layer lets stand on it (per-mille). */
const stillExposure = 500;
/** Boats' cost on the calm water of a wake. */
const calmWater = 0.85;
/** The still layer holds back what the current carries. */
const stillCurrent = 1.5;

const isA = magicRule("pressure", "wake");
const anomalyAt = (state: GenerationState, cell: number) =>
  fieldOf(state).SeaSurfaceAnomaly.get(cell);
const places = rulePlaces("ancientWake", "pressure", "wake");
/** The sea around a wake that bears on it: 100 km. */
const around = near(100_000);
const wakeReach = (state: GenerationState) => pressureLength(state, "wakeDistance", typicalLength);
const counterpart = counterpartOf(isA, 2);

const factors = {
  magnitude: sized(extentOf, typicalLength),
  localConditions: standsOut(anomalyAt, around),
  isolation: aloneAmong(places, around),
  cultural: attachment(wakeReach),
};

/** A wake lies calm on the water: the still layer holds waves down along its track. */
const stilled = (state: GenerationState, place: PoiPlace): readonly PoiFieldChange[] =>
  place.cells.map((cell) => ({
    change: "atMost",
    band: "WaveExposure",
    cell,
    value: stillExposure,
  }));

export const ancientWake: PoiEntry = {
  id: "ancientWake",
  group: "sea",
  name: "Ancient wake",
  recognition: {
    distinct:
      "A member of Pressure's wake rule: the wake channel is set, on a cell where intensity remains. Only a wake's own ray writes that channel, a seeded path that wanders and stops at the first land. A crush zone is decided by intensity alone and an upwelling front by lift; a wake is a track, warm where a front is cold.",
    isA,
  },
  existence: {
    statement:
      "Sited by the Pressure system: it chooses wake origins by seeded priority across open ocean, at a prevalence set by ocean area, and traces each one out as a wandering line. The line is the record; the rule marks the water it crossed.",
    way: "sited",
    requires: isSea,
    suitability: notApplicable(
      "The system takes the highest seeded priority among ocean cells, with no preference among them."
    ),
    places,
  },
  publication: {
    statement: "Every wake publishes as the system's class, along the water it crossed.",
    moment: "magic",
    record: ruleRecord("pressure", "wake"),
  },
  fields: {
    statement:
      "A wake leaves a warm, still layer along its track. It holds waves down on the water and warms the surface, and storms are born on the sharp edge it makes against cooler sea.",
    terrain: notApplicable(
      "A wake is a layer in the water: it stops at the first land and reaches no bed."
    ),
    water: stilled,
    climate: notApplicable(
      "The ocean feedback writes its warming and storm energy for the climate pass, and replaces what an earlier pass applied."
    ),
    cover: notApplicable(
      "Open water has no cover; aquatic productivity already reads the warmth the layer brings."
    ),
    magic: notApplicable("The wake's own ray writes its channel."),
  },
  acrossMaps: {
    statement:
      "A refined map inherits the captured wake channel and does not retrace it, so the track lands as the parent drew it. If it holds no wake water within reach, the wake has fallen between the finer map's cells and goes.",
    carry: carryWhereItLands,
    realize: notApplicable(
      "The captured channel is the wake; the finer ground need not provide it."
    ),
    counterpart,
    unrealized: (state, carried) =>
      counterpart(state, carried) >= 0 ? movesTo(counterpart)(state, carried) : goes(),
    settle: notApplicable("A round's water does not move a captured track."),
    schedule: notApplicable("A captured wake does nothing to a refinement's schedule."),
  },
  movement: {
    statement:
      "Boats pay less on its calm water, so a wake is a road across open sea, until the storm season. Current-borne magic stalls in the still layer; Pressure's rays are traced by geometry and do not read this cost.",
    roads: notApplicable(
      "A wake ends at the first land, so it has no ground for a road to pay on."
    ),
    boats: costNear(calmWater),
    drainage: notApplicable("It lies in the sea, beyond where the drainage network ends."),
    magic: { current: costNear(stillCurrent) },
    links: notApplicable("A wake joins no two cells."),
    crosses: notApplicable("It crosses no barrier; it is water like the rest, only calmer."),
  },
  others: {
    statement:
      "A wake needs no locus, because its ray has its own origin. A wake and an upwelling front cannot share a cell, because the moved-water rule makes it one or the other. Harbours at a wake's landward end gain its calm road.",
    needs: notApplicable("A wake starts from its own origin and needs no other place."),
    excludes: [{ kind: "upwellingFront", holds: (_state, a, b) => b.cells.includes(a.anchor) }],
    contains: notApplicable("A track of still water holds nothing that stands."),
    pairsWith: [{ kind: "harbour", holds: within(around) }],
  },
  people: {
    statement:
      "A wake is a calm way for ships and a holy line to the peoples who read it. Its warm edge raises storms, and they break on those who trusted it in the wrong season.",
    offers: (state, place) => ({
      trade: 1 - calmWater + factors.magnitude(state, place) / 2,
      sanctity: factors.magnitude(state, place) / 2,
    }),
    threatens(state, place) {
      const storm = stormAt(state, place.anchor);
      return storm > 0 ? [{ hazard: "wake storm", reach: around(state), severity: storm }] : [];
    },
  },
  time: {
    statement:
      "A wake's origins are seeded, so it is re-traced with each evaluation and its path holds while the ocean does; a new coast cuts it short. When Pressure no longer leaves intensity on it, the track goes without a trace.",
    fate: (state, place) =>
      pressureAt(state, place.anchor) > 0 ? { fate: "persists" } : { fate: "ends" },
  },
  visibility: {
    statement:
      "A wake shows by its length and by how far it stands apart from others, because it is read as a line across a chart; its warmth is hard to see against the sea. Sailors who use one carry it from far along its track.",
    ...factors,
    importance: weighed(factors, { magnitude: 0.6, localConditions: 0.1, isolation: 0.3 }),
  },
  naming: {
    statement: "Named only by peoples whose ships reach it; the wakes of empty oceans go unnamed.",
    namedBy: namedFromShore(wakeReach),
    takesNameFrom: notApplicable("A wake is older than the shore's names and takes none of them."),
    lendsNameTo: notApplicable("Nothing built stands on a wake to take its name."),
  },
};
