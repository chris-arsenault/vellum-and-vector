import type { GenerationState } from "../../process";
import { channelNear, crestAt } from "../../regional/causes/dam";
import type { RegionalState } from "../../regional/state";
import { carryWhereItLands, costNear, goes, movesTo } from "../poiCarry";
import { notApplicable, type PoiCarried, type PoiEntry, type PoiPlace } from "../poiContract";
import {
  holdsRecord,
  namingCultureNear,
  recordPlaces,
  settlementWithin,
  within,
} from "../poiPlaces";
import { cellSpan, dischargeAt, fieldOf, isRiver, shareAround, slopeAt } from "../poiReads";
import { aloneAmong, attachment, drawnWhen, sized, standsOut } from "../poiVisibilityRules";

/** A bank gentler than this does not hold a reservoir in. */
const gentleBank = 0.02;
/** Discharge at which a dam's river is half as great as dammed rivers get. */
const typicalDischarge = 250;

const places = recordPlaces("dam", (f) => f.kind === "dam");
const isA = holdsRecord("dam", places);
const dischargeOf = (state: GenerationState, place: PoiPlace) => dischargeAt(state, place.anchor);
const around = (state: GenerationState) => 6 * cellSpan(state);
/** People build a dam only within reach of where they live. */
const wantedFrom = (state: GenerationState) => 3 * around(state);
const factors = {
  magnitude: sized(dischargeOf, typicalDischarge),
  localConditions: standsOut((state, cell) => (isRiver(state, cell) ? 1 : 0), around),
  isolation: aloneAmong(places, around),
  cultural: attachment(around),
};
const counterpart = (state: RegionalState, carried: PoiCarried) => channelNear(state, carried.cell);

export const dam: PoiEntry = {
  id: "dam",
  group: "settlements",
  name: "Dam",
  recognition: {
    distinct:
      "A published work standing on a river cell that holds back a reservoir: a built barrier across a channel. A weir is the same kind at a lower crest; a lake it makes is the lake entry.",
    isA,
  },
  existence: {
    statement:
      "Sited by a community of at least 500 people short of water, on a river carrying enough flow; the society simulation plans it, and refinement realizes the crest and basin the record only names.",
    way: "sited",
    requires: (state, cell) =>
      isRiver(state, cell) && settlementWithin(state, cell, wantedFrom(state)),
    /** A narrow valley on a large river: steep banks either side, plenty of water to hold. */
    suitability(state, cell) {
      const banks = shareAround(state, cell, (next) => slopeAt(state, next) >= gentleBank),
        flow = dischargeAt(state, cell);
      return (banks + flow / (flow + typicalDischarge)) / 2;
    },
    places,
  },
  fields: {
    statement:
      "A dam blocks flow and stores it behind a crest, so the ground above it floods and the river below it runs regulated.",
    terrain: notApplicable(
      "The crest is an earthwork below the field's resolution at world scale; on a refined map it is realized below."
    ),
    water(state, place) {
      const map = fieldOf(state),
        value = map.Elevation.get(place.anchor);
      return [{ change: "atLeast", band: "WaterSurfaceElevations", cell: place.anchor, value }];
    },
    climate: notApplicable(
      "A reservoir's effect on climate is below what the climate field resolves."
    ),
    cover: notApplicable("Flooded ground loses cover through the ecology process reading water."),
    magic: notApplicable(
      "A dam holds no magic of its own; Greenwood and Salt read the lake it makes."
    ),
  },
  acrossMaps: {
    statement:
      "A captured dam snaps to the refined channel near its record; its crest is the lower of the valley's banks, and the water behind it fills the ground below the crest. If no channel lies within reach, the dam goes.",
    carry: carryWhereItLands,
    realize(state, carried) {
      const cell = counterpart(state, carried);
      return cell < 0
        ? []
        : [
            {
              change: "atLeast",
              band: "WaterSurfaceElevations",
              cell,
              value: crestAt(state, cell),
            },
          ];
    },
    counterpart,
    unrealized: (state, carried) =>
      counterpart(state, carried) >= 0 ? movesTo(counterpart)(state, carried) : goes(),
    settle: notApplicable(
      "Its reservoir is written after each round's water by the cause it keeps."
    ),
  },
  movement: {
    statement:
      "A dam bars boats, and a road can cross a river along its crest; the drainage network keeps running through it.",
    roads: costNear(0.8),
    boats: costNear(Infinity),
    drainage: notApplicable("Water still reaches the cell; only its level changes."),
    magic: notApplicable("Magic carried by a river passes with the water let through."),
    crosses: () => ["river"],
  },
  others: {
    statement:
      "A dam needs a settlement to want it and a narrowing river to hold it; it makes a lake behind it and starves any fall below it.",
    needs: [{ kind: "settlement", holds: within((state) => 3 * around(state)) }],
    excludes: [{ kind: "waterfall", holds: (_state, a, b) => a.anchor === b.anchor }],
    contains: notApplicable("A dam is one point on a river."),
    pairsWith: [
      { kind: "lake", holds: within(around) },
      { kind: "mill", holds: within(around) },
      { kind: "irrigation", holds: within((state) => 2 * around(state)) },
    ],
  },
  people: {
    statement: "A dam gives water and power; if it fails the flood runs down the valley below it.",
    offers(state, place) {
      const size = factors.magnitude(state, place);
      return { water: size, power: size };
    },
    threatens: (state, place) => [
      {
        hazard: "dam failure",
        reach: 2 * around(state),
        severity: factors.magnitude(state, place),
      },
    ],
  },
  time: {
    statement:
      "A dam silts up over time and, when its people go, fails and leaves a silted flat with a breached crest.",
    fate(state, place) {
      const kept = factors.cultural(state, place) > 0;
      return kept ? { fate: "persists" } : { fate: "ends", leaves: "ruin" };
    },
  },
  visibility: {
    statement:
      "A dam shows by the size of the river it holds and the lake behind it; one that feeds a capital carries more than its size.",
    ...factors,
    visibleAt: drawnWhen(factors, { magnitude: 0.6, localConditions: 0.2, isolation: 0.2 }),
  },
  naming: {
    statement: "Named by those who built it, and often after the settlement that built it.",
    namedBy: namingCultureNear,
    takesNameFrom: [{ kind: "settlement", holds: within(around) }],
    lendsNameTo: [{ kind: "lake", holds: within(around) }],
  },
};
