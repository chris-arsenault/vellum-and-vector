import type { GenerationState } from "../../process";
import { bridgeFlow, fordCost, roadTravellers } from "../../regional/societyWays";
import type { RegionalState } from "../../regional/state";
import { rulingGrade, wetGroundCost } from "../../regional/ways";
import { carryWhereItLands, costNear, counterpartOf, goes, movesTo } from "../poiCarry";
import {
  notApplicable,
  type PoiBarrier,
  type PoiEntry,
  type PoiFieldChange,
  type PoiPlace,
} from "../poiContract";
import { holdsRecord, namingCultureNear, settlementWithin, holds, within } from "../poiPlaces";
import {
  adjacent,
  cellSpan,
  dischargeAt,
  fieldOf,
  isLand,
  isRiver,
  rockAt,
  wetlandCoverAt,
} from "../poiReads";
import { onMappedRiver } from "../water/waterReads";
import { aloneAmong, attachment, sized, standsOut } from "../poiVisibilityRules";
import { onceWritten } from "./communityRecords";
import { travellersOf, weighedPlace } from "./settlementRecords";
import { bridgePlaces, crossingPlaces } from "./workRecords";

/** A span at which a river becomes hard to bridge, in metres of its width. */
const hardSpan = 50;
/** Threading a laden boat between the piers. */
const piersCost = 1.25;
/** How strongly abutments hold the channel the network grows through. */
const heldChannel = 0.9;
/** Wetland share beyond which a bridge's causeway is carrying a route over marsh. */
const marsh = 0.3;

const places = bridgePlaces;
const isA = holdsRecord("bridge", places);
const around = (state: GenerationState) => 6 * cellSpan(state);
const crossable = (state: GenerationState, cell: number) =>
  onMappedRiver(state, cell) && isLand(state, cell);
const bridgeable = (state: GenerationState, cell: number) =>
  crossable(state, cell) && dischargeAt(state, cell) >= bridgeFlow;
const widthAt = (state: GenerationState, cell: number) => fieldOf(state).RiverWidth.get(cell);
/** Traffic and water together: a great road on a little river is not a great bridge. */
const greatness = (state: GenerationState, place: PoiPlace) =>
  (sized(travellersOf, roadTravellers)(state, place) +
    sized((s, p) => dischargeAt(s, p.anchor), 10 * bridgeFlow)(state, place)) /
  2;
const factors = {
  magnitude: greatness,
  localConditions: standsOut(dischargeAt, around),
  isolation: aloneAmong(crossingPlaces, around),
  cultural: attachment(around),
};
/** The approaches held to a grade a laden cart can climb, on the land either side. */
const graded = (state: GenerationState, cell: number): readonly PoiFieldChange[] =>
  [...adjacent(state, cell)]
    .filter((next) => isLand(state, next) && !isRiver(state, next))
    .map((next) => ({ change: "gradientAtMost", cell: next, gradient: rulingGrade }));
/**
 * The crossing tax gone at the span; over the approach, a causeway above the wet ground the
 * road search otherwise charges for.
 */
const roadCost = (state: GenerationState, place: PoiPlace) => [
  { cell: place.anchor, factor: 1 / fordCost },
  ...[...adjacent(state, place.anchor)].map((cell) => ({
    cell,
    factor: 1 / (1 + (wetGroundCost * fieldOf(state).FloodplainIntensity.get(cell)) / 1000),
  })),
];
/** Marsh beside the span means its causeway carries the route over that too. */
function barriers(state: GenerationState, place: PoiPlace): readonly PoiBarrier[] {
  const onMarsh = [...adjacent(state, place.anchor)].some(
    (next) => wetlandCoverAt(state, next) >= marsh
  );
  return onMarsh ? ["river", "wetland"] : ["river"];
}
const counterpart = counterpartOf(crossable, 1);
const realized = (state: RegionalState, cell: number) => (cell < 0 ? [] : graded(state, cell));

export const bridge: PoiEntry = {
  id: "bridge",
  group: "settlements",
  name: "Bridge",
  recognition: {
    distinct:
      "A crossing, with its `travellers` and `flow`, on a channel cell with `WaterKindCodes` none: a built way over a river. One test splits it from a ford, needing both `travellers` at least 100 and `FlowAccumulation` at least 20; a ford misses either. A dam also carries a road over a river, but holds water back; a bridge lets it all pass.",
    isA,
  },
  existence: {
    statement:
      "Sited by use on a refined map: where a way busy enough to be a road crosses a sizeable river. The world map publishes no crossings; its roads only pay a charge at each river.",
    way: "sited",
    requires: bridgeable,
    /** Firm rock for its footings, a narrow span and no broad flood for its approaches to cross. */
    suitability(state, cell) {
      const width = widthAt(state, cell),
        narrow = hardSpan / (hardSpan + width),
        dry = 1 - fieldOf(state).FloodplainIntensity.get(cell) / 1000;
      return (rockAt(state, cell) + narrow + dry) / 3;
    },
    places,
  },
  publication: {
    statement: "A refined map publishes each bridge once its ways are traced.",
    moment: "society",
    record: onceWritten,
  },
  fields: {
    statement:
      "A bridge grades its approaches to what a cart can climb and fixes its river's course between its abutments; the water passes it unchanged.",
    terrain: (state, place) => graded(state, place.anchor),
    water: notApplicable("Its piers narrow the channel by less than the field's width can show."),
    climate: notApplicable("A span of stone or timber has no effect on any weather."),
    cover: notApplicable("Traffic thins the banks only as the road's own wear does."),
    magic: notApplicable("A bridge holds no stock; river-borne magic passes under it."),
  },
  acrossMaps: {
    standsOn: "river",
    statement:
      "A refined map traces its own ways and makes its bridges afresh at extraction. A bridge captured from a coarser map draws the growing channel to its abutments, stands on the nearest channel with its approaches graded there, and goes if no channel lies near.",
    carry: carryWhereItLands,
    realize: (state, carried) => realized(state, counterpart(state, carried)),
    counterpart,
    unrealized: (state, carried) =>
      counterpart(state, carried) >= 0 ? movesTo(counterpart)(state, carried) : goes(),
    settle: notApplicable("Crossings are published after the last round's water, so none settles."),
    schedule: notApplicable("A bridge's hold on the channel is its drainage cost below."),
  },
  movement: {
    statement:
      "A bridge lets a route cross a river without paying for it. The road search taxes a step over a channel three times over; a bridge removes the tax and carries its approaches clear of the wet ground, so ways bend a long way to reach it. Boats thread its piers at a small cost, and its abutments hold the channel where it was spanned.",
    roads: roadCost,
    boats: costNear(piersCost),
    drainage: costNear(heldChannel),
    magic: notApplicable(
      "River-borne stock runs under it, and people carrying stock pay only the road's cost above."
    ),
    links: notApplicable("A span is a step on the ground, not a join between distant cells."),
    crosses: barriers,
  },
  others: {
    statement:
      "A bridge joins the settlements whose road needs it. The same cell holds either a bridge or a ford, and it cannot stand on a fall; a gorge gives it its narrowest span, and a town at a bridge often takes its name.",
    needs: [{ kind: "settlement", holds: within((state) => 4 * around(state)) }],
    excludes: [
      { kind: "ford", holds: (_state, a, b) => a.anchor === b.anchor },
      { kind: "waterfall", holds: (_state, a, b) => a.anchor === b.anchor },
      { kind: "lake", holds: (_state, a, b) => b.cells.includes(a.anchor) },
    ],
    contains: notApplicable("A bridge is one point on a river."),
    pairsWith: [
      { kind: "settlement", holds: within(around) },
      { kind: "gorge", holds: (state, a, b) => holds(state, b, a) },
      { kind: "mill", holds: within(around) },
    ],
  },
  people: {
    statement:
      "A bridge carries trade and tolls in proportion to its traffic, and is a choke point worth holding: the strongest bridges are the ones a capital guards.",
    offers(state, place) {
      const use = sized(travellersOf, roadTravellers)(state, place);
      return { trade: use, defence: use / 2 };
    },
    threatens: notApplicable(
      "It lessens the river's danger to those crossing; floods that take bridges are their own places."
    ),
  },
  time: {
    statement:
      "A bridge stands while a road needs it. Traffic falling below a road's leaves it unkept, and a fallen bridge is a ford over its own piers; a river that moves away leaves it stranded as a ruin.",
    fate(state, place) {
      if (!onMappedRiver(state, place.anchor)) return { fate: "ends", leaves: "ruin" };
      const used =
        travellersOf(state, place) >= roadTravellers &&
        settlementWithin(state, place.anchor, 4 * around(state));
      return used ? { fate: "persists" } : { fate: "becomes", kind: "ford" };
    },
  },
  visibility: {
    statement:
      "A bridge shows by the road on it and the river under it together, and by being the only way over its stretch; it outranks a ford of the same traffic because it took far more to build.",
    ...factors,
    importance: weighedPlace(factors, { magnitude: 0.5, localConditions: 0.2, isolation: 0.3 }),
  },
  naming: {
    statement:
      "Named by the people who use it, usually after the settlement it serves; a town that grows at its foot may take its name in turn.",
    namedBy: namingCultureNear,
    takesNameFrom: [{ kind: "settlement", holds: within(around) }],
    lendsNameTo: [{ kind: "settlement", holds: within(around) }],
  },
};
