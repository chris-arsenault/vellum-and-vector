import type { AtlasFeature } from "@atlas/domain";
import type { GenerationState } from "../../process";
import { carryWhereItLands, stays } from "../poiCarry";
import { notApplicable, type PoiEntry, type PoiPlace } from "../poiContract";
import { holdsRecord, namingCultureNear } from "../poiPlaces";
import { cellSpan, fieldOf, gap, isLand } from "../poiReads";
import { aloneAmong, attachment, drawnWhen, sized, standsOut } from "../poiVisibilityRules";
import {
  areaPlaces,
  avoidedGround,
  damagedGround,
  deadGround,
  deadOf,
  eventFate,
  eventKindOf,
  eventReach,
  isEvent,
  peopleWithin,
  restlessDead,
  saltedHazard,
} from "./settlementRecords";

/** The people a town needs to be worth a siege, as societySiege holds it. */
const besiegedTown = 100;
/** The dead at which a battlefield is half as great as battlefields get. */
const typicalDead = 2000;
/** The share of its ground's cover an army's camp and works strip at full strength. */
const stripped = 0.6;

const isSiege = (f: AtlasFeature) => isEvent(f) && f.attributes.eventKind === "siege";
const places = areaPlaces("battlefield", isSiege);
const isA = holdsRecord("battlefield", places);
const around = (state: GenerationState) => 6 * cellSpan(state);
const reachOf = (state: GenerationState, place: PoiPlace) =>
  Math.max(eventReach(state, place), around(state));
const atThePlace = (state: GenerationState, a: PoiPlace, b: PoiPlace) =>
  gap(state, a.anchor, b.anchor) <= reachOf(state, a);
const deadAt = (state: GenerationState, cell: number) => fieldOf(state).MassDeath.get(cell);
const factors = {
  magnitude: sized(deadOf, typicalDead),
  /** The dead here against those of the country around: one great slaughter, or one among many. */
  localConditions: standsOut(deadAt, reachOf),
  isolation: aloneAmong(places, reachOf),
  cultural: attachment(reachOf),
};

export const battlefield: PoiEntry = {
  id: "battlefield",
  group: "settlements",
  name: "Battlefield",
  recognition: {
    distinct:
      "A published `societyEvent` whose `attributes.eventKind` is siege. A disaster site is the same record with any other `eventKind` but collapse; a killing ground is `stock:death/brine` of Salt, with no record, and the two often coincide because the record's casualties feed that stock. A ruin is what the town became, read from the settlement record.",
    isA,
  },
  existence: {
    statement:
      "Sited by politics, without a war simulation: when a polity falls from active, each settled town of at least 100 people it claimed and no longer controls is besieged where it stands, with the casualties, displacement and ruin any event gives. Sieges below ten thousand dead and displaced stay off the world map; a refined map retains each that reaches it as a record of its affected area.",
    way: "sited",
    requires: (state, cell) =>
      isLand(state, cell) && peopleWithin(state, cell, cellSpan(state), besiegedTown),
    suitability: notApplicable(
      "Nothing chooses the ground: the siege falls wherever a lost town stands, however poor a place to fight."
    ),
    places,
  },
  fields: {
    statement:
      "A siege kills, and the dead lie in the ground: its casualties are the mass death Salt's death origin turns to brine where they fell, which is the physical thing a battlefield leaves. Its camps and works also strip the land around the town.",
    terrain: notApplicable(
      "Siege lines are narrower than a cell; the deep marks left are the town's ruin and its salt."
    ),
    water: notApplicable("An army drinks and fouls, but by nothing the water field resolves."),
    climate: notApplicable("A siege's fires are too brief and too small for the climate field."),
    cover: (_state, place) => damagedGround(place, stripped),
    magic: (_state, place) => deadGround(place),
  },
  acrossMaps: {
    statement:
      "A captured battlefield keeps its place around its town on the refined map; its dead lie on the finer cell it lands on, for the region's Salt to brine, whatever the ground has become.",
    carry: carryWhereItLands,
    realize: (_state, carried) => {
      const place: PoiPlace = {
        id: carried.feature.id,
        kind: "battlefield",
        cells: [carried.cell],
        anchor: carried.cell,
        feature: carried.feature,
      };
      return deadGround(place);
    },
    counterpart: (_state, carried) => carried.cell,
    unrealized: stays,
    settle: notApplicable("What has happened does not move with a round's water."),
  },
  movement: {
    statement:
      "People shun salted killing grounds, so a road costs more across them for as far as the event reached; where the brine has not formed a battlefield costs nothing to cross.",
    roads: avoidedGround,
    boats: notApplicable("A siege is at a town on land; none of its ground is water."),
    drainage: notApplicable("Water drains through the field as it did before the fighting."),
    magic: notApplicable(
      "The brine rides the crust from the dead by Salt's own propagation; a battlefield adds no carrier."
    ),
    crosses: notApplicable("Nothing about a siege opens a way across a barrier."),
  },
  others: {
    statement:
      "A battlefield needs a town to besiege, which it may leave a ruin; its dead feed a killing ground, and a shrine may mark their graves. A siege can fall on any ground, so nothing excludes it.",
    needs: [{ kind: "settlement", holds: atThePlace }],
    excludes: notApplicable("Any town can be lost, wherever it stands."),
    contains: notApplicable("Its record has one location; the ground it salted is its own place."),
    pairsWith: [
      { kind: "ruin", holds: atThePlace },
      { kind: "killingGround", holds: atThePlace },
      { kind: "shrine", holds: atThePlace },
    ],
  },
  people: {
    statement:
      "A battlefield gives the living a place to mourn and a claim to hold; it threatens them with what the dead become, ground too salted to farm and, where Aurora stills it, a barrow that will not lie quiet.",
    offers: (state, place) => ({ sanctity: factors.magnitude(state, place) / 2 }),
    threatens: (state, place) => [...saltedHazard(state, place), ...restlessDead(state, place)],
  },
  time: {
    statement:
      "A siege happens once, and its record stays as history. As an epoch closes, ground its dead have salted carries on as a killing ground whose brine does not decay; elsewhere only the memory persists.",
    fate: eventFate,
  },
  visibility: {
    statement:
      "A battlefield shows by its dead above all, and by standing alone in its country's history; the fall of a capital carries a modest one, while the tenth siege of a contested road shows late.",
    ...factors,
    visibleAt: drawnWhen(factors, { magnitude: 0.55, localConditions: 0.15, isolation: 0.3 }),
  },
  naming: {
    statement:
      "Named by those who remember it, after the town it fell on and the era it fell in; its record's name holds its event and era. A killing ground beside it takes that name.",
    namedBy: namingCultureNear,
    takesNameFrom: [{ kind: "settlement", holds: atThePlace }],
    lendsNameTo: [
      {
        kind: "killingGround",
        holds: (state, a, b) => eventKindOf(a) === "siege" && atThePlace(state, a, b),
      },
    ],
  },
};
