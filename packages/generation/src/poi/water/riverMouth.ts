import type { GenerationState } from "../../process";
import type { RegionalState } from "../../regional/state";
import { carryWhereItLands, costNear, counterpartOf, parentSpanOf } from "../poiCarry";
import {
  notApplicable,
  type PoiCarried,
  type PoiEntry,
  type PoiFieldChange,
  type PoiPlace,
  type PoiUnrealized,
} from "../poiContract";
import { cellPlaces, namingCultureNear, within } from "../poiPlaces";
import {
  adjacent,
  cellSpan,
  cellsWithin,
  dischargeAt,
  fieldOf,
  gap,
  isLand,
  isRiver,
  isSea,
  nearestWhere,
  toNative,
  waveExposureAt,
} from "../poiReads";
import { aloneAmong, attachment, drawnWhen, sized, standsOut } from "../poiVisibilityRules";
import { flowTarget, spans } from "./waterReads";

/** Discharge at which a mouth is half as great as mouths get: the world's mapped-river measure. */
const typicalDischarge = 350;
/** A river's last cell lies no higher than this above the sea, in metres. */
const mouthRelief = 1;
/** Gradient a delta's fan holds, rise over run. */
const fanGradient = 0.001;
/** How many of the parent's cells a river may run to reach the sea it was captured reaching. */
const reachToSea = 3;

/** The sea cell beside a cell, or -1. */
function seaBeside(state: GenerationState, cell: number) {
  for (const next of adjacent(state, cell)) if (isSea(state, next)) return next;
  return -1;
}
/**
 * A river's last land cell: the world's network targets the sea cell; a refined network's
 * receiver is -1 at a root, so there the sea must lie beside it. A river leaving across the
 * frame has no sea beside it and is no mouth.
 */
const isA = (state: GenerationState, cell: number) => {
  if (!isLand(state, cell) || !isRiver(state, cell)) return false;
  const target = flowTarget(state, cell);
  return target >= 0 ? isSea(state, target) : seaBeside(state, cell) >= 0;
};
const places = cellPlaces("riverMouth", isA);
/** Whether a mouth builds a delta or stands open as an estuary, a property of one kind. */
export const riverMouthForm = (state: GenerationState, cell: number) =>
  fieldOf(state).DeltaIntensity.get(cell) > 0 ? "delta" : "estuary";
const deltaAt = (state: GenerationState, cell: number) =>
  fieldOf(state).DeltaIntensity.get(cell) / 1000;
const flowOf = (state: GenerationState, place: PoiPlace) => dischargeAt(state, place.anchor);
const greatness = sized(flowOf, typicalDischarge);
const around = spans(8);
const counterpart = counterpartOf(isA, 1);
const factors = {
  magnitude: greatness,
  localConditions: standsOut(dischargeAt, around),
  isolation: aloneAmong(places, around),
  cultural: attachment(around),
};

/** The next cell towards the sea: the water's own way, or else the shortest ground to the shore. */
function towardSea(state: GenerationState, cell: number) {
  const target = flowTarget(state, cell);
  if (target >= 0) return target;
  const distance = fieldOf(state).OceanDistance;
  let best = -1,
    least = distance.get(cell) < 0 ? Infinity : distance.get(cell);
  for (const next of adjacent(state, cell)) {
    const d = distance.get(next);
    if (d >= 0 && d < least) [best, least] = [next, d];
  }
  return best;
}
/** The land cells from a river cell to the shore; empty when the sea is out of its reach. */
function landToSea(state: RegionalState, start: number) {
  const steps = (reachToSea * parentSpanOf(state)) / cellSpan(state),
    path: number[] = [];
  let cell = start;
  while (cell >= 0 && !isSea(state, cell) && !path.includes(cell) && path.length <= steps) {
    path.push(cell);
    cell = towardSea(state, cell);
  }
  return cell >= 0 && isSea(state, cell) ? path : [];
}
/**
 * What the finer ground must provide: an unbroken channel to the shore. Each cell from where
 * the river now stops to the sea falls evenly to the sea's level, is a channel, and carries
 * the river's discharge, so neither the threshold, seepage nor a rise of the shore ends it.
 */
function channelToSea(state: RegionalState, carried: PoiCarried): readonly PoiFieldChange[] {
  const start = nearestWhere(state, carried.cell, parentSpanOf(state), (c) => isRiver(state, c)),
    path = landToSea(state, start >= 0 ? start : carried.cell),
    map = state.physical.map,
    sea = map.EffectiveSeaLevel;
  if (!path.length) return [];
  const head = Math.max(sea, map.Elevation.get(path[0])),
    flow = map.FlowAccumulation.get(path[0]);
  return path.flatMap((cell, k): PoiFieldChange[] => [
    {
      change: "atMost",
      band: "Elevation",
      cell,
      value: sea + ((head - sea) * (path.length - k)) / path.length,
    },
    { change: "atLeast", band: "RiverOrders", cell, value: 1 },
    { change: "atLeast", band: "FlowAccumulation", cell, value: flow },
  ]);
}
/** A mouth the ground does not yet show moves to one that does; it goes only with no sea near. */
function whereItStands(state: RegionalState, carried: PoiCarried): PoiUnrealized {
  const found = counterpart(state, carried);
  if (found >= 0) return { outcome: "move", cell: found };
  return nearestWhere(state, carried.cell, parentSpanOf(state), (c) => isSea(state, c)) >= 0
    ? { outcome: "keep" }
    : { outcome: "drop" };
}
/** The fan cells a delta holds around its mouth. */
const fanOf = (state: GenerationState, place: PoiPlace) =>
  cellsWithin(state, place.anchor, around(state)).filter(
    (cell) => deltaAt(state, cell) > 0 && isLand(state, cell)
  );
/** The mouth holds the river's base level at the sea; a delta holds its fan nearly flat. */
const baseLevel = (state: GenerationState, place: PoiPlace): readonly PoiFieldChange[] => [
  {
    change: "atMost",
    band: "Elevation",
    cell: place.anchor,
    value: fieldOf(state).EffectiveSeaLevel + toNative(mouthRelief),
  },
  ...fanOf(state, place).map(
    (cell) => ({ change: "gradientAtMost", cell, gradient: fanGradient }) as const
  ),
];
/** The river stays a channel all the way out, and across a delta its distributaries do. */
const openChannels = (state: GenerationState, place: PoiPlace): readonly PoiFieldChange[] =>
  [place.anchor, ...fanOf(state, place)].map((cell) => ({
    change: "atLeast",
    band: "RiverOrders",
    cell,
    value: 1,
  }));
/** Exposure of the sea the mouth opens on. */
const openSea = (state: GenerationState, place: PoiPlace) => {
  const sea = seaBeside(state, place.anchor);
  return sea < 0 ? 0 : waveExposureAt(state, sea);
};
/** A delta's ground is soft and its floodplain band is zeroed, so ways pay for its softness here. */
const softGround = (state: GenerationState, _place: PoiPlace, cell: number) =>
  1 + 3 * deltaAt(state, cell);

export const riverMouth: PoiEntry = {
  id: "riverMouth",
  group: "water",
  name: "River mouth",
  recognition: {
    distinct:
      "A land cell with RiverOrders above zero whose water goes straight into the sea: its FlowTargets cell is Ocean, or it has no target and an Ocean neighbour, as a refined network's root does. A river entering a lake is not one (the target is Lake, not Ocean), nor is one leaving across the frame (no Ocean beside it); a spring is the other end of the river. A delta and an estuary are this kind, with the form a property read from DeltaIntensity.",
    isA,
  },
  existence: {
    statement:
      "Emerges wherever a river reaches the sea, one for each river that does. Whether it builds a delta or stands open follows its sediment load against the shelter of the water it enters.",
    way: "emerges",
    requires: notApplicable(
      "Its test reads the river and the shore; nothing else has to be there."
    ),
    suitability: notApplicable("A river meets the sea where the ground takes it; nothing chooses."),
    places,
  },
  fields: {
    statement:
      "A mouth is the river's base level and a sink of its water and sediment: it holds the river's last cell at the sea, and a delta holds its fan nearly flat with its channels open.",
    terrain: baseLevel,
    water: openChannels,
    climate: notApplicable(
      "Sea air is the coast's and reaches inland whether a river enters there or not."
    ),
    cover: notApplicable(
      "Ecology already reads DeltaIntensity into its wetness and flood terms, which grow the delta's marsh."
    ),
    magic: notApplicable(
      "River-carried stock simply leaves here: `carryDownstream` counts what enters the sea as lost, and no band changes."
    ),
  },
  acrossMaps: {
    statement:
      "A captured mouth requires the finer map's river to run into the sea. The ground must provide an unbroken channel to the shore: each cell from where the river stops falls evenly to the sea's level, stays a channel and carries the river's discharge. The place then moves to the mouth the developed water shows, and each round's shore change can move it again. It goes only when no sea lies near.",
    carry: carryWhereItLands,
    realize: channelToSea,
    counterpart,
    unrealized: whereItStands,
    settle: whereItStands,
  },
  movement: {
    statement:
      "A mouth is where boats pass from river to sea, cheap through an estuary and slower through a delta's shifting channels; roads pay for a delta's soft ground; the network is drawn towards the mouth, its base level.",
    roads: (state, place, cell) =>
      gap(state, place.anchor, cell) <= around(state) ? softGround(state, place, cell) : 1,
    boats: (state, place, cell) => {
      const form = riverMouthForm(state, place.anchor) === "delta" ? 1.5 : 0.7;
      return gap(state, place.anchor, cell) <= spans(2)(state) ? form : 1;
    },
    drainage: costNear(0.7),
    magic: notApplicable(
      "River carriage has no cost to change: it ends here because the flow target is sea, and the current does not take it up."
    ),
    crosses: notApplicable("The widest and softest stretch of a river is where no route crosses."),
  },
  others: {
    statement:
      "A mouth needs a river and a sea and is never in a lake. A harbour and a town stand beside the open water; a delta wets the ground around it; a sheltered bay or a fjord's head can hold one.",
    needs: notApplicable("Its recognition already holds the river and the sea it depends on."),
    excludes: [{ kind: "lake", holds: (_state, a, b) => b.cells.includes(a.anchor) }],
    contains: notApplicable("A mouth is the river's last cell; the fan it builds is its ground."),
    pairsWith: [
      { kind: "harbour", holds: within(spans(3)) },
      { kind: "settlement", holds: within(around) },
      { kind: "wetland", holds: within(spans(3)) },
      { kind: "bay", holds: within(spans(3)) },
      { kind: "fjord", holds: within(spans(3)) },
    ],
  },
  people: {
    statement:
      "A mouth is where inland and sea trade meet, and a delta is the best farmland a river makes. Both flood: the sea drives in on an exposed mouth, and a river in spate spreads over a delta.",
    offers(state, place) {
      const great = greatness(state, place),
        delta = deltaAt(state, place.anchor);
      return { trade: great, food: Math.max(great / 2, delta * great), water: great / 2 };
    },
    threatens: (state, place) => [
      {
        hazard: "storm surge and river flood",
        reach: around(state) / 2,
        severity: Math.max(openSea(state, place), greatness(state, place) / 2),
      },
    ],
  },
  time: {
    statement:
      "A mouth moves with the shore as the sea rises or a delta builds. When the river no longer reaches the sea it ends, and a delta it built remains as wetland.",
    fate(state, place) {
      if (isA(state, place.anchor)) return { fate: "persists" };
      return deltaAt(state, place.anchor) > 0
        ? { fate: "ends", leaves: "wetland" }
        : { fate: "ends" };
    },
  },
  visibility: {
    statement:
      "A mouth shows by the size of the river it ends and how it stands out from the streams beside it; a port town carries a small one. Mouths are common along a coast, so isolation counts for little.",
    ...factors,
    visibleAt: drawnWhen(factors, { magnitude: 0.6, localConditions: 0.3, isolation: 0.1 }),
  },
  naming: {
    statement:
      "Named by the people on it, after the river; a town there takes the name of the mouth.",
    namedBy: namingCultureNear,
    takesNameFrom: notApplicable(
      "It takes its river's name, and a river is not a place of this catalogue."
    ),
    lendsNameTo: [{ kind: "settlement", holds: within(around) }],
  },
};
