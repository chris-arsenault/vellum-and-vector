// @needsResolution carry: a carried place may not resolve on a finer map (ADR 0009).
import { MapScale } from "@atlas/domain";
import { mapScale } from "../../worldSignificance";
import type { GenerationState } from "../../process";
import { uninhabitableIce } from "../../societySites";
import { carryWhereItLands, costNear, stays } from "../poiCarry";
import { notApplicable, type PoiEntry, type PoiPlace } from "../poiContract";
import { holdsRecord, namingCultureNear, within } from "../poiPlaces";
import {
  cellSpan,
  celsiusAt,
  iceAt,
  isLand,
  Landform,
  landformAt,
  magicRule,
  magicValue,
  moistureAt,
} from "../poiReads";
import { aloneAmong, attachment, standsOut } from "../poiVisibilityRules";
import { isGone, keptLine, nearTown, seatOf, weighedPlace } from "./settlementRecords";
import { workPlaces, workRecord } from "./workRecords";

/** The worn way pilgrims make over this many metres, and what they carry along it. */
const pilgrimRoad = 0.8,
  pilgrimCarriage = 0.85,
  pilgrimReach = MapScale.length(0.0005);
/** How far, in metres, people walk to keep a shrine. */
const keepersReach = MapScale.length(0.00375);
/** The least distance between two shrines, a shrine's own ground, in metres. */
const shrineSpacing = MapScale.length(0.015),
  shrineRadius = MapScale.length(0.00005);
/** The share of its ground in trees a shrine's uncut grove keeps, where trees can stand at all. */
const groveCover = 0.3,
  groveMoisture = 0.3;

/** What makes ground holy, most surely first: magic is physical, and people answer it. */
const sacredRules: readonly [string, string, number][] = [
  ["hallowed", "ring", 1],
  ["greenwood", "wellspring", 0.9],
  ["veil", "door", 0.85],
  ["aurora", "well", 0.8],
  ["salt", "ground", 0.7],
  ["fire", "spring", 0.7],
  ["hallowed", "line", 0.6],
  ["greenwood", "oasis", 0.6],
];
const sacredTests = sacredRules.map(
  ([system, rule, weight]) => [magicRule(system, rule), weight] as const
);
/** Heights and thresholds people mark without any magic in them. */
const heldLandforms: Record<number, number> = {
  [Landform.Waterfall]: 0.8,
  [Landform.Peak]: 0.7,
  [Landform.Pass]: 0.5,
};
function holiness(state: GenerationState, cell: number) {
  let best = heldLandforms[landformAt(state, cell)] ?? 0;
  for (const [test, weight] of sacredTests) if (weight > best && test(state, cell)) best = weight;
  return best;
}

const requires = (state: GenerationState, cell: number) =>
  isLand(state, cell) &&
  iceAt(state, cell) <= mapScale(state).resolveMeasure(uninhabitableIce) &&
  nearTown(state, cell, keepersReach);
const places = workPlaces("shrine", null, {
  record: "shrine",
  layer: "magicPractices",
  label: "Shrine",
  radius: shrineRadius,
  spacing: shrineSpacing,
  requires,
  suitability: holiness,
});
const isA = holdsRecord("shrine", places);
const around = (state: GenerationState) => 6 * cellSpan(state);
const keepersFrom = (state: GenerationState) => mapScale(state).resolveMeasure(keepersReach);
const wardAt = (state: GenerationState, cell: number) =>
  Math.min(1, magicValue(state, "hallowed", "intensity", cell) / 1000);
const holinessOf = (state: GenerationState, place: PoiPlace) => holiness(state, place.anchor);
const factors = {
  magnitude: holinessOf,
  localConditions: standsOut(holiness, around),
  isolation: aloneAmong(places, keepersFrom),
  cultural: attachment(keepersFrom),
};
const kept = (state: GenerationState, place: PoiPlace) => {
  const town = seatOf(state, place);
  return town ? !isGone(town) : nearTown(state, place.anchor, keepersReach);
};

export const shrine: PoiEntry = {
  id: "shrine",
  group: "settlements",
  name: "Shrine",
  recognition: {
    distinct:
      "A place kept as holy by people, whatever made it so. A Hallowed ring or a Greenwood wellspring is holy ground with no record, and a settlement with `siteKind` sanctuary is a town inside a ring.",
    isA,
  },
  existence: {
    statement:
      "Sited by this entry, on every map: within a walk of a settlement, on the ground that answers to people, a ring, a spring, a door, a light well, the graves of the killed, a height; the holiest first, at least 25 km apart. The society simulation has no shrine of its own.",
    way: "sited",
    requires,
    suitability: holiness,
    places,
  },
  publication: {
    statement: "A shrine publishes as a located practice at its holy ground.",
    moment: "society",
    record: workRecord,
  },
  fields: {
    statement:
      "A shrine keeps its ground: the trees around it are not cut, and the line its keepers maintain is one more source of the Hallowed ring it may stand in.",
    terrain: notApplicable("It takes the ground as it finds it, a height or a hollow."),
    water: notApplicable(
      "A spring is holy for what it gives; the shrine does not take or hold it."
    ),
    climate: notApplicable("A shrine and its grove are far below what the climate field resolves."),
    cover: (state, place) =>
      moistureAt(state, place.anchor) >= groveMoisture && celsiusAt(state, place.anchor) > 0
        ? [{ change: "atLeast", band: "TreeCover", cell: place.anchor, value: groveCover }]
        : [],
    magic: (_state, place) => keptLine(place),
  },
  acrossMaps: {
    statement:
      "A shrine captured from a coarser map stays where it stands on the refined map, its holy ground being that place and no nearby one. It asks nothing of the finer ground's shape.",
    carry: carryWhereItLands,
    realize: notApplicable("It keeps the ground as it develops; it does not shape it."),
    counterpart: (_state, carried) => carried.cell,
    unrealized: stays,
    settle: notApplicable("A shrine does not move with water; people move to it."),
    schedule: notApplicable("A shrine takes no part in refinement's steps."),
  },
  movement: {
    statement:
      "Pilgrims wear a way to a shrine, easing the roads near it, and carry what they gather from it: seed, salt and cores travel with those who walk. It bars no route and lets none across.",
    roads: costNear(pilgrimRoad, pilgrimReach),
    boats: notApplicable("A shrine is reached on foot; any boat that serves it is the harbour's."),
    drainage: notApplicable(
      "Too slight to turn the network; it stands by water and does not hold it."
    ),
    magic: { people: costNear(pilgrimCarriage, pilgrimReach) },
    links: notApplicable("A shrine joins nothing."),
    crosses: notApplicable("A shrine at a pass marks the crossing; the pass makes it."),
  },
  others: {
    statement:
      "A shrine needs people to keep it and stands at what they hold holy: a peak, a spring, a fall, a light well, a door, a battlefield's graves. A Fire conduit breaks a ward at its cell, so a working forge is no neighbour for one.",
    needs: [{ kind: "settlement", holds: within(keepersFrom) }],
    excludes: [{ kind: "forge", holds: (_state, a, b) => a.anchor === b.anchor }],
    contains: notApplicable("A shrine is one point, kept by those who come to it."),
    pairsWith: [
      { kind: "peak", holds: within(around) },
      { kind: "spring", holds: within(around) },
      { kind: "waterfall", holds: within(around) },
      { kind: "lightWell", holds: within(around) },
      { kind: "door", holds: within(around) },
      { kind: "oasis", holds: within(around) },
      { kind: "killingGround", holds: within(around) },
    ],
  },
  people: {
    statement:
      "A shrine gives sanctity in proportion to its ground, and trade in what pilgrims spend. Inside a Hallowed ring nothing is harmed.",
    offers: (state, place) => ({
      sanctity: Math.max(holinessOf(state, place), wardAt(state, place.anchor)),
      trade: holinessOf(state, place) / 3,
    }),
    threatens: notApplicable(
      "It is a keeping place; the dangers of the ground it marks belong to those places' own entries."
    ),
  },
  time: {
    statement:
      "A shrine lasts while anyone keeps it. When its people go, Hallowed's ring loses three tenths an epoch and the shrine ends, leaving remains that may be holy to whoever comes next.",
    fate: (state, place) =>
      kept(state, place) ? { fate: "persists" } : { fate: "ends", leaves: "ruin" },
  },
  visibility: {
    statement:
      "A shrine earns its place mostly by attachment, not size: the people who walk to it. With little physical magnitude, a major one at a capital outranks a greater one in empty country.",
    ...factors,
    importance: weighedPlace(factors, { magnitude: 0.3, localConditions: 0.3, isolation: 0.4 }),
  },
  naming: {
    statement:
      "Named by the people who keep it, after what it marks; a settlement that grows from its pilgrims takes its name.",
    namedBy: namingCultureNear,
    takesNameFrom: [
      { kind: "peak", holds: within(around) },
      { kind: "spring", holds: within(around) },
      { kind: "waterfall", holds: within(around) },
    ],
    lendsNameTo: [{ kind: "settlement", holds: within(around) }],
  },
};
