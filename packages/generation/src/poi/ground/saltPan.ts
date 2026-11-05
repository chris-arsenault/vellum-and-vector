// @needsResolution carry: a carried place may not resolve on a finer map (ADR 0009).
import { saltedGround } from "../../canonry/ecologyBiomes";
import { bedDissolvesAbove } from "../../canonry/magicSaltStocks";
import type { GenerationState } from "../../process";
import { parentSpanOf, carryWhereItLands, costNear, counterpartOf } from "../poiCarry";
import { notApplicable, type PoiEntry, type PoiFieldChange, type PoiPlace } from "../poiContract";
import { holds, namingCultureNear, within } from "../poiPlaces";
import { cellsWithin, fieldOf, isLake, moistureAt } from "../poiReads";
import { areaRecord } from "../poiRecords";
import { aloneAmong, attachment, sized, standsOut, weighed } from "../poiVisibilityRules";
import {
  areaOf,
  aroundOf,
  floorOf,
  grownAndNaturalPlaces,
  grownOrNaturalRecord,
  movesOrGoes,
  naturalPanAt,
  panAt,
  parameterOf,
  reservoirPerArea,
  saltingAt,
  spillDepthAt,
  standsOn,
} from "./groundReads";

/** An area at which a pan is half as great as pans get, in square metres. */
const typicalArea = 2_000_000_000;
/** The level a pan's floor is graded to on finer ground, rise over run. */
const panGrade = 0.001;
/** A crust is the flattest going there is, and water is the only thing it lacks. */
const crustGoing = 0.8;
/** The network grows toward a closed floor. */
const drawsDrainage = 0.5;
/** Distance a dry-basin crossing threatens over, in metres, and the salt storm off a bare pan. */
const stormReach = 30_000;

const bareness = (state: GenerationState, cell: number) => {
  const map = fieldOf(state);
  return 1 - Math.min(1, map.TreeCover.get(cell) + map.GrassCover.get(cell));
};
const rankAt = (state: GenerationState, cell: number) =>
  spillDepthAt(state, cell) + saltingAt(state, cell);
const places = grownAndNaturalPlaces("saltPan", ["salt", "pan"], naturalPanAt, rankAt);
const counterpart = counterpartOf(panAt, 1);
const factors = {
  magnitude: sized(areaOf, typicalArea),
  localConditions: standsOut(bareness, (state) => 2 * aroundOf(state)),
  isolation: aloneAmong(places, (state) => 2 * aroundOf(state)),
  cultural: attachment((state) => 2 * aroundOf(state)),
};
const greatness = (state: GenerationState, place: PoiPlace) => factors.magnitude(state, place);
const levelled = (cell: number): PoiFieldChange => ({
  change: "gradientAtMost",
  cell,
  gradient: panGrade,
});

export const saltPan: PoiEntry = {
  id: "saltPan",
  group: "ground",
  name: "Salt pan",
  recognition: {
    distinct:
      "A cell in Salt's pan rule, or a natural pan: dry land below the spill its drainage fills to, nearly level, bare, free of ice, and where rain and snow are under half of what the air can take up, outside any glass flat, since a bed deep enough to fuse is no longer a crust. The closed floor and aridity separate it from any other barren ground; standing water makes it a lake; a salt dust is stock settling, not crust; a killing ground is the brine of the dead by the same system, and a cell may hold both. Salt's rule and the natural pan are one thing, and whether salt or the climate made it is a property.",
    isA: panAt,
  },
  existence: {
    statement:
      "Emerges two ways as one thing: a closed basin in dry country whose water leaves only upward, whether a lake ever stood there or not, and ground where Salt's own material has gathered, a dead lake's bed or a killing's brine. Neither is sited.",
    way: "emerges",
    requires: notApplicable(
      "Its tests read the basin, the climate and Salt's field; nothing has to be there first."
    ),
    suitability: notApplicable(
      "The basin's shape and the climate decide; no process chooses a site."
    ),
    places,
  },
  publication: {
    statement:
      "A pan Salt holds publishes as its rule's class; a natural pan publishes as its own outline, how the climate made it being a property.",
    moment: "magic",
    record: grownOrNaturalRecord(
      "salt",
      "pan",
      areaRecord({ kind: "saltPan", layer: "geology", name: "Salt pan" })
    ),
  },
  fields: {
    statement:
      "A pan's floor is held level. What reaches it evaporates by the climate's own water balance, and over Salt's pan Salt's own writes dry the air and thin what grows. A natural pan carries the salting ecology reads as a pan, so it acts on the living like Salt's own.",
    terrain: (_state, place) => place.cells.map(levelled),
    water: notApplicable("The climate's water balance writes Runoff everywhere (canonry/climate)."),
    climate: notApplicable(
      "Salt's writes dry the air by intensity (saltWrites, declareSaltWrites); a natural pan is dry because the climate is."
    ),
    cover: notApplicable(
      "Ecology's growth reads the Salting band, and a natural pan is bare by its test."
    ),
    /** Over Salt's pan magicLivingFeedback writes Salting by intensity; only a natural pan has no other writer. */
    magic: (state, place) =>
      place.cells
        .filter((cell) => naturalPanAt(state, cell))
        .map((cell) => floorOf("Salting", cell, saltedGround)),
  },
  acrossMaps: {
    statement:
      "A captured pan lands in the basin the refined network keeps as a sink. The floor of that bowl must be level on finer ground, since relief would otherwise grow it into a plain. If a round's water fills the cell the pan moves to the nearest dry floor, and with none near it goes: the wetter refined basin has made a lake.",
    carry: carryWhereItLands,
    realize(state, carried) {
      const bowl = state.regional.network?.bowl;
      if (!bowl) return [];
      return cellsWithin(state, carried.cell, parentSpanOf(state))
        .filter((cell) => bowl[cell] > 0)
        .map(levelled);
    },
    counterpart,
    unrealized: movesOrGoes(counterpart),
    settle: (state, carried) =>
      isLake(state, carried.cell) ? movesOrGoes(counterpart)(state, carried) : { outcome: "keep" },
    schedule: notApplicable("A pan does nothing at refinement's other points."),
  },
  movement: {
    statement:
      "A crust is the easiest going in dry country and the drainage network grows toward its floor. Brine pools there by Salt's seepage, and wind takes bed from it as dust, by the stock's own carrier.",
    roads: costNear(crustGoing),
    boats: notApplicable("Its test requires dry ground; a filled basin is the lake entry."),
    drainage: costNear(drawsDrainage),
    magic: notApplicable(
      "Salt's stock advance pools brine at any pit and lifts bare bed on the wind (seepBrine, weatherBed), wherever a pan is or is not."
    ),
    links: notApplicable("A pan joins no two cells for walkers."),
    crosses: notApplicable(
      "It is open flat ground and bars nothing, so there is no barrier it opens."
    ),
  },
  others: {
    statement:
      "A pan may be what a lake left, and a terminal lake's shore grades into one. Dust blows off it downwind; a bed that deepens becomes glass; salt miners stand on it; an oasis at its edge is the only water near.",
    needs: notApplicable("A natural pan needs only its basin and climate, both in its test."),
    excludes: [
      { kind: "lake", holds: standsOn },
      { kind: "glassFlat", holds: (_state, a, b) => b.cells.includes(a.anchor) },
    ],
    contains: [
      { kind: "mine", holds },
      { kind: "killingGround", holds },
    ],
    pairsWith: [
      { kind: "saltDust", holds: within((state) => 3 * aroundOf(state)) },
      { kind: "lake", holds: within(aroundOf) },
      { kind: "oasis", holds: within((state) => 2 * aroundOf(state)) },
      { kind: "glassFlat", holds: within(aroundOf) },
    ],
  },
  people: {
    statement:
      "Salt is wealth: it keeps food and travels far, so a pan draws trade across country that offers nothing else. It gives no water, and a dry wind off it carries a storm of what it is made of.",
    offers: (state, place) => ({
      materials: 0.4 + 0.6 * greatness(state, place),
      trade: greatness(state, place),
    }),
    threatens(state, place) {
      const crusted = Math.min(1, saltingAt(state, place.anchor) + greatness(state, place) / 2);
      return [{ hazard: "salt storm and thirst", reach: stormReach, severity: crusted }];
    },
  },
  time: {
    statement:
      "A pan lasts as long as the climate keeps it dry. A bed that deepens fuses into a glass flat; a climate wet enough to dissolve the crust fills a basin to a lake, and otherwise washes the pan away.",
    fate(state, place) {
      const fused = reservoirPerArea(state, "salt", "bed", place.anchor);
      if (fused >= (parameterOf(state, "salt", "glassBed") ?? Infinity))
        return { fate: "becomes", kind: "glassFlat" };
      if (moistureAt(state, place.anchor) <= bedDissolvesAbove / 1000) return { fate: "persists" };
      return spillDepthAt(state, place.anchor) > 0
        ? { fate: "becomes", kind: "lake" }
        : { fate: "ends" };
    },
  },
  visibility: {
    statement:
      "A pan shows by its area and by how bare it lies against the country around it: a small white floor in green hills stands out where the same floor in a desert of them does not. A town that lives on its salt carries it.",
    ...factors,
    importance: weighed(factors, { magnitude: 0.5, localConditions: 0.35, isolation: 0.15 }),
  },
  naming: {
    statement:
      "Named by the people who cross it or cut it; it often keeps the name of the lake it was, and towns and works on its salt take its name.",
    namedBy: namingCultureNear,
    takesNameFrom: [{ kind: "lake", holds: within(aroundOf) }],
    lendsNameTo: [
      { kind: "mine", holds },
      { kind: "settlement", holds: within(aroundOf) },
    ],
  },
};
