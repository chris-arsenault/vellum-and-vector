import type { GenerationState } from "../../process";
import { carryWhereItLands, costNear, stays } from "../poiCarry";
import { notApplicable, type PoiEntry, type PoiFieldChange, type PoiPlace } from "../poiContract";
import { holdsRecord, recordPlaces, settlementWithin, within } from "../poiPlaces";
import { adjacent, cellSpan, iceAt, isLand, magicRule, magicValue } from "../poiReads";
import { aloneAmong, attachment, drawnWhen, sized, standsOut } from "../poiVisibilityRules";
import {
  attribute,
  cultureOfWork,
  isKept,
  isWork,
  seatPeople,
  strengthOf,
  workReach,
} from "./settlementRecords";

/** The degrees of contact heat a forge at full use gives its seat, as societyMagic holds it. */
const greatestHeat = 8;
/** Temperature's native units to the degree, and the share of its heat that takes ice in a year, as societyMagic holds it. */
const nativePerDegree = 10,
  iceTaken = 0.02;
/** People at whose seat a forge is half as great as forges get. */
const typicalPeople = 5000;
/** The road cores come in by, and what people carrying them save on their way. */
const coreRoad = 0.8,
  coreTrain = 0.7;
/** How hard the heat of a forge bites into those who crack cores, against what else maims. */
const crackingSeverity = 0.3;

const places = recordPlaces("forge", isWork("fire-forge"));
const isA = holdsRecord("forge", places);
const seat = (state: GenerationState) => cellSpan(state);
const around = (state: GenerationState) => 6 * cellSpan(state);
const veinAt = magicRule("fire", "vein");
const coreAt = magicRule("fire", "core");
const placerAt = magicRule("fire", "placer");
const fireAt = (state: GenerationState, cell: number) =>
  Math.min(1, magicValue(state, "fire", "intensity", cell) / 1000);
const carriesCores = (state: GenerationState, cell: number) =>
  veinAt(state, cell) || coreAt(state, cell) || placerAt(state, cell);
const heatOf = (place: PoiPlace) => greatestHeat * strengthOf(place);
const factors = {
  magnitude: sized(seatPeople, typicalPeople),
  localConditions: standsOut(fireAt, around),
  isolation: aloneAmong(places, (state) => 2 * around(state)),
  cultural: attachment(around),
};

export const forge: PoiEntry = {
  id: "forge",
  group: "settlements",
  name: "Forge",
  recognition: {
    distinct:
      "A published practice of `kind` fire-forge (`workKind` fire-forge), at its community's seat: people cracking Fire cores for contact heat. A mine lifts the cores and a thermal vein is the stock in place with no record; a Fire core is Fire's own rule cell, and a settlement with `siteKind` fire-seat merely stands beside one. An archive is the same kind of practice on Aurora's cold.",
    isA,
  },
  existence: {
    statement:
      "Sited at a community's seat once it has cores to crack, mined under it or traded in along its ways, so an inland city with no vein can make itself a Fire source. The simulation runs this as a practice today, but the world map publishes no generated works, and refined maps do not make forges: a forge reaches the map only as an authored record.",
    way: "sited",
    requires: (state, cell) => isLand(state, cell) && settlementWithin(state, cell, seat(state)),
    /** Fire in the ground, with its cores at hand under or beside the seat. */
    suitability(state, cell) {
      const cores = [cell, ...adjacent(state, cell)].some((next) => carriesCores(state, next));
      return (fireAt(state, cell) + (cores ? 1 : 0)) / 2;
    },
    places,
  },
  fields: {
    statement:
      "A forge warms the ground around its seat and thaws the ice on it, up to eight degrees where it runs at full use, fading with distance. The cores it cracks enter Fire's forge reservoir, so a working city is a Fire source.",
    terrain: notApplicable(
      "It cracks carried cores in the seat's own hearths; nothing it does opens ground, as tapping a vein does."
    ),
    water: (state, place): readonly PoiFieldChange[] =>
      workReach(state, place).map(({ cell, share }) => ({
        change: "atMost",
        band: "IceThickness",
        cell,
        value: Math.max(0, iceAt(state, cell) - heatOf(place) * share * iceTaken),
      })),
    climate: (state, place): readonly PoiFieldChange[] =>
      workReach(state, place).map(({ cell, share }) => ({
        change: "add",
        band: "Temperature",
        cell,
        amount: heatOf(place) * share * nativePerDegree,
      })),
    cover: notApplicable(
      "Its heat is cores, not charcoal, so it takes no timber; the cover follows the warmth through ecology."
    ),
    magic: notApplicable(
      "What it adds to Fire is stock in the forge reservoir, placed by `crackCores`; a reservoir has no band a declared change could name."
    ),
  },
  acrossMaps: {
    statement:
      "A refined map does not yet realize forges. An authored forge captured from a coarser map stays at its seat, its heat falling on the finer cells around it.",
    carry: carryWhereItLands,
    realize: notApplicable("Its heat is its field rule above; it needs no shape of ground."),
    counterpart: (_state, carried) => carried.cell,
    unrealized: stays,
    settle: notApplicable("It moves only if its seat does, which is the settlement's rule."),
  },
  movement: {
    statement:
      "People carrying cores are one of Fire's two carriers, so cores come to a forge more easily than Fire would spread through rock, and the road they come by is worn.",
    roads: (state, place, cell) => costNear(coreRoad, around(state))(state, place, cell),
    boats: notApplicable("It stands inland at its seat; any boat that serves it is the harbour's."),
    drainage: notApplicable("Its heat changes neither where water runs nor what it cuts."),
    magic: (state, place, cell) => costNear(coreTrain, around(state))(state, place, cell),
    crosses: notApplicable("Thawing a seat's ice does not open a route across a sheet of it."),
  },
  others: {
    statement:
      "A forge stands in a settlement and draws on the mines, veins and placers near it. Its heat melts the cold an archive depends on, so the two do not last at one seat where the ice has gone.",
    needs: [{ kind: "settlement", holds: within(seat) }],
    excludes: [
      {
        kind: "archive",
        holds: (state, a, b) => a.anchor === b.anchor && iceAt(state, a.anchor) <= 0,
      },
    ],
    contains: notApplicable("A forge is one practice at one seat."),
    pairsWith: [
      { kind: "mine", holds: within(around) },
      { kind: "thermalVein", holds: within(around) },
      { kind: "placer", holds: within(around) },
    ],
  },
  people: {
    statement:
      "A forge gives its community power and worked metal for as long as cores arrive; cracking them maims its workers and the field they raise heats the ground around them.",
    offers(state, place) {
      const size = factors.magnitude(state, place);
      return { power: size, materials: size };
    },
    threatens: (state, place) => [
      {
        hazard: "core cracking",
        reach: Math.max(attribute(place, "radius"), seat(state)),
        severity: crackingSeverity * strengthOf(place),
      },
    ],
  },
  time: {
    statement:
      "A forge burns while its community can get cores. Without them it cools, Fire's stock there thins, and where the ground still runs warm it leaves a thawed halo rather than a ruin.",
    fate(state, place) {
      if (isKept(place)) return { fate: "persists" };
      return magicRule("fire", "halo")(state, place.anchor)
        ? { fate: "ends", leaves: "thawedHalo" }
        : { fate: "ends", leaves: "ruin" };
    },
  },
  visibility: {
    statement:
      "A forge shows by the city it serves and by standing out of its country's Fire: one far from any vein is a stranger place than the tenth on a seam.",
    ...factors,
    visibleAt: drawnWhen(factors, { magnitude: 0.3, localConditions: 0.4, isolation: 0.3 }),
  },
  naming: {
    statement:
      "Named by the community that works it, in its record, usually after its settlement or the vein that feeds it.",
    namedBy: cultureOfWork,
    takesNameFrom: [
      { kind: "settlement", holds: within(seat) },
      { kind: "thermalVein", holds: within(around) },
    ],
    lendsNameTo: notApplicable("A hearth's name stays within the city that keeps it."),
  },
};
