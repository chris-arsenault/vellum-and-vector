import {
  spatial,
  type AtlasFeature,
  type GenerationCause,
  type GeographicObservation,
} from "@atlas/domain";
import type { GenerationState, MapProcessContext } from "../process";
import { generatedId } from "../mapFeatures";
import { ruleRecord } from "../poi/poiRecords";
import { components } from "./geographicRegions";
import { significantMagicArea } from "./worldMagicSignificance";

/** Largest overlapping successor keeps the identity; a split cannot duplicate it. */
export function linkObservedFootprints(
  previous: readonly GeographicObservation[],
  current: readonly GeographicObservation[]
): GeographicObservation[] {
  const matches: { before: number; after: number; area: number }[] = [];
  spatial.withIndex(
    previous.map((p) => p.geometry),
    (index) => {
      current.forEach((observation, after) => {
        const overlap = spatial.intersectionArea(observation.geometry);
        for (const before of index.query(spatial.bounds(observation.geometry))) {
          const area = overlap(previous[before].geometry);
          if (area > 0) matches.push({ before, after, area });
        }
      });
    }
  );
  matches.sort((a, b) => b.area - a.area || a.before - b.before || a.after - b.after);
  const usedBefore = new Set<number>(),
    usedAfter = new Set<number>(),
    result = current.map((p) => ({ ...p }));
  for (const { before, after } of matches) {
    if (usedBefore.has(before) || usedAfter.has(after)) continue;
    usedBefore.add(before);
    usedAfter.add(after);
    result[after].id = previous[before].id;
    result[after].name = previous[before].name;
  }
  return result;
}

function latestObservation(state: GenerationState): GeographicObservation[] {
  const causes = [...state.history.flatMap((epoch) => epoch.causes), ...(state.causes ?? [])];
  const last = causes
    .reverse()
    .find((cause) => cause.kind === "geography" && cause.featureKind === "veil:wild");
  return last?.kind === "geography" ? last.observations : [];
}

/** Record only completed epoch surveys of actual rule footprints. Empty surveys end a lineage. */
export function recordWildZoneHistory(state: GenerationState, context: MapProcessContext) {
  if (context.epochIndices[0] === undefined) return;
  const cause: GenerationCause = {
    kind: "geography",
    process: "atlas.magic-history",
    featureKind: "veil:wild",
    observations: linkObservedFootprints(
      latestObservation(state),
      observeWildFootprints(state, context)
    ),
  };
  context.recordCause(cause);
}

function observeWildFootprints(state: GenerationState, context: MapProcessContext) {
  const field = state.physical?.magic?.fields.find((f) => f.definition.id === "veil"),
    members = field?.features.wild,
    coverage = field?.coverage.wild;
  if (!field || !members) return [];
  const observed: GeographicObservation[] = [],
    record = ruleRecord("veil", "wild");
  components(
    state,
    (i) => Boolean(members.get(i)) && (coverage?.get(i) ?? 1) > 0,
    (found) => {
      if (!significantMagicArea(state, found, (i) => coverage?.get(i) ?? 1)) return;
      const cells = [...found],
        anchor = cells[0];
      const feature = record(state, { id: `wildZone:${anchor}`, kind: "wildZone", cells, anchor });
      if (!feature) return;
      if (!(feature.footprint ?? feature.geometry).type.includes("Polygon")) return;
      observed.push({
        id: generatedId(state, `wild-survey:${context.epochIndices.join(":")}:${feature.id}`),
        name: feature.name,
        geometry: feature.footprint ?? feature.geometry,
      });
    }
  );
  return observed;
}

/** Final publication reuses the last surveyed identities, never an invented earlier position. */
export function retainWildZoneIdentities(state: GenerationState, features: AtlasFeature[]) {
  const linked = linkObservedFootprints(
    latestObservation(state),
    features.map((feature) => ({
      id: feature.id,
      name: feature.name,
      geometry: feature.footprint ?? feature.geometry,
    }))
  );
  features.forEach((feature, index) => {
    feature.id = linked[index].id;
    feature.name = linked[index].name;
  });
}
