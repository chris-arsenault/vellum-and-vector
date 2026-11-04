import { lakeMembership } from "../../canonry/lakeMembership";
import type { GenerationState } from "../../process";
import { carryWhereItLands, counterpartOf, costNear, goes, movesTo } from "../poiCarry";
import {
  notApplicable,
  type PoiCarried,
  type PoiEntry,
  type PoiFieldChange,
  type PoiPlace,
} from "../poiContract";
import { holds, namingCultureNear, within } from "../poiPlaces";
import {
  adjacent,
  featureCell,
  featuresOf,
  fieldOf,
  heldFor,
  isLake,
  isLand,
  Landform,
  magicRule,
  metres,
  rainfallAt,
} from "../poiReads";
import type { RegionalState } from "../../regional/state";
import { aloneAmong, attachment, drawnWhen, sized, standsOut } from "../poiVisibilityRules";
import { areaOf, spans } from "./waterReads";

/** Sizes at which a lake is half as great as lakes get; the world's exceptional-lake measures. */
const typicalArea = 300_000_000,
  typicalDepth = 200,
  typicalThroughflow = 1_500;
/** Metres of depth under which a lake has gone: filled, or drained to a film. */
const shallowest = 1;
/** Rain below this, in metres a year, leaves a dead lake's salts on the ground. */
const aridRain = 0.25;
/** Per-mille moisture a broad lake holds on its shore. */
const shoreMoisture = 400;

const crater = magicRule("fire", "crater");
const isA = isLake;
const bodyOf = (state: GenerationState, cell: number) => fieldOf(state).WaterBodyIds.get(cell);

/** The deepest of a body's cells, where the lake is located. */
const deepest = (state: GenerationState, cells: readonly number[]) => {
  const depths = fieldOf(state).WaterDepths;
  return cells.reduce((a, b) => (depths.get(b) > depths.get(a) ? b : a), cells[0]);
};
/** Every body the generator's own membership holds, with its published record when it has one. */
const places = (state: GenerationState): readonly PoiPlace[] =>
  heldFor(state, "places:lake", () => {
    const map = fieldOf(state),
      membership = lakeMembership(map),
      published = new Map(
        [...featuresOf(state, "lake", "lakes")].map((f) => [f.attributes.waterBody, f])
      ),
      found: PoiPlace[] = [];
    for (const body of membership.bodies()) {
      const cells = [...membership.members(body)].filter((i) => map.mesh.membership(i) === 1);
      if (!cells.length) continue;
      const anchor = deepest(state, cells),
        feature = published.get(body);
      found.push({
        id: `lake:${body}`,
        kind: "lake",
        cells,
        anchor,
        ...(feature ? { feature } : {}),
      });
    }
    return found;
  });

/** What made a lake, a property of one kind: a dam, the Fire stock of a fallen crater, or the ground. */
export function lakeOrigin(state: GenerationState, place: PoiPlace) {
  if (place.cells.some((cell) => crater(state, cell))) return "crater";
  for (const dam of featuresOf(state, "dam")) {
    const cell = featureCell(state, dam);
    if (place.cells.includes(cell)) return "reservoir";
    for (const next of adjacent(state, cell))
      if (isLake(state, next) && place.cells.includes(next)) return "reservoir";
  }
  return "basin";
}
const depthOf = (state: GenerationState, place: PoiPlace) =>
  metres(fieldOf(state).WaterDepths.get(place.anchor));
const throughflowOf = (state: GenerationState, place: PoiPlace) =>
  place.cells.reduce((v, i) => Math.max(v, fieldOf(state).FlowAccumulation.get(i)), 0);
/** Size, depth or throughflow each make a lake great, as they do on the world map. */
const greatness = (state: GenerationState, place: PoiPlace) =>
  Math.max(
    sized(areaOf, typicalArea)(state, place),
    sized(depthOf, typicalDepth)(state, place),
    sized(throughflowOf, typicalThroughflow)(state, place)
  );
const around = spans(8);
const factors = {
  magnitude: greatness,
  /** Near one for a lake in dry country, near nothing among others. */
  localConditions: standsOut((state, cell) => (isLake(state, cell) ? 1 : 0), around),
  isolation: aloneAmong(places, around),
  cultural: attachment(around),
};

/** The shore of a body: land beside its water, and what the water holds there. */
function shoreCells(state: GenerationState, place: PoiPlace) {
  const shore = new Set<number>();
  for (const cell of place.cells)
    for (const next of adjacent(state, cell)) if (isLand(state, next)) shore.add(next);
  return [...shore];
}
const beside = (state: GenerationState, place: PoiPlace, cell: number) => {
  const body = bodyOf(state, place.anchor);
  if (isLake(state, cell)) return false;
  for (const next of adjacent(state, cell))
    if (isLake(state, next) && bodyOf(state, next) === body) return true;
  return false;
};
/** The bed lies under the surface while the lake stands, so nothing erodes or fills it away. */
const heldBed = (state: GenerationState, place: PoiPlace): readonly PoiFieldChange[] => {
  const map = fieldOf(state);
  return place.cells.map((cell) => ({
    change: "atMost",
    band: "Elevation",
    cell,
    value: map.WaterSurfaceElevations.get(cell),
  }));
};
/** It stores water at its own level, and its outlet spills what it cannot hold. */
const heldWater = (state: GenerationState, place: PoiPlace): readonly PoiFieldChange[] => {
  const map = fieldOf(state);
  return place.cells.map((cell) => ({
    change: "atLeast",
    band: "WaterSurfaceElevations",
    cell,
    value: map.WaterSurfaceElevations.get(cell),
  }));
};
/** Water evaporating from a broad lake keeps its shore damp, in proportion to its size. */
const dampShore = (state: GenerationState, place: PoiPlace): readonly PoiFieldChange[] => {
  const value = Math.round(shoreMoisture * sized(areaOf, typicalArea)(state, place));
  return shoreCells(state, place).map((cell) => ({
    change: "atLeast",
    band: "Moisture",
    cell,
    value,
  }));
};
/** Every lake leaves its depth in the memory Salt's dead-lake origin reads when it dries. */
const remembered = (state: GenerationState, place: PoiPlace): readonly PoiFieldChange[] => {
  const map = fieldOf(state);
  return place.cells.map((cell) => ({
    change: "atLeast",
    band: "LakeMemory",
    cell,
    value: metres(map.WaterDepths.get(cell)),
  }));
};
const counterpart = counterpartOf(isA, 1);
/** Captured standing water is a fact of the parent: the refined body stands at its level. */
function capturedLevel(state: RegionalState, carried: PoiCarried): readonly PoiFieldChange[] {
  const cell = counterpart(state, carried),
    lake = state.regional.evidence?.lakes.find((held) => held.cells.includes(cell));
  if (!lake) return [];
  const map = state.physical.map,
    value = map.EffectiveSeaLevel + lake.level * 1024;
  return [...lake.cells].map((cell) => ({
    change: "atLeast",
    band: "WaterSurfaceElevations",
    cell,
    value,
  }));
}

export const lake: PoiEntry = {
  id: "lake",
  group: "water",
  name: "Lake",
  recognition: {
    distinct:
      "A cell whose WaterKindCodes is Lake: standing water that is its own body with its own level (WaterBodyIds, WaterSurfaceElevations), never connected as the sea. Ocean-coded water is sea, however enclosed; ground that is only wet is a wetland with WaterKindCodes None. A crater lake and a reservoir are this kind, with what made them recorded as a property.",
    isA,
  },
  existence: {
    statement:
      "Emerges wherever the routing fills a closed basin and the runoff keeps it filled; a fallen crater holds one by Fire's rule, and a dam's reservoir is the same water behind a built crest.",
    way: "emerges",
    requires: notApplicable("The routing's own fill level decides it; nothing is sited."),
    suitability: notApplicable("Water finds the basin; no process chooses it."),
    places,
  },
  fields: {
    statement:
      "A lake is a store and a root of the drainage: it holds its bed under a level surface, spills at one outlet, keeps its shores damp, and writes its depth into the memory that Salt's dead-lake origin reads once it is gone.",
    terrain: heldBed,
    water: heldWater,
    climate: dampShore,
    cover: notApplicable(
      "Ecology already reads shallow water as wetness, so shore reeds come from the depth itself."
    ),
    magic: remembered,
  },
  acrossMaps: {
    statement:
      "A captured lake is a fact of the parent: its cells are roots of the finer network and it stands at the parent's level, while the relief develops under it. Its record moves to the refined body; if the ground holds none near, it goes.",
    carry: carryWhereItLands,
    realize: capturedLevel,
    counterpart,
    unrealized: (state, carried) =>
      counterpart(state, carried) >= 0 ? movesTo(counterpart)(state, carried) : goes(),
    settle: notApplicable(
      "Routing keeps a captured lake at its captured level, so a round's water does not change it."
    ),
  },
  movement: {
    statement:
      "Boats cross a lake cheaply where a road has to go round it; the level ground beside it draws a shore road. The network grows from it as from any root.",
    roads: (state, place, cell) => (beside(state, place, cell) ? 0.85 : 1),
    boats: costNear(0.5),
    drainage: costNear(0.7),
    magic: notApplicable(
      "Greenwood's roots already stop at open water in their own propagation, and a river's carried stock passes through with the flow."
    ),
    crosses: notApplicable(
      "A lake is the barrier itself; only boats, on their own cost, cross it."
    ),
  },
  others: {
    statement:
      "A lake holds no settlement or fall in its water; a dam makes one behind it and a crater cups one; it may hold a hot spring on its bed, and it dries to a wetland or, in arid country, a salt pan.",
    needs: notApplicable("Its water is its own requirement."),
    excludes: [
      { kind: "settlement", holds: (_state, a, b) => a.cells.includes(b.anchor) },
      { kind: "waterfall", holds: (_state, a, b) => a.cells.includes(b.anchor) },
    ],
    contains: [{ kind: "spring", holds }],
    pairsWith: [
      { kind: "dam", holds: within(around) },
      { kind: "crater", holds: within(spans(2)) },
      { kind: "settlement", holds: within(around) },
      { kind: "harbour", holds: within(spans(3)) },
    ],
  },
  people: {
    statement:
      "A lake gives water, fish and an easy way across; a reservoir feeds and powers those below it. A lake dammed by moraine or a failing crest can burst and flood the valley under it.",
    offers(state, place) {
      const great = greatness(state, place);
      return { water: great, food: great / 2, trade: great / 2 };
    },
    threatens: (state, place) =>
      lakeOrigin(state, place) === "reservoir" || place.cells.some((c) => adjacentMoraine(state, c))
        ? [
            {
              hazard: "outburst flood",
              reach: 2 * around(state),
              severity: greatness(state, place),
            },
          ]
        : [],
  },
  time: {
    statement:
      "A lake lasts while its basin holds water. Filled or drained it leaves a wetland, or a salt pan where the country is arid; a reservoir whose dam is gone is emptied the same way.",
    fate(state, place) {
      if (depthOf(state, place) >= shallowest) return { fate: "persists" };
      return rainfallAt(state, place.anchor) < aridRain
        ? { fate: "ends", leaves: "saltPan" }
        : { fate: "ends", leaves: "wetland" };
    },
  },
  visibility: {
    statement:
      "A lake shows by its area, depth or throughflow, whichever is greatest, and sooner where it is the only water in its country; a capital on its shore carries a small one.",
    ...factors,
    visibleAt: drawnWhen(factors, { magnitude: 0.6, localConditions: 0.25, isolation: 0.15 }),
  },
  naming: {
    statement:
      "Named by the people on its shore; a reservoir commonly takes the name of its dam, and a shore town the name of its lake.",
    namedBy: namingCultureNear,
    takesNameFrom: [{ kind: "dam", holds: within(around) }],
    lendsNameTo: [{ kind: "settlement", holds: within(around) }],
  },
};

/** A shore on moraine: the loose till that dams meltwater lakes and fails. */
function adjacentMoraine(state: GenerationState, cell: number) {
  const map = fieldOf(state);
  for (const next of adjacent(state, cell))
    if (map.LandformCodes.get(next) === Landform.Moraine) return true;
  return false;
}
