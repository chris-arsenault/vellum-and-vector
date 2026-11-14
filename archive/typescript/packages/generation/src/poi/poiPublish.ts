import { canonicalPosition, point, type AtlasFeature } from "@atlas/domain";
import {
  generationFeature,
  generationFeatures,
  removeGenerationFeature,
  writeGenerationFeature,
} from "../generationFeatures";
import { putGenerated } from "../mapFeatures";
import type { GenerationState } from "../process";
import type { RegionalState } from "../regional/state";
import { poiCatalogue } from "./catalogue";
import { nativePosition } from "../world/atlasWorkspace";
import { hostedCell, linkOn } from "../area/areaHosting";
import type { PoiCarried, PoiEntry, PoiMoment, PoiPlace } from "./poiContract";
import type { PoiKindId } from "./poiKinds";
import { applyNameTerm, takeNames } from "./poiNames";
import { originsOf } from "./poiOrigins";
import { forgetSettlements, heldFor, releaseHeld } from "./poiReads";
import { realized } from "./poiRealized";
import { varietyOfEntry } from "./poiVariety";
import { retainWildZoneIdentities } from "../world/wildZoneHistory";

interface Published {
  entry: PoiEntry;
  place: PoiPlace;
  featureId: string;
}
const published = new WeakMap<GenerationState, Published[]>();
/** Settlements come first: other sited kinds stand beside them and read them. */
const entries = () => {
  const all = Object.values(poiCatalogue),
    first = (entry: PoiEntry) => entry.id === "settlement" || entry.id === "ruin";
  return [...all.filter(first), ...all.filter((entry) => !first(entry))];
};
const called = <T>(value: unknown): T | null => (typeof value === "function" ? (value as T) : null);

/** A kind's places realized on this map; what its test finds below that stays latent. */
export function placesOf(state: GenerationState, entry: PoiEntry): readonly PoiPlace[] {
  return heldFor(state, `realized:${entry.id}`, () => {
    const found =
      called<(state: GenerationState) => readonly PoiPlace[]>(entry.existence.places)?.(state) ??
      [];
    return found
      .filter((place) => realized(state, entry, place))
      .map((p) => placed(state, entry, p));
  });
}
/** A place on an area records that area now, as it is placed. */
function placed(state: GenerationState, entry: PoiEntry, place: PoiPlace) {
  const kind = entry.acrossMaps.standsOn;
  if (typeof kind === "string" && !place.hostedBy)
    place.hostedBy = linkOn(state, kind, place.anchor) ?? undefined;
  return place;
}

/**
 * Publish every kind whose moment this is. This is the one place a catalogue kind's record is
 * written: each place of the kind, as its entry finds it, as its entry records it.
 */
export function publishKinds(
  state: GenerationState,
  moment: PoiMoment,
  delivered: (entry: PoiEntry) => boolean = () => true
) {
  releaseHeld(state);
  const written = published.get(state) ?? [];
  published.set(state, written);
  for (const entry of entries())
    if (entry.publication.moment === moment && delivered(entry)) publishKind(state, entry, written);
}
/** A place's true size, where its kind has answered that. */
function sizeAttributes(state: GenerationState, entry: PoiEntry, place: PoiPlace) {
  const trueSize = entry.trueSize;
  if (!trueSize || "slot" in trueSize) return {};
  return {
    trueSize: trueSize.size(state, place),
    members: trueSize.represents(state, place).members,
  };
}
/** What every record says of its place, whichever kind's record it is. */
function placeAttributes(state: GenerationState, entry: PoiEntry, place: PoiPlace) {
  const variety = varietyOfEntry(state, entry, place);
  return {
    poi: entry.id,
    ...sizeAttributes(state, entry, place),
    ...(place.origin ? { origin: place.origin } : {}),
    ...(place.hostedBy ? { hostedBy: place.hostedBy } : {}),
    ...(variety ? { variety } : {}),
  };
}
function publishKind(
  state: GenerationState,
  entry: PoiEntry,
  written: Published[],
  wanted: (place: PoiPlace) => boolean = () => true
) {
  const record = called<(s: GenerationState, p: PoiPlace) => AtlasFeature | null>(
    entry.publication.record
  );
  const records = placesOf(state, entry).flatMap((place) => {
    const feature = wanted(place) ? record?.(state, place) : null;
    return feature ? [{ place, feature }] : [];
  });
  if (entry.id === "wildZone")
    retainWildZoneIdentities(
      state,
      records.map(({ feature }) => feature)
    );
  for (const { place, feature } of records) {
    feature.attributes = { ...feature.attributes, ...placeAttributes(state, entry, place) };
    applyNameTerm(state, entry, place, feature);
    if (putGenerated(state, feature)) written.push({ entry, place, featureId: feature.id });
  }
  if (entry.id === "settlement" || entry.id === "ruin") forgetSettlements(state);
}
/**
 * A World's places whose origins read a later moment's kinds: a town's mountain waits for towns.
 * A refined map needs no such pass, since its society exists before its geography publishes.
 */
export function publishLatePlaces(state: GenerationState, moment: PoiMoment) {
  releaseHeld(state);
  const written = published.get(state) ?? [];
  for (const entry of entries()) {
    const late = new Set(
      originsOf(entry)
        .filter(({ reads }) => reads.some((k) => poiCatalogue[k].publication.moment === moment))
        .map(({ id }) => id)
    );
    // A kind this map did not deliver at its own moment stays undelivered.
    if (late.size && written.some((item) => item.entry.id === entry.id))
      publishKind(state, entry, written, (place) => late.has(place.origin ?? ""));
  }
}
/** The shared naming step, over everything this map published. */
export const takePublishedNames = (state: GenerationState) =>
  takeNames(state, published.get(state) ?? []);

const entryOf = (feature: AtlasFeature): PoiEntry | undefined =>
  poiCatalogue[String(feature.attributes.poi) as PoiKindId];
/** A place of the parent map, carried here. Its parent's product is captured, never this run's. */
const isCaptured = (feature: AtlasFeature) =>
  feature.attributes.poi !== undefined && feature.attributes.developedBy !== "regional";

export interface CarriedPlace {
  entry: PoiEntry;
  carried: PoiCarried;
  place: PoiPlace;
}
/** Every place the parent's map carries down onto this one, as each entry carries it. */
export function carriedPlaces(state: RegionalState): readonly CarriedPlace[] {
  return heldFor(state, "carried", () => {
    const found: CarriedPlace[] = [];
    for (const stored of generationFeatures(state, { areaId: state.regional.input.areaId })) {
      const entry = isCaptured(stored) ? entryOf(stored) : undefined,
        feature = capturedPlace(state, stored),
        carry =
          entry &&
          called<(s: RegionalState, f: AtlasFeature) => PoiCarried | null>(entry.acrossMaps.carry),
        carried = carry?.(state, feature);
      if (!entry || !carried) continue;
      found.push({
        entry,
        carried,
        place: {
          id: feature.id,
          kind: entry.id,
          cells: carried.cells,
          anchor: carried.cell,
          feature,
        },
      });
    }
    return found;
  });
}

/** Pinned current input owns the source position; capturedRecord remains provenance only. */
export const capturedPlace = (state: GenerationState, feature: AtlasFeature): AtlasFeature =>
  state.sourceFeatures?.get(feature.id) ?? feature;
/** What names a place: these stay with the captured record when it moves onto developed ground. */
const namingAttributes = [
  "nameStatus",
  "namingCulture",
  "namingLanguage",
  "namingKind",
  "namingSubkind",
  "namingVersion",
  "namedInEra",
] as const;
/** The captured record takes the developed place's shape and readings; that record leaves. */
function standsFor(state: RegionalState, captured: AtlasFeature, developed: AtlasFeature) {
  const parent = capturedPlace(state, captured),
    names = Object.fromEntries(
      namingAttributes
        .map((key) => [key, parent.attributes[key]])
        .filter(([, v]) => v !== undefined)
    );
  writeGenerationFeature(state, {
    ...captured,
    geometry: developed.geometry,
    footprint: developed.footprint,
    attributes: {
      ...developed.attributes,
      ...names,
      developedBy: undefined,
      capturedRecord: {
        geometry: parent.geometry,
        footprint: parent.footprint,
        attributes: parent.attributes,
      },
    },
  });
  removeGenerationFeature(state, developed.id);
  const list = published.get(state) ?? [];
  for (const item of list) if (item.featureId === developed.id) item.featureId = captured.id;
}
/**
 * A carried place with no developed record to stand for. Publication is no place to delete it:
 * it stays where it was, and the log says so and what its entry asked for.
 */
function resolveUnrealized(state: RegionalState, item: CarriedPlace, why: string) {
  const unrealized = called<
      (s: RegionalState, c: PoiCarried) => { outcome: string; cell?: number }
    >(item.entry.acrossMaps.unrealized),
    outcome = unrealized?.(state, item.carried).outcome ?? "keep";
  logCarry(state, item, `${why}: left where it was (entry says ${outcome})`);
}
/** What became of every carried place: nothing about carrying happens without a line here. */
const carryLog = new WeakMap<GenerationState, Record<string, number>>();
function logCarry(state: GenerationState, item: Pick<CarriedPlace, "entry">, outcome: string) {
  const log = carryLog.get(state) ?? {},
    line = `${item.entry.id}: ${outcome}`;
  carryLog.set(state, log);
  log[line] = (log[line] ?? 0) + 1;
}
export const carryOutcomes = (state: GenerationState) => carryLog.get(state) ?? {};
/**
 * After the map has published its own places: a place the parent carried stands for the
 * developed place the entry says is its counterpart, keeping its name and identity; where the
 * ground holds none, the entry says what becomes of it. Kinds whose identity follows their
 * own refinement rules, like a settlement's seat, state no counterpart.
 */
export function carryPlaces(state: RegionalState) {
  releaseHeld(state);
  const developedAt = new Map<string, string>();
  for (const { entry, place, featureId } of published.get(state) ?? [])
    for (const cell of place.cells) developedAt.set(`${entry.id}:${cell}`, featureId);
  for (const item of carriedPlaces(state)) carryPlace(state, item, developedAt);
  logUnreached(state);
  releaseHeld(state);
}
/** A captured place its entry says does not reach this map: it stays, and the log says so. */
function logUnreached(state: RegionalState) {
  const reached = new Set(carriedPlaces(state).map((item) => item.carried.feature.id));
  for (const stored of generationFeatures(state, { areaId: state.regional.input.areaId })) {
    const entry = isCaptured(stored) ? entryOf(stored) : undefined;
    if (entry && !reached.has(stored.id) && called(entry.acrossMaps.counterpart))
      logCarry(state, { entry }, "does not reach this map: left where it was");
  }
}
/** A place recorded on a river stands where that river now runs, however it has moved. */
function followRiver(state: RegionalState, item: CarriedPlace, developedAt: Map<string, string>) {
  const cell = hostedCell(state, item.carried.feature),
    captured = generationFeature(state, item.carried.feature.id);
  if (cell < 0 || !captured) return logCarry(state, item, "its river is not here: left");
  const developed = developedAt.get(`${item.entry.id}:${cell}`),
    feature = developed && generationFeature(state, developed);
  if (feature && feature.id !== captured.id) {
    standsFor(state, item.carried.feature, feature);
    return logCarry(state, item, "follows its river: stands for the place there");
  }
  if (captured.geometry.type !== "Point")
    return logCarry(state, item, "follows its river: a line, not moved");
  writeGenerationFeature(state, {
    ...captured,
    geometry: point(
      canonicalPosition(state.domain.world.reference, nativePosition(state.physical, cell))
    ),
    attributes: {
      ...captured.attributes,
      capturedRecord: captured.attributes.capturedRecord ?? {
        geometry: captured.geometry,
        footprint: captured.footprint,
        attributes: captured.attributes,
      },
    },
  });
  logCarry(state, item, "follows its river: moved");
}
function carryPlace(state: RegionalState, item: CarriedPlace, developedAt: Map<string, string>) {
  if (item.carried.feature.attributes.hostedBy) return followRiver(state, item, developedAt);
  const counterpart = called<(s: RegionalState, c: PoiCarried) => number>(
    item.entry.acrossMaps.counterpart
  );
  if (!counterpart) return;
  const cell = counterpart(state, item.carried);
  if (cell < 0) return resolveUnrealized(state, item, "no counterpart");
  const developed = developedAt.get(`${item.entry.id}:${cell}`);
  if (!developed) return resolveUnrealized(state, item, "counterpart below this map's bar");
  const feature = generationFeature(state, developed);
  if (!feature) return resolveUnrealized(state, item, "counterpart already stands for another");
  if (feature.id === item.carried.feature.id) return logCarry(state, item, "is its counterpart");
  standsFor(state, item.carried.feature, feature);
  logCarry(state, item, "stands for its counterpart");
}
