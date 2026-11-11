// @needsResolution carry: follows its river; without one it may not resolve (ADR 0009).
import type { GenerationState } from "../../process";
import { bridgeFlow, fordCost, roadTravellers, trackTravellers } from "./workRecords";
import { rulingGrade } from "../../regional/ways";
import { carryWhereItLands, costNear, counterpartOf, goes, movesTo } from "../poiCarry";
import { notApplicable, type PoiEntry, type PoiFieldChange, type PoiPlace } from "../poiContract";
import { holdsRecord, namingCultureNear, settlementWithin, within } from "../poiPlaces";
import { cellSpan, dischargeAt, fieldOf, isLand, sedimentAt, slopeAt } from "../poiReads";
import { onMappedRiver } from "../water/waterReads";
import { aloneAmong, attachment, sized, standsOut } from "../poiVisibilityRules";
import { onceWritten } from "./communityRecords";
import { travellersOf, weighedPlace } from "./settlementRecords";
import { crossingPlaces, fordPlaces } from "./workRecords";

/** The depth a person and a loaded beast can wade, in metres. */
// length-unit: fraction
const wadeableDepth = 0.00000025;
/** What the shallows cost a laden boat, which must be lightened or dragged. */
const shallowsCost = 2;

const places = fordPlaces;
const isA = holdsRecord("ford", places);
const around = (state: GenerationState) => 6 * cellSpan(state);
const crossable = (state: GenerationState, cell: number) =>
  onMappedRiver(state, cell) && isLand(state, cell);
/** How much of the river there is to wade through: nothing on a brook, half at bridge flow. */
const fullness = (state: GenerationState, cell: number) => {
  const flow = dischargeAt(state, cell);
  return flow / (flow + fieldOf(state).scale.resolveMeasure(bridgeFlow));
};
/**
 * The crossing tax the road search applies to a channel, as a known ford lowers it: the worn
 * way down each bank and the sure footing leave a brook free and half the tax at bridge flow.
 */
const taxAt = (state: GenerationState, place: PoiPlace) => [
  {
    cell: place.anchor,
    factor: (1 + (fordCost - 1) * fullness(state, place.anchor)) / fordCost,
  },
];
/** The bed held shallow enough to wade. */
const wadeable = (state: GenerationState, cell: number): readonly PoiFieldChange[] => [
  {
    change: "atMost",
    band: "RiverDepth",
    cell,
    value: fieldOf(state).scale.length(wadeableDepth, 0.5),
  },
];
const factors = {
  /** Read when called: the ways' module may still be loading as this one does. */
  magnitude: (state: GenerationState, place: PoiPlace) =>
    sized(travellersOf, roadTravellers)(state, place),
  /** A crossing on the big water of its country matters more than one on a brook beside it. */
  localConditions: standsOut(dischargeAt, around),
  isolation: aloneAmong(crossingPlaces, around),
  cultural: attachment(around),
};
const counterpart = counterpartOf(crossable, 1);

export const ford: PoiEntry = {
  id: "ford",
  group: "settlements",
  name: "Ford",
  recognition: {
    distinct:
      "A crossing, with its `travellers` and `flow`, on a channel cell with `WaterKindCodes` none: a way across a river on the river's own bed. One test splits it from a bridge, a bridge having both `travellers` at least 100 and `FlowAccumulation` at least 20; a ford misses either. A dam also crosses a river, but on a crest that holds water.",
    isA,
  },
  existence: {
    statement:
      "Sited by use on a refined map: where traced ways cross a channel on land, away from a seat's own cell, and do not earn a bridge. The world map publishes no crossings; its roads only pay a charge at each river.",
    way: "sited",
    requires: crossable,
    /** Shallow slack water over a firm bed, with banks a cart can get down. */
    suitability(state, cell) {
      const shallow = 1 - fullness(state, cell),
        banks = 1 - Math.min(1, slopeAt(state, cell) / rulingGrade),
        bed = Math.min(1, sedimentAt(state, cell));
      return (shallow + banks + bed) / 3;
    },
    places,
  },
  publication: {
    statement: "A refined map publishes each ford once its ways are traced.",
    moment: "society",
    record: onceWritten,
  },
  fields: {
    statement:
      "A ford is a shallow in a river that use keeps open: the depth at its cell stays wadeable, and traffic down both banks keeps the trees off the crossing.",
    terrain: notApplicable(
      "Its cut banks are narrower than a cell; what matters of the bed is its depth, under water."
    ),
    water: (state, place) => wadeable(state, place.anchor),
    climate: notApplicable("A shallow exchanges nothing with the air that its river does not."),
    cover(state, place) {
      const traffic = Math.log2(1 + travellersOf(state, place) / trackTravellers);
      return [
        { change: "atMost", band: "TreeCover", cell: place.anchor, value: 1 / (1 + traffic) },
      ];
    },
    magic: notApplicable("A ford holds no stock; river-borne magic runs over it as anywhere else."),
  },
  acrossMaps: {
    standsOn: "river",
    statement:
      "A refined map traces its own ways and makes its crossings afresh at extraction. A ford captured from a coarser map moves to the nearest channel on the finer ground, which must be wadeable there, and goes if no channel lies near: the crossing follows the river, not the river the crossing.",
    carry: carryWhereItLands,
    realize(state, carried) {
      const cell = counterpart(state, carried);
      return cell < 0 ? [] : wadeable(state, cell);
    },
    counterpart,
    unrealized: (state, carried) =>
      counterpart(state, carried) >= 0 ? movesTo(counterpart)(state, carried) : goes(),
    settle: notApplicable("Crossings are published after the last round's water, so none settles."),
    schedule: notApplicable("A ford takes no part in refinement's steps."),
  },
  movement: {
    statement:
      "A ford lets a route cross a river. The road search taxes a step over a channel three times over; a known ford lowers that to nothing on a brook and to half the tax at bridge flow, so ways bend toward it. Laden boats must drag over its shallows.",
    roads: taxAt,
    boats: costNear(shallowsCost),
    drainage: notApplicable(
      "A ford is a reading of the channel where it runs shallow; the network does not turn for it."
    ),
    magic: notApplicable(
      "River-borne stock runs past it, and people carrying stock pay the road's own crossing cost."
    ),
    links: notApplicable("A ford is a step on the ground, not a join between distant cells."),
    crosses: () => ["river"],
  },
  others: {
    statement:
      "A ford joins the settlements whose ways use it, and towns grow up at the important ones. The same cell holds either a ford or a bridge; a fall is no place to wade.",
    needs: [{ kind: "settlement", holds: within((state) => 4 * around(state)) }],
    excludes: [
      { kind: "bridge", holds: (_state, a, b) => a.anchor === b.anchor },
      { kind: "waterfall", holds: (_state, a, b) => a.anchor === b.anchor },
      { kind: "lake", holds: (_state, a, b) => b.cells.includes(a.anchor) },
    ],
    contains: notApplicable("A ford is one point on a river."),
    pairsWith: [{ kind: "settlement", holds: within(around) }],
  },
  people: {
    statement:
      "A ford carries trade in proportion to its travellers, and those who hold it hold the way; high water closes it and drowns those who try it anyway.",
    offers(state, place) {
      const use = factors.magnitude(state, place);
      return { trade: use, defence: use / 3 };
    },
    threatens(state, place) {
      return [
        {
          hazard: "drowning in spate",
          reach: cellSpan(state),
          severity: fullness(state, place.anchor),
        },
      ];
    },
  },
  time: {
    statement:
      "A ford lasts as long as a river runs there and people use it. Traffic that outgrows it over a large enough river earns a bridge; the ways that stop using it let it go unmarked.",
    fate(state, place) {
      if (!onMappedRiver(state, place.anchor)) return { fate: "ends" };
      if (!settlementWithin(state, place.anchor, 4 * around(state))) return { fate: "ends" };
      const earned =
        travellersOf(state, place) >= roadTravellers &&
        fieldOf(state).FlowAccumulation.get(place.anchor) >=
          fieldOf(state).scale.resolveMeasure(bridgeFlow);
      return earned ? { fate: "becomes", kind: "bridge" } : { fate: "persists" };
    },
  },
  visibility: {
    statement:
      "A ford shows by the traffic across it and by being the only crossing on its stretch of river; one that gives a town its reason shows regardless.",
    ...factors,
    importance: weighedPlace(factors, { magnitude: 0.4, localConditions: 0.2, isolation: 0.4 }),
  },
  naming: {
    statement:
      "Named by the people nearest it, from what crosses or what stands beside it; a town at an important ford takes its name.",
    namedBy: namingCultureNear,
    takesNameFrom: notApplicable(
      "A ford is named for its river or its use, and neither is a place of the catalogue."
    ),
    lendsNameTo: [{ kind: "settlement", holds: within(around) }],
  },
};
