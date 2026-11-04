import { canonryConfluencePresets, spatial, type AtlasFeature } from "@atlas/domain";
import { generationFeature, generationFeatures } from "../../generationFeatures";
import type { GenerationState } from "../../process";
import { cellAt } from "../../regional/lattice";
import type { PoiFieldChange, PoiHazard, PoiPlace } from "../poiContract";
import type { PoiKindId } from "../poiKinds";
import { namingCultureNear, recordPlaces } from "../poiPlaces";
import {
  cellSpan,
  cellsWithin,
  featureCell,
  featuresOf,
  fieldOf,
  gap,
  heldFor,
  magicRule,
  magicValue,
  settlementsOf,
} from "../poiReads";

/**
 * What the settlement group's entries share: reads of the published work and event records.
 * Constants marked "as X holds it" are private to that generator file; they are repeated here
 * because this group may not edit it, and should become exports when the catalogue is wired.
 */

/** Discharge above which a road crosses by a bridge and the factor a ford charges, as regional/societyWays holds them. */
export const bridgeFlow = 20,
  fordCost = 3;
/** Years over which a line is forgotten, as societyRecord holds it: the most a kept work's line reaches. */
const lineMemory = 150;
/** The condition above which a work keeps its line, as societyRecord holds it. */
const keptCondition = 0.5;

/** A published work of a record kind, including a legacy authored work that names it. */
export const isWork = (record: string) => (feature: AtlasFeature) =>
  feature.kind === record ||
  (feature.kind === "societyWork" && feature.attributes.workKind === record);

/**
 * Places of a sited kind whose record may be an area: a work's own `site`, else the area's
 * interior. `recordPlaces` takes the first coordinate, which for a retained event's buffer or an
 * irrigated area lies on its rim, or off the map.
 */
export const areaPlaces =
  (kind: PoiKindId, matches: (feature: AtlasFeature) => boolean) =>
  (state: GenerationState): readonly PoiPlace[] =>
    heldFor(state, `places:${kind}`, () => {
      const places: PoiPlace[] = [];
      for (const feature of generationFeatures(state))
        if (matches(feature)) {
          const anchor = recordCell(state, feature);
          if (anchor >= 0) places.push({ id: feature.id, kind, cells: [anchor], anchor, feature });
        }
      return places;
    });
function recordCell(state: GenerationState, feature: AtlasFeature) {
  if (feature.geometry.type === "Point") return featureCell(state, feature);
  const site = feature.attributes.site as { x: number; y: number } | undefined,
    { x, y } = site ?? spatial.interiorPosition(feature.geometry);
  return cellAt(fieldOf(state).mesh, x, y);
}

export const fordPlaces = recordPlaces("ford", isWork("ford"));
export const bridgePlaces = recordPlaces("bridge", isWork("bridge"));
/** Every crossing on the map, of either kind: what a crossing stands alone among. */
export const crossingPlaces = (state: GenerationState) => [
  ...fordPlaces(state),
  ...bridgePlaces(state),
];

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
/** The cells a located work acts on and its share at each, as `workSamples` falls it off. */
export function workReach(state: GenerationState, place: PoiPlace) {
  const radius = Math.max(attribute(place, "radius"), cellSpan(state));
  return cellsWithin(state, place.anchor, radius).map((cell) => ({
    cell,
    share: Math.exp(-gap(state, place.anchor, cell) / radius),
  }));
}

/** People a settlement record stands for, its country's where it has one. */
export const peopleOfRecord = (town: AtlasFeature) =>
  Number(town.attributes.communityPopulation ?? town.attributes.population) || 0;
/** Whether a settlement of at least `least` people stands within `reach` metres of a cell. */
export function peopleWithin(state: GenerationState, cell: number, reach: number, least: number) {
  for (const town of settlementsOf(state))
    if (peopleOfRecord(town) >= least && gap(state, featureCell(state, town), cell) <= reach)
      return true;
  return false;
}
/** The settlement a work's record names: a mill's `seat`, or a work's `communityId`. */
export function seatOf(state: GenerationState, place: PoiPlace) {
  const { seat, communityId } = place.feature?.attributes ?? {};
  if (typeof seat === "string") return generationFeature(state, seat);
  if (communityId === undefined) return undefined;
  for (const town of featuresOf(state, "settlement"))
    if (town.attributes.communityId === communityId) return town;
  return undefined;
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

export const isEvent = (feature: AtlasFeature) => feature.kind === "societyEvent";
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
/** The dead lie where they fell: the amount Salt's death origin reads, held and never added twice. */
export const deadGround = (place: PoiPlace, cell = place.anchor): readonly PoiFieldChange[] => {
  const value = attribute(place, "casualties");
  return value > 0 ? [{ change: "atLeast", band: "MassDeath", cell, value }] : [];
};
/** The share of the ground's living cover an event of its strength leaves damaged. */
export const damagedGround = (place: PoiPlace, share: number): readonly PoiFieldChange[] => [
  {
    change: "atLeast",
    band: "EcologicalDamage",
    cell: place.anchor,
    value: share * eventMagnitude(place),
  },
];

const salted = magicRule("salt", "ground");
/** People avoid salted ground: a road pays for it within an event's reach, as Salt's avoidance. */
export const avoidedGround = (state: GenerationState, place: PoiPlace, cell: number) =>
  salted(state, cell) && gap(state, place.anchor, cell) <= eventReach(state, place)
    ? 1 + Math.min(1, magicValue(state, "salt", "intensity", cell) / 1000)
    : 1;
/** Aurora and Salt strengths at which the two seed a preserved barrow, as its confluence holds them. */
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
