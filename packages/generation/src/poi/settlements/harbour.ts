import type { GenerationState } from "../../process";
import { carryWhereItLands, counterpartOf, goes, movesTo } from "../poiCarry";
import { notApplicable, type PoiCarried, type PoiEntry, type PoiFieldChange } from "../poiContract";
import type { PoiPlace } from "../poiContract";
import { holdsRecord, recordPlaces, within } from "../poiPlaces";
import { regionalSpan } from "../../regional/lattice";
import type { RegionalState } from "../../regional/state";
import {
  adjacent,
  cellSpan,
  fieldOf,
  gap,
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
import { aloneAmong, attachment, drawnWhen, sized, standsOut } from "../poiVisibilityRules";
import {
  attribute,
  cultureOfWork,
  isKept,
  isWork,
  keptLine,
  peopleWithin,
  seatPeople,
  strengthOf,
  workReach,
} from "./settlementRecords";

/** Water a harbour stands in, the seat it may lie from, and the people who build one, as societyWorks holds them. */
const greatestDepth = 30,
  seatReach = 10_000,
  builders = 1000;
/** Depth that lets a laden ship lie near the shore and the Pressure that wrecks a mole, as societySites holds them. */
const goodDepth = 10,
  surgeIntensity = 400;
/** Height a built quay adds at full strength, as societyWorks holds it. */
const quayHeight = 5;
/** Wave exposure behind a mole, per mille. */
const shelteredWaves = 300;
/** A sea lane pays four times to land on a shore cell, as mapRouting holds it; a harbour removes that. */
const landingCost = 4;
/** Sailing inside the mole, and the road along the quay. */
const inTheHarbour = 0.9,
  quayRoad = 0.7;
/** People a harbour at half as great as harbours get serves. */
const typicalPeople = 5000;
/** A mole across the water is raised seabed: what it costs a current or a Pressure ray. */
const moleCost = 2;
/** The grade a quay's own ground is held to on a refined map. */
const quayGradient = 0.03;
/** Elevation and shore distance within which the sea reaches a settlement, as societyHazards holds them. */
const waveHeight = 20,
  waveShore = 10_000;
const waveHazard = { severity: 0.4, reach: 10_000 };

const places = recordPlaces("harbour", isWork("harbor"));
const isA = holdsRecord("harbour", places);
const depthAt = (state: GenerationState, cell: number) =>
  metres(fieldOf(state).WaterDepths.get(cell));
const shallows = (state: GenerationState, cell: number) =>
  isSea(state, cell) && depthAt(state, cell) < greatestDepth;
const servedOf = (state: GenerationState, place: PoiPlace) => seatPeople(state, place);
const around = (state: GenerationState) => 6 * cellSpan(state);
const quay = (state: GenerationState) => 2 * cellSpan(state);
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
    depth = Math.max(...sea.map((next) => depthAt(state, next))) >= goodDepth ? 1 : 0.4,
    surged = magicValue(state, "pressure", "intensity", cell) >= surgeIntensity;
  return hemmed * lee * depth * (surged ? 0.3 : 1);
}
const factors = {
  magnitude: sized(servedOf, typicalPeople),
  /** A shelter on a coast with no other: its own waters over the country's. */
  localConditions: standsOut(waters, around),
  isolation: aloneAmong(places, (state) => 2 * around(state)),
  cultural: attachment(around),
};
function roadCost(state: GenerationState, place: PoiPlace, cell: number) {
  return isLand(state, cell) && gap(state, place.anchor, cell) <= quay(state) ? quayRoad : 1;
}
function boatCost(state: GenerationState, place: PoiPlace, cell: number) {
  if (gap(state, place.anchor, cell) > quay(state)) return 1;
  return isLand(state, cell) ? 1 / landingCost : inTheHarbour;
}
const moleAt = (_state: GenerationState, place: PoiPlace, cell: number) =>
  cell === place.anchor ? moleCost : 1;
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
      "A published work of `kind` harbor (`workKind` harbor) sited on `WaterKindCodes` ocean with `WaterDepths` under 30 m: a built place standing in the sea, where a land route meets a sea lane. A bay is the shelter with no record, a river mouth the water with no record, and a settlement with `siteKind` harbour is the town beside it.",
    isA,
  },
  existence: {
    statement:
      "Sited by a community of at least 1000 people, in shallow water within 10 km of its seat. The world map holds harbours as latent demands on a unit's shore, and refined maps do not yet make them; the kind publishes today only as an authored work.",
    way: "sited",
    requires: (state, cell) =>
      shallows(state, cell) && peopleWithin(state, cell, seatReach, builders),
    suitability: (state, cell) => Math.min(1, waters(state, cell)),
    places,
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
  },
  movement: {
    statement:
      "A harbour is where a land route becomes a sea lane: a lane pays nothing extra to land there, roads run on easily along its quay, and between them a route goes on across water no road can. Its mole is raised seabed, which currents and Pressure rays must go round.",
    roads: roadCost,
    boats: boatCost,
    drainage: notApplicable("It stands in the sea, below where the network ends."),
    magic: moleAt,
    crosses: () => ["strait"],
  },
  others: {
    statement:
      "A harbour needs a settlement to serve and lies best in a bay, a fjord or a river mouth, in the lee of a headland; where Pressure crushes the water a mole does not stand.",
    needs: [{ kind: "settlement", holds: within(() => seatReach) }],
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
        surged = magicValue(state, "pressure", "intensity", place.anchor) >= surgeIntensity;
      return [
        ...(strained && exposed ? [{ hazard: "tsunami", ...waveHazard }] : []),
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
    visibleAt: drawnWhen(factors, { magnitude: 0.5, localConditions: 0.2, isolation: 0.3 }),
  },
  naming: {
    statement:
      "Named by the community that built it, in its record, usually after that settlement or the bay it lies in.",
    namedBy: cultureOfWork,
    takesNameFrom: [
      { kind: "settlement", holds: within(() => seatReach) },
      { kind: "bay", holds: within(around) },
    ],
    lendsNameTo: [{ kind: "settlement", holds: within(() => seatReach) }],
  },
};
