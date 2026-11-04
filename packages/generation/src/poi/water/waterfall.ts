import { isWaterfall, riverDrop, riverGradient, waterfallLeastDrop } from "../../canonry/landforms";
import type { GenerationState } from "../../process";
import { worldFallsDischarge, worldFallsDrop } from "../../worldSignificance";
import {
  carryWhereItLands,
  costNear,
  counterpartOf,
  goes,
  movesTo,
  parentSpanOf,
} from "../poiCarry";
import {
  notApplicable,
  type PoiCarried,
  type PoiEntry,
  type PoiFieldChange,
  type PoiPlace,
} from "../poiContract";
import { cellPlaces, namingCultureNear, holds, within } from "../poiPlaces";
import { siteRecord } from "../poiRecords";
import { cellSpan, fieldOf, isLand, isRiver, nearestWhere, toNative } from "../poiReads";
import { attachment, aloneAmong, sized, standsOut, weighed } from "../poiVisibilityRules";
import { flowTarget } from "./waterReads";
import type { RegionalState } from "../../regional/state";

const gradient = (state: GenerationState, cell: number) => riverGradient(fieldOf(state), cell);
const isA = (state: GenerationState, cell: number) => isWaterfall(fieldOf(state), cell);
const places = cellPlaces("waterfall", isA);
const dropOf = (state: GenerationState, place: PoiPlace) => riverDrop(fieldOf(state), place.anchor);
const dischargeOf = (state: GenerationState, place: PoiPlace) =>
  fieldOf(state).FlowAccumulation.get(place.anchor);
/** Falls grow with both: a tall trickle and a low cataract are each lesser than a great fall. */
const greatness = (state: GenerationState, place: PoiPlace) =>
  (sized(dropOf, worldFallsDrop)(state, place) +
    sized(dischargeOf, worldFallsDischarge)(state, place)) /
  2;
const around = (state: GenerationState) => 6 * cellSpan(state);
const factors = {
  magnitude: greatness,
  localConditions: standsOut(gradient, around),
  isolation: aloneAmong(places, around),
  cultural: attachment(around),
};
/**
 * The step in the long profile: the lip keeps its height and the ground below is held a whole
 * step beneath it, at least the least drop that falls, so erosion cannot smooth it away. A fall
 * into standing water has its step already: the water's surface is what it drops to.
 */
function step(state: GenerationState, place: PoiPlace): readonly PoiFieldChange[] {
  const target = flowTarget(state, place.anchor),
    lip = fieldOf(state).Elevation.get(place.anchor);
  if (target < 0 || !isLand(state, place.anchor) || !isLand(state, target)) return [];
  const drop = Math.max(dropOf(state, place), waterfallLeastDrop);
  return [
    { change: "atLeast", band: "Elevation", cell: place.anchor, value: lip },
    { change: "atMost", band: "Elevation", cell: target, value: lip - toNative(drop) },
  ];
}
const counterpart = counterpartOf(isA, 1);
/** The refined river must hold the step: at the nearest fall, or the nearest reach of river. */
function realizedStep(state: RegionalState, carried: PoiCarried) {
  const found = counterpart(state, carried),
    cell =
      found >= 0
        ? found
        : nearestWhere(
            state,
            carried.cell,
            parentSpanOf(state),
            (c) => isRiver(state, c) && isLand(state, c)
          );
  return cell < 0
    ? []
    : step(state, { id: carried.feature.id, kind: "waterfall", cells: [cell], anchor: cell });
}

export const waterfall: PoiEntry = {
  id: "waterfall",
  group: "water",
  name: "Waterfall",
  recognition: {
    distinct:
      "A river cell that drops at least 10 m to the next cell, with a gradient at least five times the river's above and below it: a step in the long profile. A steadily steep river is a gorge or a rapid reach, not a fall, and no cell off a river can be one.",
    isA,
  },
  existence: {
    statement:
      "Emerges where a river meets resistant rock it has not yet worn through; rapids are the same kind at a lesser drop, and a great fall is only a bigger one.",
    way: "emerges",
    requires: notApplicable("Its test reads the river itself; it needs nothing else first."),
    suitability: notApplicable("Nothing chooses where a fall stands."),
    places,
  },
  publication: {
    statement: "Every fall publishes where it stands, with its drop and the water going over it.",
    moment: "geography",
    record: siteRecord({
      kind: "waterfall",
      layer: "geology",
      name: "Waterfall",
      attributes: (state, place) => ({
        drop: dropOf(state, place),
        discharge: dischargeOf(state, place),
      }),
    }),
  },
  fields: {
    statement:
      "A fall holds a step in the river's profile: its lip stays up and its pool stays down, so erosion cannot smooth it away while it stands.",
    terrain: step,
    water: notApplicable("It keeps the discharge it receives; only the height of the bed changes."),
    climate: notApplicable("Its spray is below what the climate field resolves."),
    cover: notApplicable("Cover along the channel follows the channel's own moisture."),
    magic: notApplicable(
      "Falls neither carry nor generate magic; the river's own carriage passes it."
    ),
  },
  acrossMaps: {
    statement:
      "A captured fall lands on the refined river, whose finer profile must hold its step; if the river there holds none, the fall takes the nearest step and otherwise goes.",
    carry: carryWhereItLands,
    realize: realizedStep,
    counterpart,
    unrealized: (state, carried) =>
      counterpart(state, carried) >= 0 ? movesTo(counterpart)(state, carried) : goes(),
    settle: notApplicable(
      "A fall does not change with a round's water; only with erosion over epochs."
    ),
    schedule: notApplicable(
      "A fall has no step in refinement's schedule; its step is a realized change."
    ),
  },
  movement: {
    statement:
      "Boats cannot pass a fall and must portage; roads treat it as the river it stands on.",
    roads: notApplicable("Road crossing costs read the river; the fall adds nothing to them."),
    boats: costNear(Infinity),
    drainage: notApplicable("The network already runs through it; it only steps the bed."),
    magic: notApplicable("A river's carried magic passes over a fall."),
    links: notApplicable("A fall joins no two cells; a portage is a road's own way round it."),
    crosses: notApplicable("A fall is no crossing; fords and bridges are."),
  },
  others: {
    statement:
      "A fall stands on a river, often inside a gorge; a mill near one has the head it needs, and an upstream dam reduces it to a trickle.",
    needs: notApplicable("Its recognition already requires the river cell it stands on."),
    excludes: [{ kind: "lake", holds: (_state, a, b) => b.cells.includes(a.anchor) }],
    contains: notApplicable("A fall is one point of a river."),
    pairsWith: [
      { kind: "gorge", holds: (state, a, b) => holds(state, b, a) },
      { kind: "mill", holds: within(around) },
    ],
  },
  people: {
    statement:
      "A fall offers water power and awe, and blocks river traffic at a place where towns grow up at the portage.",
    offers: (state, place) => ({
      power: sized(dropOf, worldFallsDrop)(state, place),
      sanctity: greatness(state, place) / 2,
      trade: sized(dischargeOf, worldFallsDischarge)(state, place) / 2,
    }),
    threatens: notApplicable("A fall endangers only those on the river above it."),
  },
  time: {
    statement:
      "A fall cuts back upstream and lowers as it does; once the bed is graded the step is gone and the river runs on, leaving a gorge below where it stood.",
    fate(state, place) {
      const map = fieldOf(state),
        resistant = map.RockResistance.get(place.anchor);
      return resistant <= 0 ? { fate: "ends", leaves: "gorge" } : { fate: "persists" };
    },
  },
  visibility: {
    statement:
      "A fall shows by its drop and discharge together and by how sharply it breaks an otherwise gentle river; a town at its portage carries a small one.",
    ...factors,
    importance: weighed(factors, { magnitude: 0.5, localConditions: 0.3, isolation: 0.2 }),
  },
  naming: {
    statement: "Named by the people nearest it; a portage town may take its name.",
    namedBy: namingCultureNear,
    takesNameFrom: notApplicable("Falls give names; they do not take them."),
    lendsNameTo: [{ kind: "settlement", holds: within(around) }],
  },
};
