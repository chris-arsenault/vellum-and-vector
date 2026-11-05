import { canyonCells } from "../../canonry/landmarkCanyon";
import { incisedReach } from "../../canonry/landforms";
import type { GenerationState } from "../../process";
import { corridorCost } from "../../regional/causes/landmark";
import type { RegionalState } from "../../regional/state";
import { carryWhereItLands, costNear, counterpartOf, movesTo } from "../poiCarry";
import { notApplicable, type PoiCarried, type PoiEntry, type PoiPlace } from "../poiContract";
import { holds, namingCultureNear, regionPlaces, within } from "../poiPlaces";
import { courseRecord } from "../poiRecords";
import { dischargeAt, fieldOf, heldFor, isLand, landformAt, Landform, metres } from "../poiReads";
import { aloneAmong, attachment, sized, standsOut, weighed } from "../poiVisibilityRules";
import { onMappedRiver } from "../water/waterReads";
import {
  landmarksOf,
  lengthOf,
  loweredAsCaptured,
  meanOf,
  reliefOf,
  sitingAdmits,
  sitingSuits,
  spans,
  standsIn,
} from "./reliefShape";

/** Length and rim-to-floor relief at which a gorge is half as great: a world gorge's. */
const typicalLength = 100_000,
  typicalRelief = 300;
/** Discharge at which a gorge's river is half as great as they get. */
const typicalDischarge = 250;

/** The floor cells of every canyon record, by the generator's own canyon geometry. */
const canyonFloors = (state: GenerationState) =>
  heldFor(state, "relief:canyonFloors", () => {
    const floors = new Set<number>();
    for (const placed of landmarksOf(state, "canyon")) {
      const record = state.physical?.landmarks?.get(placed.landmark.id);
      for (const { i } of canyonCells(fieldOf(state), placed, record?.corridor).floor)
        floors.add(i);
    }
    return floors;
  });
/** The classifier's gorge test, read where a waterfall's code has taken precedence over it. */
const incised = (state: GenerationState, cell: number) =>
  incisedReach(fieldOf(state), state.physical!.profile, cell);
const isA = (state: GenerationState, cell: number) => {
  if (!isLand(state, cell)) return false;
  const code = landformAt(state, cell);
  return (
    code === Landform.Gorge ||
    (code === Landform.Waterfall && incised(state, cell)) ||
    canyonFloors(state).has(cell)
  );
};
const incisionAt = (state: GenerationState, cell: number) =>
  metres(fieldOf(state).CumulativeFluvialErosion.get(cell));
const places = regionPlaces("gorge", isA, incisionAt);
const dischargeOf = (state: GenerationState, place: PoiPlace) => dischargeAt(state, place.anchor);
const counterpart = counterpartOf(isA, 1);
const isCanyonRecord = (carried: PoiCarried) =>
  carried.feature.kind === "landmark" && carried.feature.attributes.landmarkKind === "canyon";
const factors = {
  magnitude: meanOf(sized(lengthOf, typicalLength), sized(reliefOf, typicalRelief)),
  localConditions: standsOut(incisionAt, spans(6)),
  isolation: aloneAmong(places, spans(12)),
  cultural: attachment(spans(8)),
};
const course = courseRecord({ kind: "gorge", layer: "geology", name: "Gorge" });

export const gorge: PoiEntry = {
  id: "gorge",
  group: "relief",
  name: "Gorge",
  recognition: {
    distinct:
      "A land cell on a river that is both steep and deeply incised, the classifier's Landform.Gorge (or the same test under its Waterfall code, since a fall in a gorge stays in it), or on the floor of a canyon record. It is the incision that decides: a steep unincised torrent is a slope with a river on it, a deep gentle corridor a valley, and a single step in the long profile a waterfall. A canyon is this kind with a record behind it: wider, with resistant rims and a captured river, kept as properties.",
    isA,
  },
  existence: {
    statement:
      "Both: emerging wherever a river keeps cutting through rising or resistant ground, and sited as a canyon where a plateau stands beside a large river, which the generator captures along the drawn path.",
    way: "both",
    requires: sitingAdmits("canyon"),
    suitability: sitingSuits("canyon"),
    places,
  },
  publication: {
    statement:
      "A gorge publishes as the course its river runs through it. A canyon record publishes as that record, once.",
    moment: "geography",
    record: (state, place) => (canyonFloors(state).has(place.anchor) ? null : course(state, place)),
  },
  fields: {
    statement:
      "A gorge confines a river: its floor is cut down, its walls keep their rock, and the river has no floodplain to spread into while the walls stand.",
    terrain: notApplicable("Fluvial incision cuts the floor; a canyon record maintains its own."),
    water: notApplicable("The floodplain process spreads only below its maximum slope."),
    climate: notApplicable("Its shade and damp are below what the climate field resolves."),
    cover: notApplicable("Cover on its walls follows the slope and soil ecology already reads."),
    magic: notApplicable(
      "It adds no magic of its own; Fire's gravels and any carried stock pass along the river in it."
    ),
  },
  acrossMaps: {
    standsOn: "river",
    statement:
      "A captured gorge lands on the refined river: the floor lies no higher than the parent's and the network is drawn into it. A canyon record is re-placed and its signature held by its own cause; if an emergent gorge finds no incised reach it takes the nearest one, and otherwise goes.",
    carry: carryWhereItLands,
    realize: (state: RegionalState, carried) =>
      loweredAsCaptured(state, carried, counterpart(state, carried)),
    counterpart,
    unrealized(state, carried) {
      if (counterpart(state, carried) >= 0) return movesTo(counterpart)(state, carried);
      return isCanyonRecord(carried) ? { outcome: "keep" } : { outcome: "drop" };
    },
    settle: notApplicable("Its incision is booked over epochs, not with a round's water."),
    schedule: notApplicable("A canyon record's steps belong to its landmark cause."),
  },
  movement: {
    statement:
      "A gorge is a barrier to roads across it and along it, a rough passage for boats, and a corridor the drainage network is drawn into; a river's carried magic passes through quicker for the confinement.",
    roads: costNear(3),
    boats: costNear(2),
    drainage: (state, place) => costNear(corridorCost)(state, place),
    magic: { river: costNear(0.8) },
    links: notApplicable("A gorge joins nothing."),
    crosses: notApplicable("It is the barrier; a bridge is what crosses it."),
  },
  others: {
    statement:
      "A gorge stands on a river, holds falls and is spanned by bridges; it cuts back into scarps and plateaus and widens below into a valley. It cannot stand in a lake.",
    needs: notApplicable("Its test already reads the river; a canyon record captures its own."),
    excludes: [{ kind: "lake", holds: standsIn }],
    contains: [{ kind: "waterfall", holds }],
    pairsWith: [
      { kind: "valley", holds: within(spans(4)) },
      { kind: "escarpment", holds: within(spans(6)) },
      { kind: "plateau", holds: within(spans(6)) },
      { kind: "bridge", holds: within(spans(2)) },
    ],
  },
  people: {
    statement:
      "A gorge is a wall against an army and a head of water; it is awe to those who come to it, and floods rise fast where a river has nowhere to spread.",
    offers(state, place) {
      const great = factors.magnitude(state, place);
      return {
        defence: great,
        power: sized(dischargeOf, typicalDischarge)(state, place),
        sanctity: great / 2,
      };
    },
    threatens: (state, place) => [
      {
        hazard: "flash flood",
        reach: spans(4)(state),
        severity: sized(dischargeOf, typicalDischarge)(state, place),
      },
    ],
  },
  time: {
    statement:
      "A gorge deepens and cuts back while its river runs. When the river leaves or the walls grade back, it is a valley; a fall retreating up it leaves more gorge behind.",
    fate: (state, place) =>
      onMappedRiver(state, place.anchor)
        ? { fate: "persists" }
        : { fate: "becomes", kind: "valley" },
  },
  visibility: {
    statement:
      "A gorge shows by length and depth together, and by how deeply its river has cut against the country round it; a modest gorge at a border town shows sooner than a greater empty one.",
    ...factors,
    importance: weighed(factors, { magnitude: 0.6, localConditions: 0.25, isolation: 0.15 }),
  },
  naming: {
    statement: "Named by the nearest people, or after its river; a canyon record keeps its name.",
    namedBy: namingCultureNear,
    takesNameFrom: notApplicable("Rivers are not catalogue places; nothing else names a gorge."),
    lendsNameTo: [
      { kind: "waterfall", holds },
      { kind: "settlement", holds: within(spans(6)) },
    ],
  },
};
