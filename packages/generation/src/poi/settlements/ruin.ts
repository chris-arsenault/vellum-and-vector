// @needsResolution carry: a carried place may not resolve on a finer map (ADR 0009).
import type { GenerationState } from "../../process";
import { usableSlope } from "../../regional/seats";
import type { RegionalState } from "../../regional/state";
import { carryWhereItLands, costNear, stays } from "../poiCarry";
import { notApplicable, type PoiEntry, type PoiPlace } from "../poiContract";
import { holdsRecord, namingCultureNear, within } from "../poiPlaces";
import { cellSpan, gap, isLand, magicRule, shareAround, slopeAt } from "../poiReads";
import { aloneAmong, attachment, sized } from "../poiVisibilityRules";
import { communityRecord, ruinPlaces } from "./communityRecords";
import { attribute, peopleOfRecord, restlessDead, weighedPlace } from "./settlementRecords";

/** People at their height at which a ruin is half as great as ruins get. */
const typicalPeak = 3000;
/** How much easier a road runs near a ruin, and over how many metres: its old roadbed and its stone. */
const oldRoadbed = 0.85,
  roadbedReach = 1000;
/** How strongly what a place was still ties people to its remains. */
const formerRole: Record<string, number> = { capital: 0.8, regionalCapital: 0.55, marketTown: 0.3 };

const places = ruinPlaces;
const isA = holdsRecord("ruin", places);
const around = (state: GenerationState) => 8 * cellSpan(state);
const sealedVein = magicRule("fire", "scar");
const peakOf = (_state: GenerationState, place: PoiPlace) =>
  place.feature ? Math.max(attribute(place, "peakPopulation"), peopleOfRecord(place.feature)) : 0;
/** A marked ruin (a fortress, a ruin field on ground its people changed) outlasts its size. */
const marked = (place: PoiPlace) =>
  place.feature?.attributes.fortress === true || place.feature?.attributes.ruinField !== undefined;
const remembered = (state: GenerationState, place: PoiPlace) =>
  Math.max(
    attachment(around)(state, place),
    formerRole[String(place.feature?.attributes.settlementRole)] ?? 0,
    marked(place) ? 0.5 : 0
  );
const factors = {
  magnitude: sized(peakOf, typicalPeak),
  /** Remains in emptied country stand out; among living towns they are one more old quarter. */
  localConditions: (state: GenerationState, place: PoiPlace) =>
    1 - attachment(around)(state, place),
  isolation: aloneAmong(places, (state) => 2 * around(state)),
  cultural: remembered,
};
const seatCell = (state: RegionalState, id: string) =>
  state.regional.evidence?.seats.find((seat) => seat.featureId === id)?.cell;

export const ruin: PoiEntry = {
  id: "ruin",
  group: "settlements",
  name: "Ruin",
  recognition: {
    distinct:
      "A community with no one in it, a camp an earlier round left, or a seat the parent recorded as abandoned or ruined. The inhabited settlement is the same community while people stay; a ruin field is this kind with a `ruinField` mark and no people. A killing ground is brine with no record, and a dam or mill left behind is still its own kind.",
    isA,
  },
  existence: {
    statement:
      "Sited by what happened to a settlement: a community whose people left or were killed publishes as a ruin where it stood, and an earlier camp publishes as a ruin field only where the ground it changed still shows, a sealed vein or a drowned weir line.",
    way: "sited",
    requires: (state, cell) => isLand(state, cell),
    /** Where remains last and are found: on a vein its people sealed, on ground gentle enough to have held walls. */
    suitability(state, cell) {
      const held = 1 - Math.min(1, slopeAt(state, cell) / usableSlope),
        scar = Math.max(
          sealedVein(state, cell) ? 1 : 0,
          shareAround(state, cell, (next) => sealedVein(state, next))
        );
      return (held + scar) / 2;
    },
    places,
  },
  publication: {
    statement:
      "A community with no one left publishes where it stood, on the ruins layer; a major camp of an earlier round and a ruin field publish from what the round left. A seat the parent recorded stays as that record.",
    moment: "society",
    record: communityRecord,
  },
  fields: {
    statement:
      "A ruin stops acting: the people who cleared and drew on the country are gone, so the country recovers around remains that hold only the ground they stand on and that only through refinement.",
    terrain: notApplicable(
      "Its graded bench is its refinement rule below; a tell is too small for a world cell to hold."
    ),
    water: notApplicable(
      "No one draws water at a ruin; the dams and ditches left behind are their own entries."
    ),
    climate: notApplicable("An empty seat warms nothing; even a living one is below the field."),
    cover: notApplicable(
      "Cover returns by ordinary succession once clearance stops; the ruin holds none of it back."
    ),
    magic: notApplicable(
      "Hallowed reads tenure only at inhabited seats, so a ruin's person-years feed nothing and its ring fades by its own retention."
    ),
  },
  acrossMaps: {
    statement:
      "A captured ruin is a seat like any other on the refined map: it stays where the parent put it, holds its footprint's gradient down, and moves to the seat the evidence settles on. It proposes no village and sends no one along the ways.",
    carry: carryWhereItLands,
    realize: notApplicable(
      "The bench a seat was cut on outlasts it: the settlement entry's caps step holds every captured seat's ground, a ruin's too."
    ),
    counterpart: (state, carried) => seatCell(state, carried.feature.id) ?? carried.cell,
    unrealized: stays,
    settle(state, carried) {
      const cell = seatCell(state, carried.feature.id);
      return cell !== undefined && cell !== carried.cell
        ? { outcome: "move", cell }
        : { outcome: "keep" };
    },
    schedule: notApplicable(
      "The settlement entry's schedule reads, grades and settles every captured seat, this kind's too."
    ),
  },
  movement: {
    statement:
      "No road is laid to a ruin, but the roadbed it left is easy going and its walls are stone already cut. It carries nothing else and bars nothing.",
    roads: costNear(oldRoadbed, roadbedReach),
    boats: notApplicable("A ruin stands on dry land; a drowned one is gone from this kind."),
    drainage: notApplicable("Remains are too slight to turn the network."),
    magic: notApplicable("The people who carried magic have gone from it."),
    links: notApplicable("A ruin joins nothing."),
    crosses: notApplicable("A ruin is at most the end of an old way, not a way over a barrier."),
  },
  others: {
    statement:
      "A ruin is what a settlement leaves, so none stands on a living seat. It often lies at the site of the siege or disaster that emptied it, on salted ground, or beside the works its people kept.",
    needs: notApplicable("It needs nothing still standing: that is what makes it a ruin."),
    excludes: [{ kind: "settlement", holds: (_state, a, b) => a.anchor === b.anchor }],
    contains: notApplicable(
      "A ruin is one point; its works are their own places if they outlast it."
    ),
    pairsWith: [
      { kind: "battlefield", holds: within(around) },
      { kind: "disasterSite", holds: within(around) },
      { kind: "killingGround", holds: within(around) },
      { kind: "thermalVein", holds: within((state) => cellSpan(state)) },
    ],
  },
  people: {
    statement:
      "Remains offer cut stone and a site later people prefer to camp on, and memory in proportion to what stood there; where Aurora holds a salted barrow still, the dead there do not rest.",
    offers(state, place) {
      const great = factors.magnitude(state, place);
      return { materials: great, sanctity: remembered(state, place) / 2 };
    },
    threatens: restlessDead,
  },
  time: {
    statement:
      "Remains last until the ground under them goes; the sea takes a ruin and ends it, and people returning make the record a settlement again by its status, not by this kind's rule.",
    fate: (state, place) => (isLand(state, place.anchor) ? { fate: "persists" } : { fate: "ends" }),
  },
  visibility: {
    statement:
      "A ruin shows by how large it once was and how empty its country now is; a fallen capital or a fortress carries a small one, and one among living towns shows late.",
    ...factors,
    importance: weighedPlace(factors, { magnitude: 0.5, localConditions: 0.25, isolation: 0.25 }),
  },
  naming: {
    statement:
      "It keeps the name of what it was, in the language of those who named the living place; the living do not rename what they will not settle.",
    namedBy: (state, place) => {
      const culture = place.feature?.attributes.namingCulture;
      return typeof culture === "string" ? culture : namingCultureNear(state, place);
    },
    takesNameFrom: [{ kind: "settlement", holds: (_state, a, b) => a.anchor === b.anchor }],
    lendsNameTo: [
      {
        kind: "settlement",
        holds: (state, a, b) => gap(state, a.anchor, b.anchor) <= around(state),
      },
    ],
  },
};
