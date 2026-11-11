// @needsResolution carry: a carried place may not resolve on a finer map (ADR 0009).
import { MapScale, type SocietyEvent } from "@atlas/domain";
import { mapScale } from "../../worldSignificance";
import type { GenerationState } from "../../process";
import {
  avalancheIce,
  avalancheRate,
  avalancheSlope,
  floodRate,
  tsunamiRate,
  waveHeight,
  waveShore,
} from "../../societyHazards";
import { carryWhereItLands, stays } from "../poiCarry";
import {
  notApplicable,
  type PoiEntry,
  type PoiPhysicalChange,
  type PoiPlace,
} from "../poiContract";
import { holdsRecord, namingCultureNear } from "../poiPlaces";
import {
  cellSpan,
  cellsWithin,
  fieldOf,
  gap,
  heightAt,
  iceAt,
  slopeAt,
  toNative,
} from "../poiReads";
import { aloneAmong, attachment, sized, standsOut } from "../poiVisibilityRules";
import { cellOf, onceWritten } from "./communityRecords";
import {
  attribute,
  avoidedGround,
  deadAreRecorded,
  deadOf,
  eventFate,
  eventKindOf,
  eventMagnitude,
  eventReach,
  restlessDead,
  saltedHazard,
  touching,
  weighedPlace,
} from "./settlementRecords";
import { eventPlaces } from "./workRecords";

/** How far, in metres, wreck costs a road around where it struck. */
const wreckReach = MapScale.length(0.00075);
/** How a place's yearly chance counts toward suitability: the chance of one in about a thousand years. */
const remembered = 1000;
/** The dead and displaced at which a disaster is half as great as disasters get. */
const typicalLoss = 3000;
/** What each kind of disaster leaves on the ground, in metres, at full strength. */
const deposit = {
  avalanche: MapScale.length(1.25e-6),
  flood: MapScale.length(1.25e-7),
  tsunami: MapScale.length(2.5e-7),
};
/** A fracture event leaves the rock this much more conductive, per mille, at full strength. */
const cracked: Record<string, number> = { "thermal-fracture": 900, "steam-fracture": 900 };
/** The share of living cover a disaster's ground loses at full strength. */
const scoured = 0.8;

const eventsNotDisasters = ["siege", "collapse"];
const places = eventPlaces("disasterSite", (event) => !eventsNotDisasters.includes(event.kind));
const isA = holdsRecord("disasterSite", places);
const around = (state: GenerationState) => 6 * cellSpan(state);
const reachOf = (state: GenerationState, place: PoiPlace) =>
  Math.max(eventReach(state, place), around(state));
const atThePlace = (state: GenerationState, a: PoiPlace, b: PoiPlace) =>
  gap(state, a.anchor, b.anchor) <= reachOf(state, a);
const lossOf = (state: GenerationState, place: PoiPlace) =>
  deadOf(state, place) + attribute(place, "displaced");
const deadAt = (state: GenerationState, cell: number) => fieldOf(state).MassDeath.get(cell);
/** The yearly chance of each physical exposure at a cell, as `physicalExposures` rates them. */
function exposure(state: GenerationState, cell: number) {
  const map = fieldOf(state),
    avalanche =
      slopeAt(state, cell) > avalancheSlope &&
      iceAt(state, cell) > mapScale(state).resolveMeasure(avalancheIce),
    coastal =
      heightAt(state, cell) < mapScale(state).resolveMeasure(waveHeight) &&
      map.OceanDistance.get(cell) < mapScale(state).resolveMeasure(waveShore);
  return (
    (avalanche ? avalancheRate : 0) +
    map.FloodFrequency.get(cell) * floodRate +
    (coastal ? (map.TectonicStrain.get(cell) / 1000) * tsunamiRate : 0)
  );
}
/** Whether two systems meet at a cell: magic's own hazards fall on any such ground. */
const strained = (state: GenerationState, cell: number) =>
  (state.physical?.magic?.confluences.strain.get(cell) ?? 0) > 0;
const factors = {
  magnitude: sized(lossOf, typicalLoss),
  localConditions: standsOut(deadAt, reachOf),
  isolation: aloneAmong(places, reachOf),
  cultural: attachment(reachOf),
};
/** A new event requests work once; subsequent queries read the ground that survives it. */
export function disasterChanges(
  event: Pick<SocietyEvent, "kind" | "magnitude">,
  cell: number,
  scale: MapScale
): readonly PoiPhysicalChange[] {
  if (cell < 0) return [];
  const { kind } = event,
    strength = Math.min(1, Math.max(0, event.magnitude)),
    depth = deposit[kind as keyof typeof deposit];
  return [
    ...(depth
      ? ([
          {
            change: "atLeast",
            band: "SedimentThickness",
            cell,
            value: toNative(scale.resolveMeasure(depth) * strength),
          },
        ] as const)
      : []),
    ...(cracked[kind]
      ? ([
          { change: "atLeast", band: "FractureConductance", cell, value: cracked[kind] * strength },
        ] as const)
      : []),
    ...(kind === "pressure-ice-breach"
      ? [{ change: "atMost", band: "IceThickness", cell, value: 0 } as const]
      : []),
    { change: "atLeast", band: "EcologicalDamage", cell, value: scoured * strength },
  ];
}
/** Wreck on the road: worst at the anchor, gone at the edge of what it struck, or where salted. */
function roadCost(state: GenerationState, place: PoiPlace) {
  const reach = touching(state, wreckReach),
    shunned = new Map(avoidedGround(state, place).map(({ cell, factor }) => [cell, factor]));
  for (const cell of cellsWithin(state, place.anchor, reach)) {
    const wreck = 1 + eventMagnitude(place) * (1 - gap(state, place.anchor, cell) / reach);
    shunned.set(cell, Math.max(wreck, shunned.get(cell) ?? 1));
  }
  return [...shunned].map(([cell, factor]) => ({ cell, factor }));
}

export const disasterSite: PoiEntry = {
  id: "disasterSite",
  group: "settlements",
  name: "Disaster site",
  event: {
    accepts: (event) => !eventsNotDisasters.includes(event.kind),
    changes: (state, event) =>
      disasterChanges(event, cellOf(state, event.position), mapScale(state)),
  },
  recognition: {
    distinct:
      "A society event that is neither siege nor collapse: avalanche, flood, tsunami, or a magical meeting's hazard such as thermal-fracture, steam-fracture, pressure-ice-breach, rot-fever or undead. A battlefield is the same record at siege; collapse is a polity's end with no ground in it. A rogue wave's impact or a crater are the field's own marks with no event record.",
    isA,
  },
  existence: {
    statement:
      "Sited by the rates a community's own ground gives it: steep ice for an avalanche, flood frequency for a flood, a low straining coast for a tsunami, a meeting's coverage for its hazard. A drawn event strikes that community; those below ten thousand dead and displaced stay off the world map, and a refined map retains each that reaches it as a record of its affected area.",
    way: "sited",
    requires: (state, cell) => exposure(state, cell) > 0 || strained(state, cell),
    /** The chance of one here within what a culture could remember; magic's meetings are read as a share of it. */
    suitability: (state, cell) => {
      const chance = 1 - Math.exp(-exposure(state, cell) * remembered);
      return Math.max(chance, strained(state, cell) ? 0.5 : 0);
    },
    places,
  },
  publication: {
    statement:
      "An event publishes as a historical event, located with its affected communities on a map that ran its society, and as its affected area on a refined map.",
    moment: "society",
    record: onceWritten,
  },
  fields: {
    statement:
      "The event command leaves its mark once. Ground, ice and ecological state carry the aftermath; the historical place maintains no material constraints.",
    terrain: notApplicable("The completed event's debris and fractures are retained ground."),
    water: notApplicable("An old breach does not remove newly formed ice."),
    climate: notApplicable(
      "Each is over within a season, and the climate field carries no such short forcing."
    ),
    cover: notApplicable("The event damaged cover once; later ecological recovery is free."),
    magic: notApplicable(deadAreRecorded),
  },
  acrossMaps: {
    statement:
      "A captured disaster keeps its historical location and affected area. Captured ground and ecological state carry its surviving mark; refinement does not repeat the event.",
    carry: carryWhereItLands,
    realize: notApplicable("The retained material already carries any surviving event mark."),
    counterpart: (_state, carried) => carried.cell,
    unrealized: stays,
    settle: notApplicable("What has happened does not move with a round's water."),
    schedule: notApplicable("A disaster takes no part in refinement's steps."),
  },
  movement: {
    statement:
      "Wreck costs a road close to where it struck, and people shun any ground the dead have salted. Avalanche debris blocks a valley's drainage until it is cut through. A pressure-ice breach is the one disaster that opens a way, across the ice it broke.",
    roads: roadCost,
    boats: notApplicable(
      "Wreckage in a channel is below what boat costs resolve; a breach's open water is the sea's."
    ),
    drainage: (_state, place) =>
      eventKindOf(place) === "avalanche" ? [{ cell: place.anchor, factor: 2 }] : [],
    magic: notApplicable(
      "It lays down dead for Salt and takes nothing from any carrier; the brine rides the crust by Salt's own rule."
    ),
    links: notApplicable("A disaster joins nothing."),
    crosses: (state, place) =>
      eventKindOf(place) === "pressure-ice-breach" && iceAt(state, place.anchor) === 0
        ? ["ice"]
        : [],
  },
  others: {
    statement:
      "A disaster strikes a settlement exposed to it, which it may leave a ruin; a shrine may mark it, and its dead may feed a killing ground. It can happen on any ground with a hazard, so it excludes nothing.",
    needs: [{ kind: "settlement", holds: atThePlace }],
    excludes: notApplicable("Hazards fall on whatever stands in their way."),
    contains: notApplicable("Its record has one location and a reach; the reach holds no place."),
    pairsWith: [
      { kind: "ruin", holds: atThePlace },
      { kind: "killingGround", holds: atThePlace },
      { kind: "shrine", holds: atThePlace },
    ],
  },
  people: {
    statement:
      "It gives survivors a place to mourn, and a flood's silt also feeds its fields. Above all it warns: what struck once may strike again, as far as it reached, and its dead may have salted the ground.",
    offers: (state, place) => {
      const toll = factors.magnitude(state, place) / 2;
      return eventKindOf(place) === "flood"
        ? { sanctity: toll, food: eventMagnitude(place) / 2 }
        : { sanctity: toll };
    },
    threatens: (state, place) => [
      {
        hazard: eventKindOf(place),
        reach: eventReach(state, place),
        severity: eventMagnitude(place),
      },
      ...saltedHazard(state, place),
      ...restlessDead(state, place),
    ],
  },
  time: {
    statement:
      "An event happens once, and its record stays as history; its silt and debris become ordinary ground. As an epoch closes, ground its dead have salted carries on as a killing ground; elsewhere only the memory persists.",
    fate: eventFate,
  },
  visibility: {
    statement:
      "A disaster shows by the people it took and drove off, and by standing alone in its country's history; one that ruined a capital shows however small, and the tenth flood on the same plain shows late.",
    ...factors,
    importance: weighedPlace(factors, { magnitude: 0.6, localConditions: 0.15, isolation: 0.25 }),
  },
  naming: {
    statement:
      "Named by those who remember it, after the town it struck and the era it struck in; its record's name holds its event and era.",
    namedBy: namingCultureNear,
    takesNameFrom: [{ kind: "settlement", holds: atThePlace }],
    lendsNameTo: notApplicable("Places keep their own names through a disaster, not take its."),
  },
};
