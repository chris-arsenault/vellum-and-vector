// @needsResolution carry: a carried place may not resolve on a finer map (ADR 0009).
import type { GenerationState } from "../../process";
import { carryWhereItLands, costNear, counterpartOf, movesTo } from "../poiCarry";
import { notApplicable, type PoiEntry, type PoiPlace } from "../poiContract";
import { holds, namingCultureNear, regionPlaces, within } from "../poiPlaces";
import { areaRecord } from "../poiRecords";
import {
  dischargeAt,
  heightAt,
  isLand,
  hasChannel,
  landformAt,
  Landform,
  moistureAt,
} from "../poiReads";
import { aloneAmong, attachment, sized, standsOut, weighed } from "../poiVisibilityRules";
import {
  holdGradient,
  lastsWhile,
  lengthOf,
  loweredAsCaptured,
  meanOf,
  sameSpot,
  sectionAt,
  spans,
} from "./reliefShape";

/** A flank depth and length at which a valley is half as great as valleys get: a world gorge's. */
const typicalDepth = 300,
  typicalLength = 100_000;

const classed = (state: GenerationState, cell: number) => {
  const code = landformAt(state, cell);
  return code === Landform.Valley || code === Landform.UValley;
};
const depthAt = (state: GenerationState, cell: number) => sectionAt(state, cell).trough;
const isA = (state: GenerationState, cell: number) =>
  isLand(state, cell) && classed(state, cell) && depthAt(state, cell) > 0;
const places = regionPlaces("valley", isA, depthAt);
const depthOf = (state: GenerationState, place: PoiPlace) => depthAt(state, place.anchor);
const glacial = (state: GenerationState, place: PoiPlace) =>
  landformAt(state, place.anchor) === Landform.UValley;
const counterpart = counterpartOf(isA, 1);
const factors = {
  magnitude: meanOf(sized(depthOf, typicalDepth), sized(lengthOf, typicalLength)),
  localConditions: standsOut((state, cell) => -heightAt(state, cell), spans(6)),
  isolation: aloneAmong(places, spans(12)),
  cultural: attachment(spans(10)),
};

export const valley: PoiEntry = {
  id: "valley",
  group: "relief",
  name: "Valley",
  recognition: {
    distinct:
      "A land cell the generator classes Landform.Valley or Landform.UValley, on which a cross-section's lower flank stands above it: a corridor cut by water or ice, with ground rising on both sides. A channel across open plain has no flanks and is not one; a gorge is the steep incised reach, classed apart; a basin rises every way and has no outlet line. A river-cut V and an ice-cut U are one kind: the code at a cell records which cut it, as a property.",
    isA,
  },
  existence: {
    statement:
      "Emerges where water or ice has worn a line through higher ground, including ancestral valleys that keep their erosion after the river is gone; regional refinement grows the same corridors from its drainage network.",
    way: "emerges",
    requires: notApplicable("A valley is read from the classes and terrain the generator wrote."),
    suitability: notApplicable("Nothing chooses a valley's line; the drainage does."),
    places,
  },
  publication: {
    statement: "Each connected corridor publishes as its outline, with its depth.",
    moment: "geography",
    record: areaRecord({
      kind: "valley",
      layer: "geology",
      name: "Valley",
      attributes: (state, place) => ({ depth: depthOf(state, place) }),
    }),
  },
  fields: {
    statement:
      "A valley is a corridor and a store: its floor grows no steeper, and it holds the floodplain, the soil and the running water of the ground around it.",
    terrain: (state, place) => holdGradient(state, place.cells),
    water: notApplicable("The floodplain process spreads along its rivers."),
    climate: notApplicable(
      "Cold pooling on its floor is a regional shared medium; the field has no band for it to hold."
    ),
    cover: notApplicable("Ecology's soils deepen on its floor from what the rivers lay."),
    magic: notApplicable(
      "It sources nothing itself: rivers carry what they carry through it, and Aurora's light wells admit its floor by their own rule."
    ),
  },
  acrossMaps: {
    statement:
      "A captured valley is the finer network's own corridor: its floor lies no higher than the parent's and the river finds it. If the ground there holds no flanks, the name moves to the nearest that does.",
    carry: carryWhereItLands,
    realize: (state, carried) => loweredAsCaptured(state, carried, counterpart(state, carried)),
    counterpart,
    unrealized: movesTo(counterpart),
    settle: notApplicable("Valley floors are re-derived from the network each round, not settled."),
    schedule: notApplicable("Its floor and drainage cost are all a valley asks of a refinement."),
  },
  movement: {
    statement:
      "A valley draws everything along it: roads follow its floor through the grade, the network runs down it, and river-borne and walked magic moves faster through it.",
    roads: notApplicable("The ruling-grade cost already favours its gentle floor."),
    boats: notApplicable("Boats read the river down its floor; the valley around it adds nothing."),
    drainage: costNear(0.5),
    magic: { river: costNear(0.8), people: costNear(0.8) },
    links: notApplicable("A valley joins nothing."),
    crosses: notApplicable(
      "It leads to a crossing; only a pass or a ford takes a route over the barrier."
    ),
  },
  others: {
    statement:
      "A valley runs between ridges and up to passes and cirques, may narrow to a gorge, and is where settlements, mills and fords gather.",
    needs: notApplicable("Its classes and flanks are all it needs."),
    excludes: [{ kind: "gorge", holds: sameSpot }],
    contains: [
      { kind: "settlement", holds },
      { kind: "ford", holds },
      { kind: "mill", holds },
    ],
    pairsWith: [
      { kind: "ridge", holds: within(spans(4)) },
      { kind: "gorge", holds: within(spans(4)) },
      { kind: "pass", holds: within(spans(4)) },
      { kind: "cirque", holds: within(spans(4)) },
    ],
  },
  people: {
    statement:
      "A valley gives water, deep soil, a way through and shelter, more where it is wet and carries a large river. An ice-cut floor is wider and gives more ground; a river in spate takes what stands on its floor.",
    offers(state, place) {
      const water = sized((s, p) => dischargeAt(s, p.anchor), 100)(state, place);
      return {
        water,
        food: glacial(state, place) ? 1 : moistureAt(state, place.anchor),
        trade: factors.magnitude(state, place),
      };
    },
    threatens: (state, place) =>
      hasChannel(state, place.anchor)
        ? [
            {
              hazard: "flood",
              reach: 2 * spans(1)(state),
              severity: sized((s, p) => dischargeAt(s, p.anchor), 250)(state, place),
            },
          ]
        : [],
  },
  time: {
    statement:
      "A valley deepens while its river runs and outlives it as an ancestral corridor; ice widens one into a trough, and the same place then reads as glacial. It lasts until filled.",
    fate: lastsWhile(isA),
  },
  visibility: {
    statement:
      "A valley shows by depth and length and by the people along it; the one that holds a country's towns shows long before a deeper empty one.",
    ...factors,
    importance: weighed(factors, { magnitude: 0.6, localConditions: 0.25, isolation: 0.15 }),
  },
  naming: {
    statement:
      "Named by those who live in it, usually after its river or its chief town, and it names what stands in it in turn.",
    namedBy: namingCultureNear,
    takesNameFrom: [{ kind: "settlement", holds }],
    lendsNameTo: [{ kind: "settlement", holds }],
  },
};
