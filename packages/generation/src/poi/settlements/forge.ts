// @needsResolution carry: a carried place may not resolve on a finer map (ADR 0009).
import type { GenerationState } from "../../process";
import { fullForgeHeat, thawShare } from "../../societyMagic";
import { carryWhereItLands, costNear, stays } from "../poiCarry";
import { notApplicable, type PoiEntry, type PoiFieldChange, type PoiPlace } from "../poiContract";
import { holdsRecord, within } from "../poiPlaces";
import { adjacent, cellSpan, iceAt, isLand, magicRule, magicValue } from "../poiReads";
import { aloneAmong, attachment, sized, standsOut } from "../poiVisibilityRules";
import { societyRegionOf } from "./communityRecords";
import {
  attribute,
  cultureOfWork,
  isKept,
  nearTown,
  seatPeople,
  strengthOf,
  touching,
  weighedPlace,
  workReach,
} from "./settlementRecords";
import { workPlaces, workRecord } from "./workRecords";

/** Temperature's native units to the degree. */
const nativePerDegree = 10;
/** The years of a forge's heat its thawed ground stands for: a declared total, not a yearly loss. */
const thawYears = 100;
/** People at whose seat a forge is half as great as forges get. */
const typicalPeople = 5000;
/** The road cores come in by, and what people carrying them save on their way, over this many metres. */
const coreRoad = 0.8,
  coreTrain = 0.7,
  coreReach = 2000;
/** How hard the heat of a forge bites into those who crack cores, against what else maims. */
const crackingSeverity = 0.3;
/** A forge stands at a seat: within this many metres of one. */
const seatReach = 5000;
/** The least distance between two forges people site, and a sited forge's heat, in metres. */
const forgeSpacing = 100_000,
  forgeRadius = 2000;

const requires = (state: GenerationState, cell: number) =>
  isLand(state, cell) && nearTown(state, cell, seatReach);
/** Fire in the ground, with its cores at hand under or beside the seat. */
function suitability(state: GenerationState, cell: number) {
  const cores = [cell, ...adjacent(state, cell)].some((next) => carriesCores(state, next));
  return (fireAt(state, cell) + (cores ? 1 : 0)) / 2;
}
const places = workPlaces("forge", "fire-forge", {
  record: "fire-forge",
  layer: "magicPractices",
  label: "Forge",
  radius: forgeRadius,
  spacing: forgeSpacing,
  requires,
  suitability,
});
const isA = holdsRecord("forge", places);
const seat = (state: GenerationState) => touching(state, seatReach);
const around = (state: GenerationState) => 6 * cellSpan(state);
const veinAt = magicRule("fire", "vein");
const coreAt = magicRule("fire", "core");
const placerAt = magicRule("fire", "placer");
const fireAt = (state: GenerationState, cell: number) =>
  Math.min(1, magicValue(state, "fire", "intensity", cell) / 1000);
const carriesCores = (state: GenerationState, cell: number) =>
  veinAt(state, cell) || coreAt(state, cell) || placerAt(state, cell);
/** The degrees a forge gives its seat: what its community's ledger met, or its full heat where none keeps one. */
function heatOf(state: GenerationState, place: PoiPlace) {
  const id = place.feature?.attributes.communityId,
    ledger = societyRegionOf(state)?.magic.find((practice) => practice.communityId === id);
  return ledger
    ? ledger.heatApplied * attribute(place, "condition", 1)
    : fullForgeHeat * strengthOf(place);
}
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
      "A practice at a community's seat: people cracking Fire cores for contact heat. A mine lifts the cores and a thermal vein is the stock in place with no record; a Fire core is Fire's own rule cell, and a settlement with `siteKind` fire-seat merely stands beside one. An archive is the same kind of practice on Aurora's cold.",
    isA,
  },
  existence: {
    statement:
      "Sited two ways: the simulation's practice at a community's seat once it has cores to crack, mined under it or traded in along its ways, so an inland city with no vein can make itself a Fire source; and on every map beside a seat with Fire and cores at hand, at least 50 km apart.",
    way: "sited",
    requires,
    suitability,
    places,
  },
  publication: {
    statement:
      "A forge publishes as a located practice; the World shows those the ground sited, and the simulation's own act on its field without a record.",
    moment: "society",
    record: workRecord,
  },
  fields: {
    statement:
      "A forge warms the ground around its seat and thaws the ice on it, up to eight degrees where it runs at full use, fading with distance. The cores it cracks enter Fire's forge reservoir, so a working city is a Fire source.",
    terrain: notApplicable(
      "It cracks carried cores in the seat's own hearths; nothing it does opens ground, as tapping a vein does."
    ),
    water: (state, place): readonly PoiFieldChange[] =>
      workReach(state, place).map(({ cell, share }) => ({
        change: "add",
        band: "IceThickness",
        cell,
        amount: -heatOf(state, place) * share * thawShare * thawYears,
      })),
    climate: (state, place): readonly PoiFieldChange[] =>
      workReach(state, place).map(({ cell, share }) => ({
        change: "add",
        band: "Temperature",
        cell,
        amount: heatOf(state, place) * share * nativePerDegree,
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
      "A forge captured from a coarser map stays at its seat, its heat falling on the finer cells around it.",
    carry: carryWhereItLands,
    realize: notApplicable("Its heat is its field rule above; it needs no shape of ground."),
    counterpart: (_state, carried) => carried.cell,
    unrealized: stays,
    settle: notApplicable("It moves only if its seat does, which is the settlement's rule."),
    schedule: notApplicable("A forge takes no part in refinement's steps."),
  },
  movement: {
    statement:
      "People carrying cores are one of Fire's two carriers, so cores come to a forge more easily than Fire would spread through rock, and the road they come by is worn.",
    roads: costNear(coreRoad, coreReach),
    boats: notApplicable("It stands inland at its seat; any boat that serves it is the harbour's."),
    drainage: notApplicable("Its heat changes neither where water runs nor what it cuts."),
    magic: { people: costNear(coreTrain, coreReach) },
    links: notApplicable("A forge joins nothing."),
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
    importance: weighedPlace(factors, { magnitude: 0.3, localConditions: 0.4, isolation: 0.3 }),
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
