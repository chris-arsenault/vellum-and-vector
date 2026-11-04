import type { GenerationState } from "../../process";
import { carryWhereItLands, counterpartOf, goes, movesTo } from "../poiCarry";
import { notApplicable, type PoiCarried, type PoiEntry, type PoiFieldChange } from "../poiContract";
import type { PoiPlace } from "../poiContract";
import { holdsRecord, within } from "../poiPlaces";
import { landCellSeaCost } from "../../mapRouting";
import { regionalSpan } from "../../regional/lattice";
import type { RegionalState } from "../../regional/state";
import { harbourDepth, harbourHands, harbourReach } from "../../societyWorks";
import { waveHeight, waveShore, tsunamiHazard } from "../../societyHazards";
import { harbourGoodDepth, harbourSurge } from "../../societySites";
import {
  adjacent,
  cellsWithin,
  cellSpan,
  fieldOf,
  heightAt,
  isLand,
  isSea,
  magicValue,
  metres,
  nearestWhere,
  shareAround,
  toNative,
  waveExposureAt,
} from "../poiReads";
import { aloneAmong, attachment, sized, standsOut } from "../poiVisibilityRules";
import {
  attribute,
  cultureOfWork,
  isKept,
  keptLine,
  nearTown,
  seatPeople,
  strengthOf,
  touching,
  weighedPlace,
  workReach,
} from "./settlementRecords";
import { workPlaces, workRecord } from "./workRecords";

/** Height a built quay adds at full strength, in metres. */
const quayHeight = 5;
/** Wave exposure behind a mole, per mille. */
const shelteredWaves = 300;
/** Sailing inside the mole, the road along the quay, and how far in metres the quay runs. */
const inTheHarbour = 0.9,
  quayRoad = 0.7,
  quayReach = 1000;
/** The least distance between two harbours people site, and a sited harbour's reach, in metres. */
const harbourSpacing = 30_000,
  harbourRadius = 500;
/** People a harbour at half as great as harbours get serves. */
const typicalPeople = 5000;
/** A mole across the water is raised seabed: what it costs a current or a Pressure ray. */
const moleCost = 2;
/** The grade a quay's own ground is held to on a refined map. */
const quayGradient = 0.03;

const depthAt = (state: GenerationState, cell: number) =>
  metres(fieldOf(state).WaterDepths.get(cell));
/** Sea a mole can stand in: shallow, or the sea beside a shore, whatever depth a map's cell averages. */
const shallows = (state: GenerationState, cell: number) =>
  isSea(state, cell) &&
  (depthAt(state, cell) < harbourDepth ||
    shareAround(state, cell, (next) => isLand(state, next)) > 0);
const servedOf = (state: GenerationState, place: PoiPlace) => seatPeople(state, place);
const around = (state: GenerationState) => 6 * cellSpan(state);
const quay = (state: GenerationState) => touching(state, quayReach);
const shore = (state: GenerationState, cell: number) =>
  nearestWhere(state, cell, quay(state), (next) => isLand(state, next));
/** The sea beside a cell, the cell itself when it is sea. */
const seaAround = (state: GenerationState, cell: number) =>
  [cell, ...adjacent(state, cell)].filter((next) => isSea(state, next));
/** The factors `harbourWaters` weighs, read on the field: shelter, lee, depth and surge. */
function waters(state: GenerationState, cell: number) {
  const sea = seaAround(state, cell);
  if (!sea.length) return 0;
  const hemmed = shareAround(state, cell, (next) => isLand(state, next)),
    lee = 1 - sea.reduce((sum, next) => sum + waveExposureAt(state, next), 0) / sea.length,
    depth = Math.max(...sea.map((next) => depthAt(state, next))) >= harbourGoodDepth ? 1 : 0.4,
    surged = magicValue(state, "pressure", "intensity", cell) >= harbourSurge;
  return ((hemmed + lee + depth) / 3) * (surged ? 0.3 : 1);
}
const requires = (state: GenerationState, cell: number) =>
  shallows(state, cell) && nearTown(state, cell, harbourReach, harbourHands);
const places = workPlaces("harbour", "harbor", {
  record: "harbor",
  layer: "transportSites",
  label: "Harbour",
  radius: harbourRadius,
  spacing: harbourSpacing,
  requires,
  suitability: (state, cell) => Math.min(1, waters(state, cell)),
});
const isA = holdsRecord("harbour", places);
const factors = {
  magnitude: sized(servedOf, typicalPeople),
  /** A shelter on a coast with no other: its own waters over the country's. */
  localConditions: standsOut(waters, around),
  isolation: aloneAmong(places, (state) => 2 * around(state)),
  cultural: attachment(around),
};
const roadCost = (state: GenerationState, place: PoiPlace) =>
  cellsWithin(state, place.anchor, quay(state))
    .filter((cell) => isLand(state, cell))
    .map((cell) => ({ cell, factor: quayRoad }));
const boatCost = (state: GenerationState, place: PoiPlace) =>
  cellsWithin(state, place.anchor, quay(state)).map((cell) => ({
    cell,
    factor: isLand(state, cell) ? 1 / landCellSeaCost : inTheHarbour,
  }));
const moleAt = (_state: GenerationState, place: PoiPlace) => [
  { cell: place.anchor, factor: moleCost },
];
const counterpart = counterpartOf(shallows, 1);
const moved = (state: RegionalState, carried: PoiCarried) =>
  counterpart(state, carried) >= 0 ? movesTo(counterpart)(state, carried) : goes();
/** The quay on the refined shore: land beside it is held level enough to load a cart on. */
function realizedQuay(state: RegionalState, carried: PoiCarried): readonly PoiFieldChange[] {
  const cell = counterpart(state, carried);
  if (cell < 0) return [];
  const span = regionalSpan(state),
    land = nearestWhere(state, cell, 2 * span, (next) => isLand(state, next));
  return [
    { change: "atMost", band: "WaveExposure", cell, value: shelteredWaves },
    ...(land >= 0
      ? ([{ change: "gradientAtMost", cell: land, gradient: quayGradient }] as const)
      : []),
  ];
}

export const harbour: PoiEntry = {
  id: "harbour",
  group: "settlements",
  name: "Harbour",
  recognition: {
    distinct:
      "A work standing in the sea, in shallows or beside a shore, where a land route meets a sea lane. A bay is the shelter with no record, a river mouth the water with no record, and a settlement with `siteKind` harbour is the town beside it.",
    isA,
  },
  existence: {
    statement:
      "Sited two ways: the simulation's located harbours of a community of at least 1000 people; and on every map the best sheltered shore within 10 km of such a community, at least 30 km apart. The simulation's World units hold harbours only as latent demands.",
    way: "sited",
    requires,
    suitability: (state, cell) => Math.min(1, waters(state, cell)),
    places,
  },
  publication: {
    statement:
      "A harbour publishes as a located work; the World shows those the ground sited, and the simulation's own stay demands.",
    moment: "society",
    record: workRecord,
  },
  fields: {
    statement:
      "A harbour raises a quay out of the shallows and calms the water behind its mole; the shore it is kept from keeps a line that Hallowed reads.",
    terrain: (state, place): readonly PoiFieldChange[] =>
      workReach(state, place).map(({ cell, share }) => ({
        change: "add",
        band: "Elevation",
        cell,
        amount: toNative(quayHeight * strengthOf(place) * share),
      })),
    water: (_state, place) => [
      { change: "atMost", band: "WaveExposure", cell: place.anchor, value: shelteredWaves },
    ],
    climate: notApplicable("A quay and a mole make no weather the climate field could resolve."),
    cover: notApplicable("It stands in the sea and on bare quay, where nothing grows to lose."),
    magic(state, place) {
      const land = shore(state, place.anchor);
      return land < 0 ? [] : keptLine(place, land);
    },
  },
  acrossMaps: {
    statement:
      "A captured harbour takes the nearest shallows on the refined coast, with its waters calmed and its quay's ground levelled. As the coast changes round by round it follows the shallows, and goes if none lie near.",
    carry: carryWhereItLands,
    realize: realizedQuay,
    counterpart,
    unrealized: moved,
    settle: (state, carried) =>
      shallows(state, carried.cell) ? { outcome: "keep" } : moved(state, carried),
    schedule: notApplicable(
      "A harbour takes no part in refinement's steps beyond following the shallows."
    ),
  },
  movement: {
    statement:
      "A harbour is where a land route becomes a sea lane: a lane pays nothing extra to land there, roads run on easily along its quay, and between them a route goes on across water no road can. Its mole is raised seabed, which currents and Pressure rays must go round.",
    roads: roadCost,
    boats: boatCost,
    drainage: notApplicable("It stands in the sea, below where the network ends."),
    magic: { current: moleAt },
    links: notApplicable("A harbour joins nothing directly; a sea lane does that through it."),
    crosses: () => ["strait"],
  },
  others: {
    statement:
      "A harbour needs a settlement to serve and lies best in a bay, a fjord or a river mouth, in the lee of a headland; where Pressure crushes the water a mole does not stand.",
    needs: [{ kind: "settlement", holds: within(() => harbourReach) }],
    excludes: [{ kind: "crushZone", holds: (_state, a, b) => b.cells.includes(a.anchor) }],
    contains: notApplicable("A harbour is one work; its mole and quay are parts of it."),
    pairsWith: [
      { kind: "bay", holds: within(around) },
      { kind: "fjord", holds: within(around) },
      { kind: "riverMouth", holds: within(around) },
      { kind: "headland", holds: within(around) },
    ],
  },
  people: {
    statement:
      "A harbour gives trade and fish in proportion to those it serves, and brings them down to where the sea reaches them: a tsunami on a straining coast, and a surge wherever Pressure runs strong.",
    offers(state, place) {
      const size = factors.magnitude(state, place);
      return { trade: size, food: size / 2 };
    },
    threatens(state, place) {
      const map = fieldOf(state),
        strained = map.TectonicStrain.get(place.anchor) > 0,
        exposed =
          heightAt(state, place.anchor) < waveHeight &&
          map.OceanDistance.get(place.anchor) < waveShore,
        surged = magicValue(state, "pressure", "intensity", place.anchor) >= harbourSurge;
      return [
        ...(strained && exposed
          ? [{ hazard: "tsunami", severity: tsunamiHazard.severity, reach: tsunamiHazard.radius }]
          : []),
        ...(surged
          ? [
              {
                hazard: "pressure surge",
                reach: Math.max(attribute(place, "radius"), around(state)),
                severity: 0.7,
              },
            ]
          : []),
      ];
    },
  },
  time: {
    statement:
      "A harbour lasts while it is kept and the sea stays. A falling sea leaves it stranded, and an unkept mole is broken up within generations; both leave a ruin on the shore.",
    fate: (state, place) =>
      isKept(place) && isSea(state, place.anchor)
        ? { fate: "persists" }
        : { fate: "ends", leaves: "ruin" },
  },
  visibility: {
    statement:
      "A harbour shows by the people it serves and by being the shelter on its coast; a capital's port shows however small, and one on an open beach among others shows late.",
    ...factors,
    importance: weighedPlace(factors, { magnitude: 0.5, localConditions: 0.2, isolation: 0.3 }),
  },
  naming: {
    statement:
      "Named by the community that built it, in its record, usually after that settlement or the bay it lies in.",
    namedBy: cultureOfWork,
    takesNameFrom: [
      { kind: "settlement", holds: within(() => harbourReach) },
      { kind: "bay", holds: within(around) },
    ],
    lendsNameTo: [{ kind: "settlement", holds: within(() => harbourReach) }],
  },
};
