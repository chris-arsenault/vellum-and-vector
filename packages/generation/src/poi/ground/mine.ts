import { exposure } from "../../canonry/magicStocks";
import type { GenerationState } from "../../process";
import { carryWhereItLands, costNear, counterpartOf } from "../poiCarry";
import { notApplicable, type PoiEntry, type PoiFieldChange, type PoiPlace } from "../poiContract";
import { holdsRecord, namingCultureNear, recordPlaces, within } from "../poiPlaces";
import {
  cellSpan,
  fieldOf,
  isLake,
  isSea,
  magicRule,
  magicValue,
  rockAt,
  sedimentAt,
  slopeAt,
  toNative,
} from "../poiReads";
import { aloneAmong, attachment, drawnWhen, sized, standsOut } from "../poiVisibilityRules";
import {
  aroundOf,
  capOf,
  floorOf,
  movesOrGoes,
  panAt,
  parameterOf,
  placerAt,
  reservoirPerArea,
  stockPerArea,
  veinAt,
} from "./groundReads";

/** Fire intensity from which a band can tap, as the work's medium holds it (society's own test). */
const tappableFire = 100;
/** Fallen or spent ore per square metre at which a deposit is as rich as they get. */
const richOre = 1000;
/** Salt's full level, where no system gives one. */
const fullSalt = 400;
/** Resistant rock under this depth of sediment can be cut for stone. */
const stoneRock = 0.5,
  stoneCover = 1;
/** Share of a plain deposit against an ore body: gravel, salt crust and stone, worth working but no prize. */
const gravelWorth = 0.4,
  stoneWorth = 0.2;
/** Steeper ground than this cannot be worked or reached. */
const steepestWorking = 0.3;
/** Dose of work at which a mine is half as great as they get. */
const typicalDose = 0.5;
/** What a full dose of work takes from the ground: metres of pit, the fracture a tap opens. */
const pitDepth = 10,
  tapOpening = 250;
/** Tailings' toxicity at full dose in the next cell down the drainage. */
const tailings = 0.5;
/** A haul track's cost near the works, and the share that wears over how many cells. */
const haulGoing = 0.7,
  haulCells = 2;
/** A tap's cost to Fire through the rock it opened; a quarry sends charge out with its people. */
const tappedCost = 0.7,
  quarriedCost = 0.85;
/** Dose below which works are abandoned; the bench a working stands on, rise over run. */
const abandoned = 0.1,
  benchGrade = 0.12;
/** Distance a collapse or burst reaches from the works, in metres. */
const collapseReach = 1000;

const worked = new Set(["tapping", "quarrying"]);
const places = recordPlaces("mine", (feature) => worked.has(feature.kind));
const isA = holdsRecord("mine", places);
const workOf = (place: PoiPlace) => place.feature?.kind ?? "tapping";
const doseOf = (_state: GenerationState, place: PoiPlace) =>
  (Number(place.feature?.attributes.magnitude) || 0) *
  (Number(place.feature?.attributes.condition) || 0);

const prismRule = magicRule("aurora", "prism");
/** Ore a band can reach: Fire tappable in the rock, fallen metal, spent ore erosion has bared. */
function oreAt(state: GenerationState, cell: number) {
  const fire = magicValue(state, "fire", "intensity", cell),
    fallen = stockPerArea(state, "fire", "fallen/held", cell) / richOre,
    spent = stockPerArea(state, "fire", "vein/spent", cell) / richOre,
    bare = exposure(fieldOf(state), cell, parameterOf(state, "fire", "buryDepth") ?? 20);
  return Math.max(
    veinAt(state, cell) || fire >= tappableFire ? fire / 1000 : 0,
    fallen,
    spent * bare
  );
}
/** Salt to cut: the bed Salt keeps, as a share of its full level; crust alone is a plain deposit. */
function saltAt(state: GenerationState, cell: number) {
  const full = parameterOf(state, "salt", "saltFull") ?? fullSalt,
    bed = reservoirPerArea(state, "salt", "bed", cell) / full;
  return Math.max(bed, panAt(state, cell) ? gravelWorth : 0);
}
const stoneAt = (state: GenerationState, cell: number) =>
  rockAt(state, cell) >= stoneRock && sedimentAt(state, cell) < stoneCover
    ? stoneWorth * rockAt(state, cell)
    : 0;
/** How rich the deposit at a cell is, in [0, 1], the richest of what lies there; 0 for no deposit. */
const depositAt = (state: GenerationState, cell: number) =>
  Math.min(
    1,
    Math.max(
      oreAt(state, cell),
      prismRule(state, cell) ? 1 : 0,
      saltAt(state, cell),
      placerAt(state, cell) ? gravelWorth : 0,
      stoneAt(state, cell)
    )
  );

const factors = {
  magnitude: sized(doseOf, typicalDose),
  localConditions: standsOut(depositAt, aroundOf),
  isolation: aloneAmong(places, (state) => 2 * aroundOf(state)),
  cultural: attachment((state) => 2 * aroundOf(state)),
};
const counterpart = counterpartOf(
  (state: GenerationState, cell: number) => depositAt(state, cell) > 0,
  1
);
/** What the work takes from the rock at its anchor: a tap cracks it wider, a quarry takes the charge. */
const workOnRock = (state: GenerationState, place: PoiPlace): readonly PoiFieldChange[] => {
  const cell = place.anchor,
    dose = doseOf(state, place),
    map = fieldOf(state);
  return workOf(place) === "tapping"
    ? [{ change: "add", band: "FractureConductance", cell, amount: tapOpening * dose }]
    : [capOf("IcePersistence", cell, map.IcePersistence.get(cell) * (1 - Math.min(1, dose)))];
};

export const mine: PoiEntry = {
  id: "mine",
  group: "ground",
  name: "Mine",
  recognition: {
    distinct:
      "A published society work of kind tapping or quarrying: a working cut into a deposit, by whichever hands. Mines and quarries are one kind; what they take, ore or prism or salt or stone, is read from the deposit under them and is a property. The record decides, not the rock: a thermal vein or placer with no work on it is a deposit, and a forge is the seat where ore is used, not the place it comes from.",
    isA,
  },
  existence: {
    statement:
      "Sited by people: the society plans tapping on Fire's veins and quarrying on Aurora's prisms within a day's reach of a band, and placeColdAgeWork stands it at the nearest such cell. No publication binding carries those works out of the society's records today, so this entry's places are empty until one does; the deposit tests below are live now.",
    way: "sited",
    requires: (state, cell) => !isSea(state, cell) && depositAt(state, cell) > 0,
    /** The richer the deposit and the easier the ground to work and reach, the better. */
    suitability(state, cell) {
      const easy = 1 - Math.min(1, slopeAt(state, cell) / steepestWorking);
      return depositAt(state, cell) > 0 ? (depositAt(state, cell) + easy) / 2 : 0;
    },
    places,
  },
  fields: {
    statement:
      "A working takes from the ground by the dose of work kept up: a pit lowers it, tailings foul the water below it, the ground is stripped of trees, and each kind changes what its deposit does. A tap opens the fracture, so Fire reaches further; a quarry strips the charge, so the ice its prism held goes.",
    terrain: (state, place) => [
      {
        change: "add",
        band: "Elevation",
        cell: place.anchor,
        amount: -toNative(pitDepth * doseOf(state, place)),
      },
    ],
    water(state, place) {
      const below = fieldOf(state).FlowTargets.get(place.anchor);
      return below < 0
        ? []
        : [floorOf("EcologicalToxicity", below, Math.min(1, tailings * doseOf(state, place)))];
    },
    climate: notApplicable(
      "A pit's smoke and bare ground are below what the climate field resolves."
    ),
    cover: (_state, place) => [capOf("TreeCover", place.anchor, 0)],
    magic: workOnRock,
  },
  acrossMaps: {
    statement:
      "A captured mine lands where its work stands. It needs a level bench to stand on, and a deposit under it on the finer ground: if the deposit's cell is not at the landing, it moves to the nearest within a parent span, and with none it goes. A round's water that floods it moves it or ends it the same way.",
    carry: carryWhereItLands,
    realize: (_state, carried) => [
      { change: "gradientAtMost", cell: carried.cell, gradient: benchGrade },
    ],
    counterpart,
    unrealized: movesOrGoes(counterpart),
    settle: (state, carried) =>
      isLake(state, carried.cell) || isSea(state, carried.cell)
        ? movesOrGoes(counterpart)(state, carried)
        : { outcome: "keep" },
  },
  movement: {
    statement:
      "Haul tracks wear the ground around a working; a tap gives Fire an easier way through the rock it cracked and a quarry sends what it takes away with people. The ore leaves by road, and a pit opens no way through anything.",
    roads: (state, place, cell) =>
      costNear(haulGoing, haulCells * cellSpan(state))(state, place, cell),
    boats: notApplicable(
      "A working ships through a harbour or a river town, which are their own entries."
    ),
    drainage: notApplicable(
      "A pit is declared as lowered ground under terrain, and the network reads elevation for itself."
    ),
    magic: (_state, place, cell) =>
      place.anchor === cell ? (workOf(place) === "tapping" ? tappedCost : quarriedCost) : 1,
    crosses: notApplicable("Workings end under the ground; they are no through route."),
  },
  others: {
    statement:
      "A mine needs people within reach and a deposit under it: a vein, a prism, a placer, a pan. What it takes goes to a forge. It stands on land, so never on a lake's water, and a town may grow up at its gate.",
    needs: [{ kind: "settlement", holds: within((state) => 4 * aroundOf(state)) }],
    excludes: [{ kind: "lake", holds: (_state, a, b) => b.cells.includes(a.anchor) }],
    contains: notApplicable("A mine is one point of work."),
    pairsWith: [
      { kind: "thermalVein", holds: (_state, a, b) => b.cells.includes(a.anchor) },
      { kind: "frostPrism", holds: within(aroundOf) },
      { kind: "placer", holds: (_state, a, b) => b.cells.includes(a.anchor) },
      { kind: "saltPan", holds: (_state, a, b) => b.cells.includes(a.anchor) },
      { kind: "forge", holds: within((state) => 4 * aroundOf(state)) },
    ],
  },
  people: {
    statement:
      "A mine gives materials and trade in proportion to the work kept up; a tap also gives warmth to live by. Its dangers are its own kind: a tap bursts along the fracture it opened, and a quarry or salt working falls in.",
    offers(state, place) {
      const great = factors.magnitude(state, place),
        rich = depositAt(state, place.anchor);
      return {
        materials: (great + rich) / 2,
        trade: great / 2,
        ...(workOf(place) === "tapping" ? { power: rich / 2 } : {}),
      };
    },
    threatens: (state, place) => [
      {
        hazard: workOf(place) === "tapping" ? "burst along the opened fracture" : "collapse",
        reach: collapseReach,
        severity: factors.magnitude(state, place),
      },
    ],
  },
  time: {
    statement:
      "A working lasts while people keep it up and something is left to take. Abandoned, or with the deposit gone, it ends and leaves a ruin; the pit and cracked rock stay where they are.",
    fate(state, place) {
      const left = depositAt(state, place.anchor) > 0,
        kept = doseOf(state, place) > abandoned;
      return left && kept ? { fate: "persists" } : { fate: "ends", leaves: "ruin" };
    },
  },
  visibility: {
    statement:
      "A mine shows by the work kept up there and by what it cuts into standing richer than the country around it; alone it is a known place, among many it is one of a field. A capital that lives on it carries a small one.",
    ...factors,
    visibleAt: drawnWhen(factors, { magnitude: 0.55, localConditions: 0.2, isolation: 0.25 }),
  },
  naming: {
    statement:
      "Named by those who work it, from the naming the society's work records; it takes the name of the vein or pan it works and may name the town at its gate.",
    namedBy: (state, place) => {
      const culture = place.feature?.attributes.namingCulture;
      return typeof culture === "string" ? culture : namingCultureNear(state, place);
    },
    takesNameFrom: [
      { kind: "thermalVein", holds: (_state, a, b) => b.cells.includes(a.anchor) },
      { kind: "saltPan", holds: (_state, a, b) => b.cells.includes(a.anchor) },
    ],
    lendsNameTo: [{ kind: "settlement", holds: within(aroundOf) }],
  },
};
