import type { GenerationState } from "../../process";
import { landscapeMinimumArea } from "../../worldSignificance";
import {
  carryWhereItLands,
  costNear,
  counterpartOf,
  goes,
  movesTo,
  parentSpanOf,
} from "../poiCarry";
import { notApplicable, type PoiEntry, type PoiFieldChange, type PoiPlace } from "../poiContract";
import { namingCultureNear, regionPlaces, settlementWithin, within } from "../poiPlaces";
import {
  cellsWithin,
  celsiusAt,
  fieldOf,
  isLand,
  rockAt,
  sedimentAt,
  wetlandCoverAt,
} from "../poiReads";
import { aloneAmong, attachment, drawnWhen, sized, standsOut } from "../poiVisibilityRules";
import { areaOf, spans } from "./waterReads";

/** The cover the biome rules and the environment both read as a wetland. */
const wetCover = 0.3;
/** Above this gradient water runs off rather than stands, as the ecology's flatness reads it. */
const standingGradient = 0.015;
/** Metres of soil water a wetland stores. */
const storedWater = 0.5;
/** Warmth over which standing water breeds fever, in degrees. */
const feverWarmth = 18;

const isA = (state: GenerationState, cell: number) =>
  isLand(state, cell) && wetlandCoverAt(state, cell) >= wetCover;
const places = regionPlaces("wetland", isA, wetlandCoverAt);
const around = spans(6);
const counterpart = counterpartOf(isA, 1);
const greatness = sized(areaOf, landscapeMinimumArea);
const peatOf = (state: GenerationState, place: PoiPlace) =>
  fieldOf(state).PeatCarbon.get(place.anchor);
const factors = {
  magnitude: greatness,
  localConditions: standsOut(wetlandCoverAt, around),
  isolation: aloneAmong(places, around),
  cultural: attachment(around),
};

/** Standing water holds its ground flat: what does not run off does not cut. */
const heldFlat = (_state: GenerationState, place: PoiPlace): readonly PoiFieldChange[] =>
  place.cells.map((cell) => ({ change: "gradientAtMost", cell, gradient: standingGradient }));
/** A store in the soil that lets water out slowly. */
const storedInSoil = (_state: GenerationState, place: PoiPlace): readonly PoiFieldChange[] =>
  place.cells.map((cell) => ({
    change: "atLeast",
    band: "SoilWater",
    cell,
    value: storedWater,
  }));
/** Its water drowns the trees' roots, and only what tolerates that holds the ground. */
const drownedRoots = (state: GenerationState, place: PoiPlace): readonly PoiFieldChange[] =>
  place.cells.flatMap((cell): PoiFieldChange[] => [
    { change: "atLeast", band: "WetlandCover", cell, value: wetlandCoverAt(state, cell) },
    { change: "atMost", band: "TreeCover", cell, value: 1 - wetlandCoverAt(state, cell) },
  ]);

export const wetland: PoiEntry = {
  id: "wetland",
  group: "water",
  name: "Wetland",
  recognition: {
    distinct:
      "A land cell (WaterKindCodes None) whose WetlandCover is at least 0.3, the share the biome rules read: ground held wet by what grows there, not a surface of its own. A lake has a water body and a level; a floodplain or delta band without the cover is only ground that floods; a forest or grassland has its cover elsewhere. A bog, a marsh and a swamp are this kind, told apart by peat, flood and canopy.",
    isA,
  },
  existence: {
    statement:
      "Emerges where the ecology establishes wetland cover: flat ground that floods, drains poorly or stands past the climate's aridity, including the fens below a melt line and the marsh on a delta.",
    way: "emerges",
    requires: notApplicable("Its cover is the requirement and already carries what it read."),
    suitability: notApplicable(
      "The ecology's establishment decides the ground, not a siting step."
    ),
    places,
  },
  fields: {
    statement:
      "A wetland is a store and a brake on floods: it holds its ground flat and its soil full, and what it grows keeps trees' roots out. The climate process already holds back its runoff in proportion to its cover.",
    terrain: heldFlat,
    water: storedInSoil,
    climate: notApplicable(
      "Its evaporation reaches the air through the Evapotranspiration the climate already reads."
    ),
    cover: drownedRoots,
    magic: notApplicable(
      "Greenwood's peat sources and Salt's anoxic preservation already read WetlandCover and PeatCarbon; the place declares nothing further."
    ),
  },
  acrossMaps: {
    statement:
      "A captured wetland needs flat ground on the finer map within half the parent's cell of where it landed, and develops its own cover there through the regional ecology. If that cover does not come, the wetland goes: on closer ground it was only damp.",
    carry: carryWhereItLands,
    realize: (state, carried) =>
      cellsWithin(state, carried.cell, parentSpanOf(state) / 2)
        .filter((cell) => isLand(state, cell))
        .map((cell) => ({ change: "gradientAtMost", cell, gradient: standingGradient })),
    counterpart,
    unrealized: (state, carried) =>
      counterpart(state, carried) >= 0 ? movesTo(counterpart)(state, carried) : goes(),
    settle: movesTo(counterpart),
  },
  movement: {
    statement:
      "A wetland mires carts and takes a causeway to cross; flat-bottomed boats use it slowly; water loses its way across it, and Greenwood's roots run through its connected cover.",
    roads: costNear(3),
    boats: costNear(2),
    drainage: costNear(1.5),
    magic: costNear(0.8),
    crosses: notApplicable("A wetland is the barrier; a bridge or a ford crosses it, not itself."),
  },
  others: {
    statement:
      "A wetland excludes a lake's water and a settlement's seat; it gathers at river mouths, below melt lines and beside slow lakes, and it is often the same ground a clearance would drain.",
    needs: notApplicable("It needs only the wet ground its cover already implies."),
    excludes: [
      { kind: "lake", holds: (_state, a, b) => b.cells.includes(a.anchor) },
      { kind: "settlement", holds: (_state, a, b) => a.cells.includes(b.anchor) },
    ],
    contains: notApplicable("It contains cover, not other kinds of place of a sort it could own."),
    pairsWith: [
      { kind: "riverMouth", holds: within(spans(3)) },
      { kind: "meltLine", holds: within(spans(3)) },
      { kind: "lake", holds: within(spans(3)) },
      { kind: "clearance", holds: within(around) },
    ],
  },
  people: {
    statement:
      "A wetland gives fish and fowl, reeds and peat, and a refuge no army crosses easily. In warm country its standing water brings fever to those who live beside it.",
    offers(state, place) {
      const great = greatness(state, place);
      return { food: great, defence: great / 2, materials: Math.min(1, peatOf(state, place) / 20) };
    },
    threatens: (state, place) =>
      celsiusAt(state, place.anchor) > feverWarmth &&
      settlementWithin(state, place.anchor, around(state))
        ? [{ hazard: "fever", reach: around(state) / 2, severity: 0.4 }]
        : [],
  },
  time: {
    statement:
      "A wetland fills with its own peat and sediment; while its cover holds it persists. Drained or dried, it leaves open grassland on deep soft ground and otherwise nothing.",
    fate(state, place) {
      if (isA(state, place.anchor)) return { fate: "persists" };
      const soft = rockAt(state, place.anchor) < 0.5 && sedimentAt(state, place.anchor) >= 1;
      return soft ? { fate: "ends", leaves: "grassland" } : { fate: "ends" };
    },
  },
  visibility: {
    statement:
      "A wetland shows by its area and by how sharply it breaks the drier cover around it; a small fen matters mainly to the town that lives on it.",
    ...factors,
    visibleAt: drawnWhen(factors, { magnitude: 0.55, localConditions: 0.35, isolation: 0.1 }),
  },
  naming: {
    statement:
      "Named by the people at its edge; those who live in it take its name for themselves.",
    namedBy: namingCultureNear,
    takesNameFrom: notApplicable(
      "A wetland's name comes from what it is, not from a place near it."
    ),
    lendsNameTo: [{ kind: "settlement", holds: within(around) }],
  },
};
