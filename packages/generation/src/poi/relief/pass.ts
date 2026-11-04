import type { GenerationState } from "../../process";
import type { RegionalState } from "../../regional/state";
import { topographicProminence } from "../../topographicProminence";
import { carryWhereItLands, costNear, movesTo, parentSpanOf } from "../poiCarry";
import { notApplicable, type PoiEntry, type PoiFieldChange, type PoiPlace } from "../poiContract";
import { cellPlaces, namingCultureNear, within } from "../poiPlaces";
import {
  adjacent,
  cellSpan,
  cellsWithin,
  celsiusAt,
  fieldOf,
  gap,
  heightAt,
  heldFor,
  isLand,
  isRiver,
  metres,
} from "../poiReads";
import { aloneAmong, attachment, drawnWhen, sized, standsOut } from "../poiVisibilityRules";
import { sameSpot, spans, standsIn } from "./reliefShape";

/** The grade society reads as needing a made way over a height; a pass's approach holds to it. */
const roadGrade = 0.08;
/** Height of the lesser summit over its col at which a pass is half as great as passes get. */
const typicalRise = 300;
/** At the greatest passes a road crossing costs this share less than the slopes either side. */
const greatestSaving = 0.5;

/**
 * Every key col on this map, with the prominence of the greatest summit it is the key col of:
 * the generator's own prominence pass, whose saddle band says where each summit's area joins
 * higher ground.
 */
const keyCols = (state: GenerationState) =>
  heldFor(state, "relief:keyCols", () => {
    const map = fieldOf(state),
      { rise, saddle } = topographicProminence(
        map.coverage,
        map.Elevation,
        (cell) => adjacent(state, cell),
        map.EffectiveSeaLevel
      ),
      cols = new Map<number, number>();
    for (let cell = 0; cell < map.mesh.count; cell++) {
      const col = saddle.get(cell);
      if (col >= 0 && rise.get(cell) > 0)
        cols.set(col, Math.max(cols.get(col) ?? 0, rise.get(cell)));
    }
    map.coverage.release(rise);
    map.coverage.release(saddle);
    return cols;
  });
const isA = (state: GenerationState, cell: number) =>
  isLand(state, cell) && keyCols(state).has(cell);
const places = cellPlaces("pass", isA);
const riseOf = (state: GenerationState, place: PoiPlace) =>
  metres(keyCols(state).get(place.anchor) ?? 0);
const around = spans(6);
const factors = {
  magnitude: sized(riseOf, typicalRise),
  /** How deep a notch it is in the ground around it: lowness read as summit reads height. */
  localConditions: standsOut((state, cell) => -heightAt(state, cell), spans(3)),
  isolation: aloneAmong(places, around),
  cultural: attachment(spans(8)),
};
/** The col held no higher than `ceiling`, and its approaches held to a road's grade. */
const crossing = (state: GenerationState, cell: number, ceiling: number): PoiFieldChange[] => [
  { change: "atMost", band: "Elevation", cell, value: ceiling },
  ...cellsWithin(state, cell, cellSpan(state)).map((near): PoiFieldChange => ({
    change: "gradientAtMost",
    cell: near,
    gradient: roadGrade,
  })),
];
/** The lowest key col within a parent's cell span: the crossing the finer ground actually has. */
function lowestColNear(state: RegionalState, cell: number) {
  const map = fieldOf(state);
  let best = -1;
  for (const near of cellsWithin(state, cell, parentSpanOf(state)))
    if (isA(state, near) && (best < 0 || map.Elevation.get(near) < map.Elevation.get(best)))
      best = near;
  return best;
}

export const pass: PoiEntry = {
  id: "pass",
  group: "relief",
  name: "Pass",
  recognition: {
    distinct:
      "A land cell that is the key col of a summit: the generator's prominence pass names it as the cell where that summit's area joins higher ground, and the summit's prominence is measured down to it. It is the highest point on the lowest way between the two tops. A summit is a maximum, a ridge the whole crest line a col lies on, a valley the low ground leading up to it. Landform.Pass is not the test: it also asks for 1000 m of height and tectonic ridge influence, and a key col needs neither.",
    isA,
  },
  existence: {
    statement:
      "Emerges wherever two summits share a massif, at every size; a low saddle between knolls and a great mountain crossing are one kind. People's cuttings over one are a society work on it, not what makes it a pass.",
    way: "emerges",
    requires: notApplicable("A key col is read from the terrain; nothing has to be there first."),
    suitability: notApplicable("Nothing chooses where a col lies; it is where the summits join."),
    places,
  },
  fields: {
    statement:
      "A pass holds a low notch in a crest: the col stays down and its approaches stay at a road's grade, so erosion and finer relief cannot close the crossing.",
    terrain: (state, place) =>
      crossing(state, place.anchor, fieldOf(state).Elevation.get(place.anchor)),
    water: notApplicable("Water parts at a col and runs both ways; it stores and sources none."),
    climate: notApplicable(
      "Air columns already read the lower height along the wind, so a gap passes its moisture."
    ),
    cover: notApplicable("Cover at a col follows temperature and moisture at its height."),
    magic: notApplicable(
      "A col holds no magic; what it changes is the carriers' cost, stated under movement."
    ),
  },
  acrossMaps: {
    statement:
      "A captured pass stays the lowest crossing of its crest on the refined map. Its counterpart is the lowest key col within a parent's cell span, which is held no higher than the parent's col stood, so no finer saddle undercuts it; after each round's water it moves to whichever col is then lowest.",
    carry: carryWhereItLands,
    realize(state, carried) {
      const found = lowestColNear(state, carried.cell),
        cell = found >= 0 ? found : carried.cell,
        map = fieldOf(state);
      return crossing(
        state,
        cell,
        Math.min(state.regional.inheritedHeight.get(carried.cell), map.Elevation.get(cell))
      );
    },
    counterpart: (state, carried) => lowestColNear(state, carried.cell),
    unrealized: movesTo((state, carried) => lowestColNear(state, carried.cell)),
    settle: movesTo((state, carried) => lowestColNear(state, carried.cell)),
  },
  movement: {
    statement:
      "A pass is what lets a road cross a ridge: road cost falls near it, the more so the higher the ground either side. Water must not break through it, and people and wind funnel over it, carrying what they carry.",
    roads(state, place, cell) {
      return gap(state, place.anchor, cell) <= 2 * cellSpan(state)
        ? 1 - greatestSaving * factors.magnitude(state, place)
        : 1;
    },
    boats: notApplicable("A col is the top of its slopes; no water carries a boat there."),
    drainage: costNear(1.5),
    magic: costNear(0.8),
    crosses: () => ["ridge"],
  },
  others: {
    statement:
      "A pass lies on a ridge between summits, at the head of a valley on each side; a settlement near it holds the crossing. It cannot share a cell with a summit or stand in a lake.",
    needs: notApplicable("Being a key col already entails the summits it stands between."),
    excludes: [
      { kind: "summit", holds: sameSpot },
      { kind: "lake", holds: standsIn },
    ],
    contains: notApplicable("A pass is one point on a crest."),
    pairsWith: [
      { kind: "ridge", holds: standsIn },
      { kind: "summit", holds: within(spans(4)) },
      { kind: "valley", holds: within(spans(4)) },
      { kind: "settlement", holds: within(spans(8)) },
    ],
  },
  people: {
    statement:
      "A pass is trade between two countries and a place a few can hold against many, and the higher ground around it the more it is worth; above the frost line it closes under snow.",
    offers(state, place) {
      const great = factors.magnitude(state, place);
      return { trade: great, defence: great };
    },
    threatens: (state, place) =>
      celsiusAt(state, place.anchor) < 0
        ? [{ hazard: "snow closure", reach: cellSpan(state), severity: 0.4 }]
        : [],
  },
  time: {
    statement:
      "A col lowers with its crest and lasts as long as the summits stand. Once headward erosion carries a river through it, the crossing is a valley.",
    fate: (state, place) =>
      isRiver(state, place.anchor) ? { fate: "becomes", kind: "valley" } : { fate: "persists" },
  },
  visibility: {
    statement:
      "A pass shows by how high its summits stand over it and how few other crossings there are; a low saddle among many earns little, and the one road over a long range or a town at its foot carries it.",
    ...factors,
    visibleAt: drawnWhen(factors, { magnitude: 0.4, localConditions: 0.2, isolation: 0.4 }),
  },
  naming: {
    statement:
      "Named by the people who use it, often after the summit above it or the town below it; a town at the crossing may take its name instead.",
    namedBy: namingCultureNear,
    takesNameFrom: [
      { kind: "summit", holds: within(spans(4)) },
      { kind: "settlement", holds: within(spans(8)) },
    ],
    lendsNameTo: [{ kind: "settlement", holds: within(spans(4)) }],
  },
};
