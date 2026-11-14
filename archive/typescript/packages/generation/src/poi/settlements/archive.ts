// @needsResolution carry: a carried place may not resolve on a finer map (ADR 0009).
import { MapScale } from "@atlas/domain";
import { mapScale } from "../../worldSignificance";
import type { GenerationState } from "../../process";
import { memoryCold, memoryIce } from "./workFacts";
import { carryWhereItLands, costNear, goes } from "../poiCarry";
import { notApplicable, type PoiEntry, type PoiPlace } from "../poiContract";
import { holdsRecord, within } from "../poiPlaces";
import { cellSpan, celsiusAt, iceAt, isLand, magicValue } from "../poiReads";
import { aloneAmong, attachment, sized, standsOut } from "../poiVisibilityRules";
import {
  cultureOfWork,
  nearTown,
  seatPeople,
  strengthOf,
  touching,
  weighedPlace,
} from "./settlementRecords";
import { workPlaces, workRecord } from "./workRecords";

/** Readers' traffic over this many metres, and what crystals do to carried Pressure, which dissipates near them. */
const readersRoad = 0.9,
  dissipated = 3,
  readersReach = MapScale.length(0.0005);
/** People at whose seat an archive is half as great as archives get. */
const typicalPeople = 5000;
/** How far reading strains the mind, against what else endangers people. */
const strainSeverity = 0.2;
/** An archive stands at a seat: within this many metres of one. */
const seatReach = MapScale.length(0.00125);
/** The least distance between two archives people site, and a sited archive's reach, in metres. */
const archiveSpacing = MapScale.length(0.025),
  archiveRadius = MapScale.length(0.00005);

const auroraAt = (state: GenerationState, cell: number) =>
  Math.min(1, magicValue(state, "aurora", "intensity", cell) / 1000);
/** How much of a memory the ground retains, as `auroraUse` reckons it. */
const retentionAt = (state: GenerationState, cell: number) =>
  Math.min(1, iceAt(state, cell) / mapScale(state).resolveMeasure(memoryIce)) *
  Math.max(0, Math.min(1, -celsiusAt(state, cell) / memoryCold));
const held = (state: GenerationState, cell: number) =>
  iceAt(state, cell) > 0 && auroraAt(state, cell) > 0;
const requires = (state: GenerationState, cell: number) =>
  isLand(state, cell) && held(state, cell) && nearTown(state, cell, seatReach);
/** Strong Aurora over thick ice in hard frost: what charges the crystals and what keeps them. */
const suitability = (state: GenerationState, cell: number) =>
  Math.sqrt(auroraAt(state, cell) * retentionAt(state, cell));
const places = workPlaces("archive", {
  record: "aurora-archive",
  layer: "magicPractices",
  label: "Archive",
  radius: archiveRadius,
  spacing: archiveSpacing,
  requires,
  suitability,
});
const isA = holdsRecord("archive", places);
const seat = (state: GenerationState) => touching(state, seatReach);
const around = (state: GenerationState) => 6 * cellSpan(state);
const factors = {
  magnitude: sized(seatPeople, typicalPeople),
  localConditions: standsOut(auroraAt, around),
  isolation: aloneAmong(places, (state) => 2 * around(state)),
  cultural: attachment(around),
};
const memoryOf = (state: GenerationState, place: PoiPlace) =>
  retentionAt(state, place.anchor) * strengthOf(place);

export const archive: PoiEntry = {
  id: "archive",
  group: "settlements",
  name: "Archive",
  recognition: {
    distinct:
      "A practice at a community's seat: people reading memory out of crystals in cold ice. A frost prism and a light well are Aurora's own rule cells with no record, and an aurora field the intensity they stand in; a forge is the same kind of practice on Fire.",
    isA,
  },
  existence: {
    statement:
      "Sited on every map beside a settlement where Aurora stands over thick ice in hard frost, at least 100 km apart.",
    way: "sited",
    requires,
    suitability,
    places,
  },
  publication: {
    statement:
      "An archive publishes as a located practice where a map's cells can hold one; the World leaves it for a finer map.",
    moment: "society",
    record: workRecord,
  },
  fields: {
    statement:
      "An archive takes and changes nothing in any field. It is held by them: ice and frost keep its crystals and Aurora charges them, so it reads the country and leaves no mark on it.",
    terrain: notApplicable("Its readers work in chambers below anything the field resolves."),
    water: notApplicable("It keeps the ice it needs; its people draw none away."),
    climate: notApplicable("It needs the cold and adds nothing to it."),
    cover: notApplicable("It stands on ice, where there is no cover to change."),
    magic: notApplicable(
      "`auroraUse` draws charge from the community's crystal ledger, which has no band; Aurora's field is not reduced by reading."
    ),
  },
  acrossMaps: {
    statement:
      "An archive captured from a coarser map stands at its seat only if ice and Aurora reach the finer ground there, and otherwise goes.",
    carry: carryWhereItLands,
    realize: notApplicable("It requires ground of a kind; it does not shape any."),
    counterpart: (state, carried) => (held(state, carried.cell) ? carried.cell : -1),
    unrealized: goes,
    settle: notApplicable("It moves only if its seat does, which is the settlement's rule."),
    schedule: notApplicable("An archive takes no part in refinement's steps."),
  },
  movement: {
    statement:
      "Readers wear a modest road to an archive. Its crystals dissipate any Pressure people carry near them, so it is costly ground for that carrier though it stops nothing else.",
    roads: costNear(readersRoad, readersReach),
    boats: notApplicable("It stands on land in hard frost, away from open water."),
    drainage: notApplicable("It holds no ground water can feel; ice decides the flow here."),
    magic: { people: costNear(dissipated, readersReach) },
    links: notApplicable("An archive joins nothing."),
    crosses: notApplicable("Reading a crystal takes no route over anything."),
  },
  others: {
    statement:
      "An archive stands in a settlement on Aurora's ground, often near a light well or the prisms its crystals come from. A forge at the same seat melts the ice it depends on, and once the ice has gone the two no longer stand together.",
    needs: [{ kind: "settlement", holds: within(seat) }],
    excludes: [
      {
        kind: "forge",
        holds: (state, a, b) => a.anchor === b.anchor && iceAt(state, a.anchor) <= 0,
      },
    ],
    contains: notApplicable("An archive is one practice at one seat."),
    pairsWith: [
      { kind: "lightWell", holds: within(around) },
      { kind: "frostPrism", holds: within(around) },
      { kind: "auroraField", holds: within(around) },
    ],
  },
  people: {
    statement:
      "An archive gives what a people has known, which draws scholars and pilgrims and trade in proportion to how well it remembers. Reading strains those who do it.",
    offers(state, place) {
      const memory = memoryOf(state, place);
      return { sanctity: memory, trade: memory * factors.magnitude(state, place) };
    },
    threatens: (state) => [
      { hazard: "cognitive strain", reach: seat(state), severity: strainSeverity },
    ],
  },
  time: {
    statement:
      "Memory decays as its ice and frost do, so a warming epoch ends an archive whatever its keepers do, and nothing is left of what it knew. It lasts while the ice does.",
    fate: (state, place) => (held(state, place.anchor) ? { fate: "persists" } : { fate: "ends" }),
  },
  visibility: {
    statement:
      "An archive shows by the people who keep it and by how strongly Aurora stands over its country; its fame reaches further than its size, carried by the town that holds it.",
    ...factors,
    importance: weighedPlace(factors, { magnitude: 0.5, localConditions: 0.2, isolation: 0.3 }),
  },
  naming: {
    statement: "Named by the people who keep it, in its record, after its settlement.",
    namedBy: cultureOfWork,
    takesNameFrom: [{ kind: "settlement", holds: within(seat) }],
    lendsNameTo: notApplicable("Its name is carried by readers, not by any place around it."),
  },
};
