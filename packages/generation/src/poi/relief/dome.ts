import type { GenerationState } from "../../process";
import { carryWhereItLands, costNear, stays } from "../poiCarry";
import { notApplicable, type PoiEntry, type PoiPlace } from "../poiContract";
import { holds, namingCultureNear, regionPlaces, within } from "../poiPlaces";
import { heightAt, isLand } from "../poiReads";
import { aloneAmong, attachment, drawnWhen, sized, standsOut } from "../poiVisibilityRules";
import {
  areaOf,
  holdAt,
  landmarkGround,
  lastsWhile,
  meanOf,
  nearestOrTop,
  raisedAsCaptured,
  reliefOf,
  sameSpot,
  sitingAdmits,
  sitingSuits,
  spans,
} from "./reliefShape";

/** Area and relief at which a dome is half as great as domes get: its default record's diameter. */
const typicalArea = 1_600_000_000,
  typicalRelief = 150;
/** The rim's dear ground to the network, as the regional landmark cause has it. */
const ringCost = 4;

/** Metres a buried salt bed under strain has lifted the ground, as Salt's own dome step books it. */
const saltLifted = (state: GenerationState, cell: number) =>
  state.physical?.magic?.fields.find((f) => f.definition.id === "salt")?.domed?.get(cell) ?? 0;
const inRecord = (state: GenerationState, cell: number) =>
  landmarkGround(state, "dome-ring", (placed) => (placed.parameters.diameter * 1000) / 2).has(cell);
const isA = (state: GenerationState, cell: number) =>
  isLand(state, cell) && (inRecord(state, cell) || saltLifted(state, cell) > 0);
const places = regionPlaces("dome", isA, heightAt);
const isSalt = (state: GenerationState, place: PoiPlace) => saltLifted(state, place.anchor) > 0;
const counterpart = nearestOrTop(isA);
const factors = {
  magnitude: meanOf(sized(areaOf, typicalArea), sized(reliefOf, typicalRelief)),
  localConditions: standsOut(heightAt, spans(8)),
  isolation: aloneAmong(places, spans(12)),
  cultural: attachment(spans(8)),
};

export const dome: PoiEntry = {
  id: "dome",
  group: "relief",
  name: "Dome",
  recognition: {
    distinct:
      "A land cell inside a dome-ring record's radius, or one the Salt system's dome step has lifted over a buried bed under strain. A dome is ground pushed up from beneath: a volcano is built on top by lava and flagged, a crater is excavated, and a summit is only a top, which a dome may or may not have. An eroded ring dome and a salt dome are one kind; rings of hard and soft rock or a ring of brine springs are properties of each.",
    isA,
  },
  existence: {
    statement:
      "Both: an eroded dome is sited on quiet low dry ground by a landmark record, which exposes its rings as erosion goes on; a salt dome emerges wherever a buried bed meets enough strain, one bounded rise an epoch.",
    way: "both",
    requires: sitingAdmits("dome-ring"),
    suitability: sitingSuits("dome-ring"),
    places,
  },
  fields: {
    statement:
      "A dome lifts the ground and holds the lift: a ring dome's alternating hard and soft rock stands up as concentric ridges, and a salt dome leaks brine to the ring of ground around it, which Salt carries from there.",
    terrain: (state, place) => [
      ...holdAt(state, "atLeast", "Elevation", place.cells),
      ...holdAt(state, "atLeast", "RockResistance", place.cells),
    ],
    water: notApplicable(
      "Its rings turn drainage, which the cost below states; the brine it leaks is Salt's stock, not water."
    ),
    climate: notApplicable("A broad low rise is below what the air columns turn."),
    cover: notApplicable("Cover follows the rings' soil and any salting through ecology."),
    magic: (state, place) =>
      holdAt(
        state,
        "atLeast",
        "Salting",
        place.cells.filter((cell) => saltLifted(state, cell) > 0)
      ),
  },
  acrossMaps: {
    statement:
      "A dome-ring record is re-placed on the refined map; its rings are maintained by its own cause and the network treats each rim as dear ground. A salt dome keeps the lift it carried: the developed top near it stands as high as the parent's ground did.",
    carry: carryWhereItLands,
    realize: (state, carried) => raisedAsCaptured(state, carried, counterpart(state, carried)),
    counterpart,
    unrealized: stays,
    settle: notApplicable("Its lift is bounded per epoch; a round's water does not change it."),
  },
  movement: {
    statement:
      "Rings turn roads and rivers around them, so tracks and streams on a dome run in arcs; on a salt dome, brine moves with the crust and comes up at the ring.",
    roads: costNear(1.5),
    boats: notApplicable("A dome has no water to carry boats."),
    drainage: costNear(ringCost),
    magic: costNear(0.8),
    crosses: notApplicable("A dome turns routes; it takes none across a barrier."),
  },
  others: {
    statement:
      "A dome cannot share its centre with a volcano or crater. A salt dome stands near pans and flats of the same bed; springs and mines gather at a ring.",
    needs: notApplicable("A record or a buried bed makes it; neither is a catalogue place."),
    excludes: [
      { kind: "volcano", holds: sameSpot },
      { kind: "crater", holds: sameSpot },
    ],
    contains: [
      { kind: "spring", holds },
      { kind: "mine", holds },
    ],
    pairsWith: [
      { kind: "saltPan", holds: within(spans(6)) },
      { kind: "glassFlat", holds: within(spans(6)) },
    ],
  },
  people: {
    statement:
      "A dome is a low defensible rise with exposed rock, a place of ring-shaped wonder; a salt dome also gives salt, which is worth more than the stone.",
    offers(state, place) {
      const great = factors.magnitude(state, place);
      return {
        materials: isSalt(state, place) ? Math.max(great, 0.5) : great / 2,
        sanctity: great,
        defence: great / 3,
      };
    },
    threatens: notApplicable("A dome rises too slowly and too gently to threaten anyone."),
  },
  time: {
    statement:
      "A ring dome's relief grows as erosion cuts the soft rings; a salt dome rises until its bound is spent or its bed has seeped away. A record keeps its rings; a salt dome lasts while its lift is on the books.",
    fate: lastsWhile(isA),
  },
  visibility: {
    statement:
      "A dome shows by its width and its relief over flat country, which is the only place it is seen at all; it earns little among hills, where it is one more rise.",
    ...factors,
    visibleAt: drawnWhen(factors, { magnitude: 0.45, localConditions: 0.45, isolation: 0.1 }),
  },
  naming: {
    statement:
      "A dome the generator sited is named once and keeps it; others are named by the nearest people, for their shape or their salt.",
    namedBy: namingCultureNear,
    takesNameFrom: notApplicable("A dome is named for its form; nothing near it lends a name."),
    lendsNameTo: [{ kind: "settlement", holds: within(spans(6)) }],
  },
};
