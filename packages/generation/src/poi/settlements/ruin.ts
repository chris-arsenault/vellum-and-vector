import type { AtlasFeature } from "@atlas/domain";
import type { GenerationState } from "../../process";
import { seatCaps } from "../../regional/seats";
import type { RegionalState } from "../../regional/state";
import { carryWhereItLands, costNear, stays } from "../poiCarry";
import { notApplicable, type PoiEntry, type PoiFieldChange, type PoiPlace } from "../poiContract";
import { holdsRecord, namingCultureNear, recordPlaces, within } from "../poiPlaces";
import {
  cellSpan,
  cellsWithin,
  gap,
  heldFor,
  isLand,
  magicRule,
  shareAround,
  slopeAt,
} from "../poiReads";
import { aloneAmong, attachment, drawnWhen, sized } from "../poiVisibilityRules";
import { attribute, peopleOfRecord, restlessDead } from "./settlementRecords";

/** People at their height at which a ruin is half as great as ruins get. */
const typicalPeak = 3000;
/** How much easier a road runs near a ruin: its old roadbed and its stone. */
const oldRoadbed = 0.85;
/** How strongly what a place was still ties people to its remains. */
const formerRole: Record<string, number> = { capital: 0.8, regionalCapital: 0.55, marketTown: 0.3 };

const goneStatus = ["abandoned", "ruined"];
const isRuin = (f: AtlasFeature) =>
  f.kind === "settlement" &&
  (f.layerId === "ruins" || goneStatus.includes(String(f.attributes.status)));
const places = recordPlaces("ruin", isRuin);
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
/** The bench a seat was cut on outlasts it: the seat rule holds a retained ruin's ground too. */
const caps = (state: RegionalState) =>
  heldFor(state, "seatCaps", () => {
    const cap = new Float64Array(state.physical.map.mesh.count);
    seatCaps(state, cap);
    return cap;
  });
const seatCell = (state: RegionalState, id: string) =>
  state.regional.evidence?.seats.find((seat) => seat.featureId === id)?.cell;

export const ruin: PoiEntry = {
  id: "ruin",
  group: "settlements",
  name: "Ruin",
  recognition: {
    distinct:
      "A settlement record with no one in it: `kind` settlement and either `layerId` ruins or `status` abandoned or ruined. The inhabited settlement is the same record on layer settlements with status inhabited; a ruin field is this kind with a `ruinField` mark and no people. A killing ground is brine with no record, and a dam or mill left behind is still its own kind.",
    isA,
  },
  existence: {
    statement:
      "Sited by what happened to a settlement: a community whose people left or were killed publishes as a ruin where it stood, and an earlier camp publishes as a ruin field only where the ground it changed still shows, a sealed vein or a drowned weir line.",
    way: "sited",
    requires: (state, cell) => isLand(state, cell),
    /** Where remains last and are found: on a vein its people sealed, on ground gentle enough to have held walls. */
    suitability(state, cell) {
      const held = 1 - Math.min(1, slopeAt(state, cell) / 0.12),
        scar = Math.max(
          sealedVein(state, cell) ? 1 : 0,
          shareAround(state, cell, (next) => sealedVein(state, next))
        );
      return (held + scar) / 2;
    },
    places,
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
    realize(state, carried): readonly PoiFieldChange[] {
      const cap = caps(state);
      return cellsWithin(state, carried.cell, around(state))
        .filter((cell) => cap[cell] > 0)
        .map((cell) => ({ change: "gradientAtMost", cell, gradient: cap[cell] }));
    },
    counterpart: (state, carried) => seatCell(state, carried.feature.id) ?? carried.cell,
    unrealized: stays,
    settle(state, carried) {
      const cell = seatCell(state, carried.feature.id);
      return cell !== undefined && cell !== carried.cell
        ? { outcome: "move", cell }
        : { outcome: "keep" };
    },
  },
  movement: {
    statement:
      "No road is laid to a ruin, but the roadbed it left is easy going and its walls are stone already cut. It carries nothing else and bars nothing.",
    roads: (state, place, cell) => costNear(oldRoadbed, 2 * cellSpan(state))(state, place, cell),
    boats: notApplicable("A ruin stands on dry land; a drowned one is gone from this kind."),
    drainage: notApplicable("Remains are too slight to turn the network."),
    magic: notApplicable("The people who carried magic have gone from it."),
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
    visibleAt: drawnWhen(factors, { magnitude: 0.5, localConditions: 0.25, isolation: 0.25 }),
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
