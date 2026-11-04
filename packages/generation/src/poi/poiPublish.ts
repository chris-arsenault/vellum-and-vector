import type { AtlasFeature } from "@atlas/domain";
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
import type { PoiCarried, PoiEntry, PoiMoment, PoiPlace } from "./poiContract";
import type { PoiKindId } from "./poiKinds";
import { forgetSettlements, heldFor, releaseHeld } from "./poiReads";
import { realized } from "./poiRealized";

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
    return found.filter((place) => realized(state, entry, place));
  });
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
function publishKind(state: GenerationState, entry: PoiEntry, written: Published[]) {
  const record = called<(s: GenerationState, p: PoiPlace) => AtlasFeature | null>(
    entry.publication.record
  );
  for (const place of placesOf(state, entry)) {
    const feature = record?.(state, place);
    if (!feature) continue;
    feature.attributes = { ...feature.attributes, poi: entry.id };
    if (putGenerated(state, feature)) written.push({ entry, place, featureId: feature.id });
  }
  if (entry.id === "settlement" || entry.id === "ruin") forgetSettlements(state);
}

/**
 * Store what each published place weighs on its record, once everything that bears on it is on
 * the map: a town beside a summit counts towards the summit. The map reads it to draw by view.
 */
export function stampImportance(state: GenerationState) {
  releaseHeld(state);
  for (const { entry, place, featureId } of published.get(state) ?? []) {
    const feature = generationFeature(state, featureId),
      weigh = called<(s: GenerationState, p: PoiPlace) => number>(entry.visibility.importance);
    if (!feature || !weigh) continue;
    writeGenerationFeature(state, {
      ...feature,
      attributes: { ...feature.attributes, importance: weigh(state, place) },
    });
  }
  releaseHeld(state);
}

const entryOf = (feature: AtlasFeature): PoiEntry | undefined =>
  poiCatalogue[feature.attributes.poi as PoiKindId];
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
        feature = parentRecord(stored),
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

/**
 * The record as the parent left it, whatever an earlier refinement of this map moved it to:
 * rules read the same evidence on every run, so a repeated refinement places things the same.
 */
function parentRecord(feature: AtlasFeature): AtlasFeature {
  const parent = feature.attributes.capturedRecord as
    Pick<AtlasFeature, "geometry" | "footprint" | "attributes"> | undefined;
  return parent ? { ...feature, ...parent } : feature;
}
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
  const parent = parentRecord(captured),
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
function resolveUnrealized(state: RegionalState, item: CarriedPlace) {
  const unrealized = called<
    (s: RegionalState, c: PoiCarried) => { outcome: string; cell?: number }
  >(item.entry.acrossMaps.unrealized);
  if (unrealized?.(state, item.carried).outcome === "drop")
    removeGenerationFeature(state, item.carried.feature.id);
}
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
  releaseHeld(state);
}
function carryPlace(state: RegionalState, item: CarriedPlace, developedAt: Map<string, string>) {
  const counterpart = called<(s: RegionalState, c: PoiCarried) => number>(
    item.entry.acrossMaps.counterpart
  );
  if (!counterpart) return;
  const cell = counterpart(state, item.carried);
  if (cell < 0) return resolveUnrealized(state, item);
  const developed = developedAt.get(`${item.entry.id}:${cell}`),
    feature = developed && generationFeature(state, developed);
  if (feature && feature.id !== item.carried.feature.id)
    standsFor(state, item.carried.feature, feature);
}
