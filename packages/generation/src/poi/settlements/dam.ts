// @needsResolution carry: follows its river; without one it may not resolve (ADR 0009).
import { generationFeatures } from "../../generationFeatures";
import type { GenerationState } from "../../process";
import type { RegionalState } from "../../regional/state";
import { carryWhereItLands, costNear, goes, movesTo } from "../poiCarry";
import {
  notApplicable,
  type PoiCarried,
  type PoiEntry,
  type PoiFieldChange,
  type PoiPlace,
} from "../poiContract";
import { holdsRecord, namingCultureNear, within } from "../poiPlaces";
import {
  cellSpan,
  dischargeAt,
  fieldOf,
  releaseHeld,
  shareAround,
  slopeAt,
  toNative,
} from "../poiReads";
import { onMappedRiver } from "../water/waterReads";
import { aloneAmong, attachment, sized, standsOut } from "../poiVisibilityRules";
import {
  channelAt,
  channelNear,
  crestAt,
  holdReservoir,
  nextBody,
  upstreamIndex,
} from "./damReservoir";
import { keptLine, nearTown, strengthOf, weighedPlace, workReach } from "./settlementRecords";
import { workPlaces, workRecord } from "./workRecords";

/** A bank gentler than this does not hold a reservoir in. */
const gentleBank = 0.02;
/** Discharge at which a dam's river is half as great as dammed rivers get. */
const typicalDischarge = 250;
/** People build a dam only within this many metres of where they live. */
const wantedReach = 30_000;
/** The least distance between two dams people site, and a sited dam's reach, in metres. */
const damSpacing = 40_000,
  damRadius = 300;
/** Height a dam's crest adds at full strength, in metres. */
const crestHeight = 6;

const requires = (state: GenerationState, cell: number) =>
  onMappedRiver(state, cell) && nearTown(state, cell, wantedReach);
/** A narrow valley on a large river: steep banks either side, plenty of water to hold. */
function suitability(state: GenerationState, cell: number) {
  const banks = shareAround(state, cell, (next) => slopeAt(state, next) >= gentleBank),
    flow = dischargeAt(state, cell);
  return (banks + flow / (flow + typicalDischarge)) / 2;
}
const places = workPlaces("dam", "dam", {
  record: "dam",
  layer: "waterworks",
  label: "Dam",
  radius: damRadius,
  spacing: damSpacing,
  requires,
  suitability,
});
const isA = holdsRecord("dam", places);
const dischargeOf = (state: GenerationState, place: PoiPlace) => dischargeAt(state, place.anchor);
const around = (state: GenerationState) => 6 * cellSpan(state);
const wantedFrom = () => wantedReach;
/** The cells each dam on this map holds a reservoir behind: captured records, and its own places. */
function damCells(state: RegionalState) {
  const cells = new Set<number>();
  for (const f of generationFeatures(state, { areaId: state.regional.input.areaId }))
    if (f.kind === "dam" && f.geometry.type === "Point") {
      const [x, y] = f.geometry.coordinates;
      cells.add(channelAt(state, x, y));
    }
  for (const place of places(state)) cells.add(channelNear(state, place.anchor));
  cells.delete(-1);
  return cells;
}
const factors = {
  magnitude: sized(dischargeOf, typicalDischarge),
  localConditions: standsOut((state, cell) => (onMappedRiver(state, cell) ? 1 : 0), around),
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
      "A work standing on a river cell that holds back a reservoir: a built barrier across a channel. A weir is the same kind at a lower crest; a lake it makes is the lake entry.",
    isA,
  },
  existence: {
    statement:
      "Sited two ways: the society simulation's located dams, and on every map the narrow valleys on sizeable rivers within reach of a settlement, at least 40 km apart. Refinement realizes the crest and basin a record only names.",
    way: "sited",
    requires,
    suitability,
    places,
  },
  publication: {
    statement:
      "A dam publishes as a located work; the World shows those people sited by the ground but none of the simulation's own, which stay demands.",
    moment: "society",
    record: workRecord,
  },
  fields: {
    statement:
      "A dam raises a crest, blocks flow and stores it behind that crest, so the ground above it floods and the river below it runs regulated. A kept dam keeps the bank it stands on as a line Hallowed reads.",
    terrain: (state, place): readonly PoiFieldChange[] =>
      workReach(state, place).map(({ cell, share }) => ({
        change: "add",
        band: "Elevation",
        cell,
        amount: toNative(crestHeight * strengthOf(place) * share),
      })),
    water(state, place) {
      const map = fieldOf(state),
        value = map.Elevation.get(place.anchor);
      return [{ change: "atLeast", band: "WaterSurfaceElevations", cell: place.anchor, value }];
    },
    climate: notApplicable(
      "A reservoir's effect on climate is below what the climate field resolves."
    ),
    cover: notApplicable("Flooded ground loses cover through the ecology process reading water."),
    magic: (_state, place) => keptLine(place),
  },
  acrossMaps: {
    standsOn: "river",
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
    settle: notApplicable("Its reservoir is written after each round's water by its schedule."),
    /**
     * A dam holds a reservoir (plan F3): the crest is the lower of the valley's two banks at its
     * cell, and the water stage behind it fills the ground below the crest that drains to it.
     * Written after each round's water as a lake body, so ecology, Salt and society read a lake.
     */
    schedule: {
      kind: "dam",
      respond(state) {
        if (!state.regional.input.domains.includes("physical")) return;
        releaseHeld(state);
        const children = upstreamIndex(state);
        let body = nextBody(state);
        for (const dam of damCells(state)) if (holdReservoir(state, dam, children, body)) body++;
        releaseHeld(state);
      },
    },
  },
  movement: {
    statement:
      "A dam bars boats, and a road can cross a river along its crest; the drainage network keeps running through it.",
    roads: costNear(0.8),
    boats: costNear(Infinity),
    drainage: notApplicable("Water still reaches the cell; only its level changes."),
    magic: notApplicable("Magic carried by a river passes with the water let through."),
    links: notApplicable("A dam joins nothing; its crest is a road over the river it holds."),
    crosses: () => ["river"],
  },
  others: {
    statement:
      "A dam needs a settlement to want it and a narrowing river to hold it; it makes a lake behind it and starves any fall below it.",
    needs: [{ kind: "settlement", holds: within(wantedFrom) }],
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
    importance: weighedPlace(factors, { magnitude: 0.6, localConditions: 0.2, isolation: 0.2 }),
  },
  naming: {
    statement: "Named by those who built it, and often after the settlement that built it.",
    namedBy: namingCultureNear,
    takesNameFrom: [{ kind: "settlement", holds: within(around) }],
    lendsNameTo: [{ kind: "lake", holds: within(around) }],
  },
};
