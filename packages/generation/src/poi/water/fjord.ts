// @needsResolution carry: a carried place may not resolve on a finer map (ADR 0009).
import { Landform } from "../../canonry/codes";
import { worldFjordLength } from "../../canonry/worldSiteEvidence";
import { regionEvidence } from "../../canonry/worldRegionEvidence";
import type { GenerationState } from "../../process";
import { regionalFjordErosion } from "../../regional/profile";
import type { RegionalState } from "../../regional/state";
import { carryWhereItLands, costNear, counterpartOf, goes, movesTo } from "../poiCarry";
import {
  notApplicable,
  type PoiCarried,
  type PoiEntry,
  type PoiFieldChange,
  type PoiPlace,
} from "../poiContract";
import { namingCultureNear, regionPlaces, within } from "../poiPlaces";
import { areaRecord } from "../poiRecords";
import { fieldOf, heldFor, isSea, landformAt, metres, toNative } from "../poiReads";
import { aloneAmong, attachment, sized, standsOut, weighed } from "../poiVisibilityRules";
import { spans } from "./waterReads";

/** Metres of water under which a trough has filled to an ordinary bay. */
const filled = 5;
/** Metres a trough stands drowned, at least, to read as one. */
const troughDepth = 30;

const isA = (state: GenerationState, cell: number) => landformAt(state, cell) === Landform.Fjord;
const depthAt = (state: GenerationState, cell: number) =>
  metres(fieldOf(state).WaterDepths.get(cell));
const places = regionPlaces("fjord", isA, depthAt);
const around = spans(8);
const lengthOf = (state: GenerationState, place: PoiPlace) =>
  heldFor(state, `fjord:${place.id}:span`, () => regionEvidence(fieldOf(state), place.cells).span);
const greatness = sized(lengthOf, worldFjordLength);
const counterpart = counterpartOf(isA, 1);
const factors = {
  magnitude: greatness,
  /** Its depth against the water and ground around it: a trough cut far below its shelf. */
  localConditions: standsOut(depthAt, around),
  isolation: aloneAmong(places, around),
  cultural: attachment(around),
};

/** The bed stays under the sea: what rivers bring cannot raise it above the trough's depth. */
const heldTrough = (state: GenerationState, place: PoiPlace): readonly PoiFieldChange[] => {
  const map = fieldOf(state);
  return place.cells.map((cell) => ({
    change: "atMost",
    band: "Elevation",
    cell,
    value: map.EffectiveSeaLevel - toNative(Math.min(depthAt(state, cell), troughDepth)),
  }));
};
/**
 * The finer ground must hold the trough: its landing cell stands drowned, and the sea the
 * record covers keeps the glacial erosion the refined landform test reads.
 */
function realizedTrough(state: RegionalState, carried: PoiCarried): readonly PoiFieldChange[] {
  const value = toNative(regionalFjordErosion);
  return [
    {
      change: "atMost",
      band: "Elevation",
      cell: carried.cell,
      value: fieldOf(state).EffectiveSeaLevel - toNative(troughDepth),
    },
    ...carried.cells
      .filter((cell) => cell === carried.cell || isSea(state, cell))
      .map((cell): PoiFieldChange => ({
        change: "atLeast",
        band: "CumulativeGlacialErosion",
        cell,
        value,
      })),
  ];
}

export const fjord: PoiEntry = {
  id: "fjord",
  group: "water",
  name: "Fjord",
  recognition: {
    distinct:
      "A cell whose LandformCodes is Fjord: Ocean water that was glacially scoured (UValley, Cirque, or enough CumulativeGlacialErosion) with land on opposite flanks within the half-width, as the landform process's flanked test decides. The flanks tell it from scoured open shelf, which is Seabed; the glacial erosion tells it from a bay or strait, which are not ice-cut; and being drowned tells it from a glacial valley, its dry counterpart.",
    isA,
  },
  existence: {
    statement:
      "Emerges where ice cut a trough below today's sea and the sea came in behind it. It takes its ice from a past epoch, so it exists only after a glaciation and with the coast's height where it is.",
    way: "emerges",
    requires: notApplicable(
      "The landform process has already read the ice and the flanks it needs."
    ),
    suitability: notApplicable("No process chooses where ice cut; the landform reports it."),
    places,
  },
  publication: {
    statement: "Every fjord publishes as its outline, sea and all, with its length and depth.",
    moment: "geography",
    record: areaRecord({
      kind: "fjord",
      layer: "geology",
      name: "Fjord",
      attributes: (state, place) => ({
        length: lengthOf(state, place),
        depth: depthAt(state, place.anchor),
      }),
    }),
  },
  fields: {
    statement:
      "A fjord holds a deep arm of the sea into the land: its bed stays below the trough's depth, and the short steep streams of its walls drop straight into it. Its shelter is the wave process reading its short fetch.",
    terrain: heldTrough,
    water: notApplicable(
      "The currents and shore processes write WaveExposure from fetch across the whole sea; the flanks already limit it there."
    ),
    climate: notApplicable(
      "A narrow arm is a thin strip under the coast's own air; it moves no field the climate resolves."
    ),
    cover: notApplicable(
      "Its surface is sea and carries no cover; its flanks follow their own height."
    ),
    magic: notApplicable(
      "Aurora's shelf stock lands wherever ice reached the sea by the carrier's own rule, and a fjord has no system of its own."
    ),
  },
  acrossMaps: {
    statement:
      "A captured fjord requires a trough on the finer map: the ground under it stays drowned and keeps the glacial erosion the refined landform test reads. Its record then takes the nearest fjord there; with none it goes, since a shore without flanks is only a coast.",
    carry: carryWhereItLands,
    realize: realizedTrough,
    counterpart,
    unrealized: (state, carried) =>
      counterpart(state, carried) >= 0 ? movesTo(counterpart)(state, carried) : goes(),
    settle: notApplicable(
      "A trough does not change with a round's water; only ice and sea do that."
    ),
    schedule: notApplicable("A fjord has no step in refinement's schedule; the landform reads it."),
  },
  movement: {
    statement:
      "Boats travel a fjord cheaply on deep sheltered water and reach far inland by it; walkers must go round its head, the way all roads treat the sea. Its walls draw short streams, and its narrows baffle what the current carries in.",
    roads: notApplicable(
      "Ways never step on to sea cells, so a fjord already sends a road round its head; its steep flanks are paid for by the grade."
    ),
    boats: costNear(0.7),
    drainage: costNear(0.85),
    magic: { current: costNear(1.5) },
    links: notApplicable("A fjord joins no two cells; it parts its shores."),
    crosses: notApplicable(
      "A fjord cuts routes on land; a strait is what a route crosses by boat."
    ),
  },
  others: {
    statement:
      "A fjord needs a past glacier and may keep moraine at its sill; falls drop from its hanging valleys into it; a sheltered harbour is its best use. It is a bay when filled and a valley when the sea withdraws.",
    needs: notApplicable("Its landform code holds the ice and the flanks already."),
    excludes: [{ kind: "bay", holds: (_state, a, b) => a.cells.includes(b.anchor) }],
    contains: notApplicable("A fjord contains water; a place in it is a harbour on its edge."),
    pairsWith: [
      { kind: "waterfall", holds: within(around) },
      { kind: "harbour", holds: within(spans(3)) },
      { kind: "moraine", holds: within(around) },
      { kind: "riverMouth", holds: within(around) },
      { kind: "valley", holds: within(spans(3)) },
    ],
  },
  people: {
    statement:
      "A fjord is a safe harbour and a road inland by water, with fish and a defensible narrows; rock falling from its walls drives waves down it.",
    offers(state, place) {
      const great = greatness(state, place);
      return { trade: great, defence: great / 2, food: great / 2 };
    },
    threatens: (state, place) => [
      {
        hazard: "rockfall wave",
        reach: lengthOf(state, place),
        severity: fieldOf(state).MaximumIceThickness.get(place.anchor) > 0 ? 0.5 : 0.25,
      },
    ],
  },
  time: {
    statement:
      "A fjord lasts while the sea stands in its trough. If its streams fill it, it is a bay; if the sea withdraws, it is the valley the ice cut.",
    fate(state, place) {
      if (!isSea(state, place.anchor)) return { fate: "becomes", kind: "valley" };
      return depthAt(state, place.anchor) < filled
        ? { fate: "becomes", kind: "bay" }
        : { fate: "persists" };
    },
  },
  visibility: {
    statement:
      "A fjord shows by its length and how deep it runs against its shelf; a lone one on a plain coast is striking, and one among many on a fjord coast counts less. Its harbour town carries a short one.",
    ...factors,
    importance: weighed(factors, { magnitude: 0.6, localConditions: 0.15, isolation: 0.25 }),
  },
  naming: {
    statement: "Named by the people on its shores, and the town at its head takes its name.",
    namedBy: namingCultureNear,
    takesNameFrom: notApplicable("A fjord is what its head town is named for, not the reverse."),
    lendsNameTo: [
      { kind: "settlement", holds: within(around) },
      { kind: "harbour", holds: within(spans(3)) },
    ],
  },
};
