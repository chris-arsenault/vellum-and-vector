import type { GenerationState } from "../../process";
import { gradeSeats } from "../../regional/grading";
import { regionalSpan } from "../../regional/lattice";
import { scaleAround } from "../../regional/network";
import { placesEnabled } from "../../regional/places";
import {
  drawChannelsToSeats,
  knownSeats,
  seatCaps,
  settleSeats,
  usableSlope,
} from "../../regional/seats";
import type { RegionalState } from "../../regional/state";
import { carryWhereItLands, costNear, stays } from "../poiCarry";
import { notApplicable, type PoiEntry, type PoiPlace } from "../poiContract";
import { holdsRecord, namingCultureNear, within } from "../poiPlaces";
import {
  cellSpan,
  celsiusAt,
  gap,
  isLand,
  isRiver,
  sedimentAt,
  shareAround,
  slopeAt,
} from "../poiReads";
import { aloneAmong, sized } from "../poiVisibilityRules";
import { communityRecord, settlementPlaces } from "./communityRecords";
import { weighedPlace } from "./settlementRecords";

/** The cold below which no one settles, in degrees. */
const coldestSite = -5;
/** People at which a settlement is half as great as settlements get. */
const typicalPeople = 5000;
/** The ground a settlement's traffic wears around it, in metres, and what travel costs on it. */
const wornReach = 2000,
  wornGround = 0.6;
/** What people carrying stock save on the ways through a settlement. */
const carriage = 0.8;
/** A river seat draws a channel to itself: the ground around it is cheaper to run through. */
const seatCorridor = 0.5;

const places = settlementPlaces;
const isA = holdsRecord("settlement", places);
const peopleOf = (_state: GenerationState, place: PoiPlace) =>
  Number(place.feature?.attributes.population) || 0;
const roleOf = (place: PoiPlace) => String(place.feature?.attributes.settlementRole ?? "");
const around = (state: GenerationState) => 8 * cellSpan(state);
const roleWeight: Record<string, number> = { capital: 1, regionalCapital: 0.75, marketTown: 0.5 };
const factors = {
  magnitude: sized(peopleOf, typicalPeople),
  /** Its share of the people in the settlements around it: a town in empty country holds them all. */
  localConditions(state: GenerationState, place: PoiPlace) {
    const own = peopleOf(state, place),
      local = places(state)
        .filter((other) => gap(state, other.anchor, place.anchor) <= around(state))
        .reduce((sum, other) => sum + peopleOf(state, other), 0);
    return local > 0 ? own / local : 0;
  },
  isolation: aloneAmong(places, (state) => 2 * around(state)),
  cultural: (_state: GenerationState, place: PoiPlace) => roleWeight[roleOf(place)] ?? 0,
};

export const settlement: PoiEntry = {
  id: "settlement",
  group: "settlements",
  name: "Settlement",
  recognition: {
    distinct:
      "An inhabited place: a community of the society simulation, a seat the parent left, or a village this map proposed. A ruin is the same place no longer inhabited; a village and a city are one kind at different sizes.",
    isA,
  },
  existence: {
    statement:
      "Sited by people: at world scale by the society simulation's capacity-weighted seeds, on a refined map by keeping captured seats and proposing villages that win a large enough hinterland.",
    way: "sited",
    requires: (state, cell) =>
      isLand(state, cell) &&
      slopeAt(state, cell) <= usableSlope &&
      celsiusAt(state, cell) >= coldestSite,
    /** Flat ground beside water with soil to farm. */
    suitability(state, cell) {
      const flat = 1 - Math.min(1, slopeAt(state, cell) / usableSlope),
        water = Math.max(
          isRiver(state, cell) ? 1 : 0,
          shareAround(state, cell, (next) => !isLand(state, next))
        ),
        soil = Math.min(1, sedimentAt(state, cell));
      return (flat + water + soil) / 3;
    },
    places,
  },
  publication: {
    statement:
      "Each community the map shows publishes as its record, with its people, livelihoods and rank; a seat the parent recorded stays as that record, and a community already drawn stays that subject's finer drawing. A refined map's seats publish before their ground is read, its villages once accepted.",
    moment: "society",
    record: communityRecord,
  },
  fields: {
    statement:
      "People change the ground around them, but across a hinterland, not at the seat: the seat itself is graded through its refinement steps.",
    terrain: notApplicable(
      "Grading a seat is its refinement step below; a world cell is too coarse to hold one."
    ),
    water: notApplicable(
      "Taking water for use is the work of irrigation and dams, which are their own entries."
    ),
    climate: notApplicable("A settlement's warmth is below what the climate field resolves."),
    cover: notApplicable(
      "Clearing is written across each hinterland by regional/society's declareFields and by the simulation's clearance works."
    ),
    magic: notApplicable(
      "People's tenure is written by societyRecord's recordSeats, which Hallowed reads; the seat declares nothing further."
    ),
  },
  acrossMaps: {
    statement:
      "A captured settlement keeps its place on the refined map; its footprint holds the relief's gradient down so usable ground develops there even in hills, a river seat draws the network to it, and after each round's water it moves to the best ground beside it.",
    carry: carryWhereItLands,
    realize: notApplicable("Its footprint's gradient caps are the schedule's caps step below."),
    counterpart: (state, carried) =>
      state.regional.evidence?.seats.find((seat) => seat.featureId === carried.feature.id)?.cell ??
      carried.cell,
    unrealized: stays,
    settle(state, carried) {
      const seat = state.regional.evidence?.seats.find((s) => s.featureId === carried.feature.id);
      return seat && seat.cell !== carried.cell
        ? { outcome: "move", cell: seat.cell }
        : { outcome: "keep" };
    },
    /**
     * A seat is a cause in every round: read from its captured position every run, so a seat an
     * earlier refinement moved is re-sited from the same evidence. The written relief is graded
     * under every seat, because the cap alone is undone by later steps.
     */
    schedule: {
      kind: "settlement",
      read(state, evidence) {
        evidence.seats.push(...knownSeats(state));
      },
      influence(state, cost) {
        const span = regionalSpan(state);
        for (const seat of state.regional.evidence!.seats)
          if (seat.situation === "river")
            scaleAround(state, cost, seat.cell, 2 * span, seatCorridor);
      },
      support: (state) => drawChannelsToSeats(state),
      caps: (state, cap) => seatCaps(state, cap),
      restore: (state) => gradeSeats(state),
      respond(state: RegionalState) {
        const domains = state.regional.input.domains;
        if (domains.includes("physical") && placesEnabled(domains)) settleSeats(state);
      },
    },
  },
  movement: {
    statement:
      "Routes run between settlements and wear the ground near them, and those who carry stock travel more easily through them. A river seat's draw on the drainage is its schedule's influence step, which reaches every seat, proposed ones aside.",
    roads: costNear(wornGround, wornReach),
    boats: notApplicable("Boats reach a settlement through its harbour, which is its own entry."),
    drainage: notApplicable("A river seat's corridor is its schedule's influence step."),
    magic: { people: costNear(carriage) },
    links: notApplicable("A settlement joins nothing by itself; a door or a road does that."),
    crosses: notApplicable("A settlement is an end of routes, not a way over a barrier."),
  },
  others: {
    statement:
      "Settlements compete for hinterland and stand off from one another; fords, mills, harbours and shrines stand beside them, and a settlement may take the name of the summit above it.",
    needs: notApplicable(
      "A settlement needs only ground it can stand on, which its requirement states."
    ),
    excludes: [{ kind: "lake", holds: (_state, a, b) => b.cells.includes(a.anchor) }],
    contains: [
      { kind: "shrine", holds: within((state) => cellSpan(state)) },
      { kind: "forge", holds: within((state) => cellSpan(state)) },
      { kind: "archive", holds: within((state) => cellSpan(state)) },
    ],
    pairsWith: [
      { kind: "ford", holds: within(around) },
      { kind: "bridge", holds: within(around) },
      { kind: "mill", holds: within(around) },
      { kind: "harbour", holds: within(around) },
    ],
  },
  people: {
    statement:
      "A settlement gives its people shelter, a market and defence in proportion to its size and rank; it is itself what others read to weigh people's attachment to a place.",
    offers(state, place) {
      const great = factors.magnitude(state, place);
      return { trade: great, defence: Math.max(great, factors.cultural(state, place)) };
    },
    threatens: notApplicable(
      "Its dangers to others are events and sieges, published as their own places."
    ),
  },
  time: {
    statement: "A settlement grows and shrinks across human eras; abandoned, it becomes a ruin.",
    fate(state, place) {
      const inhabited = place.feature?.attributes.status !== "abandoned";
      return inhabited ? { fate: "persists" } : { fate: "becomes", kind: "ruin" };
    },
  },
  visibility: {
    statement:
      "A settlement shows by its rank and its people; a capital always outranks size, and a small town alone in empty country shows sooner than the same town among many.",
    ...factors,
    importance: weighedPlace(factors, { magnitude: 0.6, localConditions: 0.1, isolation: 0.3 }),
  },
  naming: {
    statement: "Named by its own people, and it may take the name of a landmark beside it.",
    namedBy: namingCultureNear,
    takesNameFrom: [
      { kind: "summit", holds: within((state) => 6 * cellSpan(state)) },
      { kind: "waterfall", holds: within(around) },
    ],
    lendsNameTo: [{ kind: "ruin", holds: (_state, a, b) => a.anchor === b.anchor }],
  },
};
