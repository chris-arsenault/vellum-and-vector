import type { GenerationState } from "../../process";
import { seatCaps } from "../../regional/seats";
import type { RegionalState } from "../../regional/state";
import { carryWhereItLands, costNear, stays } from "../poiCarry";
import { notApplicable, type PoiEntry, type PoiFieldChange, type PoiPlace } from "../poiContract";
import { holdsRecord, namingCultureNear, recordPlaces, within } from "../poiPlaces";
import {
  cellSpan,
  cellsWithin,
  celsiusAt,
  gap,
  heldFor,
  inhabited,
  isLand,
  isRiver,
  sedimentAt,
  shareAround,
  slopeAt,
} from "../poiReads";
import { aloneAmong, drawnWhen, sized } from "../poiVisibilityRules";

/** The ground-grade above which a settlement cannot stand, as regional siting holds it. */
const steepestSite = 0.12;
/** The cold below which no one settles, in degrees. */
const coldestSite = -5;
/** People at which a settlement is half as great as settlements get. */
const typicalPeople = 5000;
/** A settlement draws roads to it across this many cells around it. */
const drawnCells = 3;
/** The cost of travel on the worn ground around a settlement. */
const wornGround = 0.6;

const places = recordPlaces(
  "settlement",
  (f) => f.kind === "settlement" && f.layerId === "settlements" && inhabited(f)
);
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
/** The relief caps the regional seats hold, read once per state from the seat rule itself. */
const caps = (state: RegionalState) =>
  heldFor(state, "seatCaps", () => {
    const cap = new Float64Array(state.physical.map.mesh.count);
    seatCaps(state, cap);
    return cap;
  });

export const settlement: PoiEntry = {
  id: "settlement",
  group: "settlements",
  name: "Settlement",
  recognition: {
    distinct:
      "A published inhabited place: a record society or refinement sited, with its people. A ruin is the same record no longer inhabited; a village and a city are one kind at different sizes.",
    isA,
  },
  existence: {
    statement:
      "Sited by people: at world scale by the society simulation's capacity-weighted seeds, on a refined map by keeping captured seats and proposing villages that win a large enough hinterland.",
    way: "sited",
    requires: (state, cell) =>
      isLand(state, cell) &&
      slopeAt(state, cell) <= steepestSite &&
      celsiusAt(state, cell) >= coldestSite,
    /** Flat ground beside water with soil to farm. */
    suitability(state, cell) {
      const flat = 1 - Math.min(1, slopeAt(state, cell) / steepestSite),
        water = Math.max(
          isRiver(state, cell) ? 1 : 0,
          shareAround(state, cell, (next) => !isLand(state, next))
        ),
        soil = Math.min(1, sedimentAt(state, cell));
      return (flat + water + soil) / 3;
    },
    places,
  },
  fields: {
    statement:
      "People change the ground around them: land is cleared and turned for food; the ground a seat stands on is graded through its realization on a refined map.",
    terrain: notApplicable(
      "Grading a seat is its refinement rule below; a world cell is too coarse to hold one."
    ),
    water: notApplicable(
      "Taking water for use is the work of irrigation and dams, which are their own entries."
    ),
    climate: notApplicable("A settlement's warmth is below what the climate field resolves."),
    cover: notApplicable("Clearing is the clearance entry, sited by the same people."),
    magic: notApplicable(
      "People's tenure feeds magic through the society channels, not through the seat."
    ),
  },
  acrossMaps: {
    statement:
      "A captured settlement keeps its place on the refined map; its footprint holds the relief's gradient down so usable ground develops there even in hills, and after each round's water it moves to the best ground beside it.",
    carry: carryWhereItLands,
    realize(state, carried): readonly PoiFieldChange[] {
      const cap = caps(state);
      return cellsWithin(state, carried.cell, around(state))
        .filter((cell) => cap[cell] > 0)
        .map((cell) => ({ change: "gradientAtMost", cell, gradient: cap[cell] }));
    },
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
  },
  movement: {
    statement:
      "Routes run between settlements and wear the ground near them; a river seat draws the drainage network to its channel.",
    roads: (state, place, cell) =>
      costNear(wornGround, drawnCells * cellSpan(state))(state, place, cell),
    boats: notApplicable("Boats reach a settlement through its harbour, which is its own entry."),
    drainage: notApplicable("A river seat's corridor is applied through its refinement cause."),
    magic: (state, place, cell) => costNear(0.8)(state, place, cell),
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
    visibleAt: drawnWhen(factors, { magnitude: 0.6, localConditions: 0.1, isolation: 0.3 }),
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
