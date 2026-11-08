import {
  canonryConfluencePresets,
  spatial,
  type AtlasFeature,
  type RelativeMeasure,
} from "@atlas/domain";
import { mapScale } from "../../worldSignificance";
import type { GenerationState } from "../../process";
import { keptCondition, lineMemory } from "../../societyRecord";
import type { PoiCost, PoiFieldChange, PoiHazard, PoiPlace, PoiVisibility } from "../poiContract";
import { namingCultureNear } from "../poiPlaces";
import { cellSpan, cellsWithin, fieldOf, gap, heldFor, magicRule, magicValue } from "../poiReads";
import { weighed, type Weights } from "../poiVisibilityRules";
import { ruinPlaces, settlementPlaces } from "./communityRecords";

/** What the settlement group's entries share: reads of a place's record and the towns around it. */

/**
 * A distance in metres on this map: a physical reach never shrinks below the cells touching a
 * cell, the nearest thing a map of any size can tell apart.
 */
export const touching = (state: GenerationState, reach: number | RelativeMeasure) =>
  mapScale(state).supported(
    typeof reach === "number" ? reach : mapScale(state).resolveMeasure(reach),
    1.5
  );

export const attribute = (place: PoiPlace, name: string, otherwise = 0) => {
  const value = Number(place.feature?.attributes[name]);
  return Number.isFinite(value) ? value : otherwise;
};
export const travellersOf = (_state: GenerationState, place: PoiPlace) =>
  attribute(place, "travellers");
/** A work's standing strength: its magnitude as far as its condition has kept. */
export const strengthOf = (place: PoiPlace) =>
  attribute(place, "magnitude", 1) * attribute(place, "condition", 1);
/** Whether people still keep a work up. */
export const isKept = (place: PoiPlace) =>
  place.feature?.attributes.maintained !== false &&
  attribute(place, "condition", 1) > keptCondition;

/** A kept work keeps the line it stands on, the source Hallowed's lines read. */
export const keptLine = (place: PoiPlace, cell = place.anchor): readonly PoiFieldChange[] =>
  isKept(place) ? [{ change: "atLeast", band: "KeptLine", cell, value: lineMemory }] : [];
/**
 * The cells a located work acts on and its share at each, as `workSamples` falls it off. A work
 * smaller than a cell acts on that cell alone, by the share of it the work covers.
 */
export function workReach(state: GenerationState, place: PoiPlace) {
  const radius = attribute(place, "radius"),
    span = cellSpan(state);
  if (radius < span)
    return [
      {
        cell: place.anchor,
        share: Math.min(1, (Math.PI * radius ** 2) / fieldOf(state).mesh.area(place.anchor)),
      },
    ];
  return cellsWithin(state, place.anchor, radius).map((cell) => ({
    cell,
    share: Math.exp(-gap(state, place.anchor, cell) / radius),
  }));
}

/** People a settlement record stands for, its country's where it has one. */
export const peopleOfRecord = (town: AtlasFeature) =>
  Number(town.attributes.communityPopulation ?? town.attributes.population) || 0;
/** Cells within `reach` metres of a settlement of at least `least` people, one pass per town. */
const townsReach = (state: GenerationState, reach: number, least: number) =>
  heldFor(state, `townsReach:${reach}:${least}`, () => {
    const marked = new Uint8Array(fieldOf(state).mesh.count);
    for (const town of settlementPlaces(state))
      if (!least || (town.feature && peopleOfRecord(town.feature) >= least))
        for (const cell of cellsWithin(state, town.anchor, touching(state, reach)))
          marked[cell] = 1;
    return marked;
  });
/** Whether a settlement of at least `least` people stands within `reach` metres of a cell. */
export const nearTown = (
  state: GenerationState,
  cell: number,
  reach: number | RelativeMeasure,
  least = 0
) =>
  townsReach(
    state,
    typeof reach === "number" ? reach : mapScale(state).resolveMeasure(reach),
    least
  )[cell] === 1;
/** The settlement a work's record names: a seat by its record, or by its community. */
const townsById = (state: GenerationState) =>
  heldFor(state, "townsById", () => {
    const towns = new Map<string, () => AtlasFeature | undefined>();
    for (const town of [...settlementPlaces(state), ...ruinPlaces(state)]) {
      towns.set(town.id, () => town.feature);
      const id = town.feature?.attributes.communityId;
      if (typeof id === "string") towns.set(id, () => town.feature);
    }
    return towns;
  });
export function seatOf(state: GenerationState, place: PoiPlace) {
  const { seat, communityId } = place.feature?.attributes ?? {};
  const key = typeof seat === "string" ? seat : communityId;
  return typeof key === "string" ? townsById(state).get(key)?.() : undefined;
}
export const isGone = (town: AtlasFeature | undefined) =>
  !town || ["abandoned", "ruined"].includes(String(town.attributes.status));
export const seatPeople = (state: GenerationState, place: PoiPlace) => {
  const town = seatOf(state, place);
  return town ? peopleOfRecord(town) : 0;
};
/** A work's own recorded naming culture, else that of the people nearest it. */
export function cultureOfWork(state: GenerationState, place: PoiPlace) {
  const culture = place.feature?.attributes.namingCulture;
  return typeof culture === "string" ? culture : namingCultureNear(state, place);
}

export const eventKindOf = (place: PoiPlace) => String(place.feature?.attributes.eventKind ?? "");
export const deadOf = (_state: GenerationState, place: PoiPlace) => attribute(place, "casualties");
const typicalLoss = 1000;
/** An event's strength: its record's magnitude, or on a retained record its toll. */
export const eventMagnitude = (place: PoiPlace) => {
  const toll = attribute(place, "casualties") + attribute(place, "displaced");
  return Math.min(1, attribute(place, "magnitude", toll / (toll + typicalLoss)));
};
/** An event's reach in metres: its record's radius, or the half-width of a retained buffer. */
export function eventReach(state: GenerationState, place: PoiPlace) {
  const radius = attribute(place, "radius");
  if (radius > 0 || !place.feature || place.feature.geometry.type === "Point")
    return Math.max(radius, cellSpan(state));
  const [west, , east] = spatial.bounds(place.feature.geometry);
  return Math.max((east - west) / 2, cellSpan(state));
}
/** The share of the ground's living cover an event of its strength leaves damaged. */
export const damagedGround = (place: PoiPlace, share: number): readonly PoiFieldChange[] => [
  {
    change: "atLeast",
    band: "EcologicalDamage",
    cell: place.anchor,
    value: share * eventMagnitude(place),
  },
];
/** Who writes an event's dead: a declared total here would re-feed Salt every evaluation. */
export const deadAreRecorded =
  "societyRecord's recordEvents writes each event's dead to the mass-death band once, and Salt's source empties that band as it makes brine, so a declared total would raise the dead again at every evaluation.";

const salted = magicRule("salt", "ground");
/** People avoid salted ground: a road pays for it within an event's reach, as Salt's avoidance. */
export const avoidedGround = (state: GenerationState, place: PoiPlace): readonly PoiCost[] =>
  cellsWithin(state, place.anchor, eventReach(state, place))
    .filter((cell) => salted(state, cell))
    .map((cell) => ({
      cell,
      factor: 1 + Math.min(1, magicValue(state, "salt", "intensity", cell) / 1000),
    }));
/** Aurora and Salt strengths at which the two seed a preserved barrow, as its confluence presets them. */
const barrowAurora = 300,
  barrowSalt = 200;
/** The dead who do not rest: the preserved barrow's own hazard, where Aurora holds Salt still. */
export function restlessDead(state: GenerationState, place: PoiPlace): readonly PoiHazard[] {
  const stilled = magicValue(state, "aurora", "intensity", place.anchor) >= barrowAurora,
    brined = magicValue(state, "salt", "intensity", place.anchor) >= barrowSalt,
    meeting = (state.domain.world.confluences ?? canonryConfluencePresets()).find(
      (confluence) => confluence.id === "preserved"
    );
  return stilled && brined && meeting?.hazard
    ? [
        {
          hazard: meeting.hazard.kind,
          reach: meeting.hazard.radius,
          severity: meeting.hazard.severity,
        },
      ]
    : [];
}
/** Ground the dead have salted: thin, infertile and shunned, as far as the brine lies. */
export function saltedHazard(state: GenerationState, place: PoiPlace): readonly PoiHazard[] {
  return salted(state, place.anchor)
    ? [
        {
          hazard: "salted ground",
          reach: eventReach(state, place),
          severity: Math.min(1, magicValue(state, "salt", "intensity", place.anchor) / 1000),
        },
      ]
    : [];
}
/** An event's fate as an epoch closes: its brine outlasts its memory as a killing ground. */
export const eventFate = (state: GenerationState, place: PoiPlace) =>
  salted(state, place.anchor)
    ? ({ fate: "ends", leaves: "killingGround" } as const)
    : ({ fate: "persists" } as const);

/**
 * `weighed`, for a place with no cell to weigh it on: settlements and works also publish on maps
 * with no physical field, which store no importance for them.
 */
export function weighedPlace(
  factors: Pick<PoiVisibility, "magnitude" | "localConditions" | "isolation" | "cultural">,
  weights: Weights
) {
  const weigh = weighed(factors, weights);
  return (state: GenerationState, place: PoiPlace) =>
    state.physical && place.anchor >= 0 ? weigh(state, place) : 0;
}
