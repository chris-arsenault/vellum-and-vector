import type { GenerationState } from "../../process";
import { carryWhereItLands, costNear, counterpartOf, goes, movesTo } from "../poiCarry";
import { notApplicable, type PoiEntry, type PoiFieldChange, type PoiPlace } from "../poiContract";
import {
  holdsRecord,
  namingCultureNear,
  recordPlaces,
  settlementWithin,
  within,
} from "../poiPlaces";
import { cellSpan, dischargeAt, fieldOf, isRiver, slopeAt, toNative } from "../poiReads";
import { aloneAmong, attachment, drawnWhen, sized, standsOut } from "../poiVisibilityRules";
import { isGone, isWork, seatOf } from "./settlementRecords";

/** A channel's fall that turns a mill and the mill's reach from its seat in cells, as regional/society holds them. */
const millGradient = 0.01,
  millReach = 3;
/** Slope by discharge at which a mill is half as strong as mills get. */
const typicalPower = 1;
/** The head a mill's weir and pond hold above the bed, in metres. */
const millHead = 2;
/** A flash lock through the weir: what it costs a boat to pass, against open river. */
const weirCost = 3;
/** The lane everyone with grain walks to it. */
const millLane = 0.85;

const places = recordPlaces("mill", isWork("mill"));
const isA = holdsRecord("mill", places);
/** The generator's own power term: the fall of the water over the flow of it. */
const powerAt = (state: GenerationState, cell: number) =>
  slopeAt(state, cell) * dischargeAt(state, cell);
const powerOf = (state: GenerationState, place: PoiPlace) => powerAt(state, place.anchor);
const fallingChannel = (state: GenerationState, cell: number) =>
  isRiver(state, cell) && slopeAt(state, cell) >= millGradient;
const reach = (state: GenerationState) => millReach * cellSpan(state);
const around = (state: GenerationState) => 6 * cellSpan(state);
const factors = {
  magnitude: sized(powerOf, typicalPower),
  localConditions: standsOut(powerAt, around),
  isolation: aloneAmong(places, around),
  cultural: attachment(around),
};
const pond = (state: GenerationState, cell: number): readonly PoiFieldChange[] => [
  {
    change: "atLeast",
    band: "WaterSurfaceElevations",
    cell,
    value: fieldOf(state).Elevation.get(cell) + toNative(millHead),
  },
];
const counterpart = counterpartOf(fallingChannel, 1);

export const mill: PoiEntry = {
  id: "mill",
  group: "settlements",
  name: "Mill",
  recognition: {
    distinct:
      "A published work of `kind` mill (`workKind` mill, with its `flow` and `seat`), on a channel cell whose `Slope` is at least 0.01: a work that takes the river's fall and gives all of its water back. A dam (`kind` dam) stores the water and an irrigation work (`kind` irrigation) keeps a share of it; a waterfall is the same fall with no record.",
    isA,
  },
  existence: {
    statement:
      "Sited by people on a refined map: each settled place with a falling channel within three cells turns one mill at the reach of greatest slope by flow. No mill is published on the world map, whose works are latent demands.",
    way: "sited",
    requires: (state, cell) =>
      fallingChannel(state, cell) && settlementWithin(state, cell, reach(state)),
    suitability: (state, cell) => {
      const power = powerAt(state, cell);
      return power / (power + typicalPower);
    },
    places,
  },
  fields: {
    statement:
      "A mill holds a small head on the river at its weir and returns everything it took just below; it uses the river's fall and consumes none of its water.",
    terrain: notApplicable(
      "It takes the fall the channel already has; its leat is far narrower than any cell."
    ),
    water: (state, place) => pond(state, place.anchor),
    climate: notApplicable(
      "A mill pond exchanges too little with the air for the field to resolve."
    ),
    cover: notApplicable(
      "It grinds what the fields grow; the cleared land is the clearance entry's, not the mill's."
    ),
    magic: notApplicable(
      "A wheel draws on water, not on any stock; river-borne stock passes with the water it returns."
    ),
  },
  acrossMaps: {
    statement:
      "A refined map sites its own mills at extraction from its own channels. A mill captured from a coarser map takes the nearest reach falling steeply enough, holds its head there, and goes if that ground has none.",
    carry: carryWhereItLands,
    realize(state, carried) {
      const cell = counterpart(state, carried);
      return cell < 0 ? [] : pond(state, cell);
    },
    counterpart,
    unrealized: (state, carried) =>
      counterpart(state, carried) >= 0 ? movesTo(counterpart)(state, carried) : goes(),
    settle: notApplicable("Mills are published after the last round's water, so none settles."),
  },
  movement: {
    statement:
      "A mill's weir slows boats through its flash lock; everyone with grain walks to it, so the lane to it is worn.",
    roads: costNear(millLane),
    boats: costNear(weirCost),
    drainage: notApplicable(
      "Its leat rejoins the river below; the network keeps the channel it found."
    ),
    magic: notApplicable("Neither its stones nor its wheel bear on any carrier."),
    crosses: notApplicable("Its weir carries no road; bridges and fords do that."),
  },
  others: {
    statement:
      "A mill belongs to the settlement whose grain it grinds and cannot stand in standing water. A fall or a dam above it gives it a surer head, and a town at a mill may take its name.",
    needs: [{ kind: "settlement", holds: within(reach) }],
    excludes: [
      { kind: "lake", holds: (_state, a, b) => b.cells.includes(a.anchor) },
      { kind: "dam", holds: (_state, a, b) => a.anchor === b.anchor },
    ],
    contains: notApplicable("A mill is one point on a river."),
    pairsWith: [
      { kind: "waterfall", holds: within(around) },
      { kind: "dam", holds: within(around) },
    ],
  },
  people: {
    statement:
      "A mill turns falling water into power and flour; its weir is too slight to threaten anyone when it fails.",
    offers(state, place) {
      const strength = factors.magnitude(state, place);
      return { power: strength, food: strength / 2 };
    },
    threatens: notApplicable("A pond two metres deep releases no flood worth the name."),
  },
  time: {
    statement:
      "A mill lasts while its seat lives and its river runs. When the seat is gone or the channel moves, the wheel stops and only foundations remain.",
    fate(state, place) {
      if (!isRiver(state, place.anchor)) return { fate: "ends" };
      const seated = place.feature?.attributes.seat !== undefined;
      return seated && isGone(seatOf(state, place))
        ? { fate: "ends", leaves: "ruin" }
        : { fate: "persists" };
    },
  },
  visibility: {
    statement:
      "A mill is a small work: it shows by its power and by being the only one in its country, and a town it serves does more for it than its own size.",
    ...factors,
    visibleAt: drawnWhen(factors, { magnitude: 0.3, localConditions: 0.2, isolation: 0.5 }),
  },
  naming: {
    statement:
      "Named by the people it grinds for, usually after their settlement; a place that grows up around it may keep its name.",
    namedBy: namingCultureNear,
    takesNameFrom: [{ kind: "settlement", holds: within(reach) }],
    lendsNameTo: [{ kind: "settlement", holds: within(reach) }],
  },
};
