import type { HistoryEntry, JsonValue, MapReader, MapRef } from "@atlas/map";
import type { Geometry } from "geojson";
import type { SurveyObservation } from "./SurveyComparison";

export async function readPublishedHistory(
  reader: MapReader,
  reference: MapRef,
  signal: AbortSignal
) {
  const entries: HistoryEntry[] = [];
  let cursor: string | undefined;
  do {
    const page = await reader.history(reference, cursor, { signal });
    entries.push(...page.items);
    cursor = page.next ?? undefined;
  } while (cursor);
  return entries;
}
/** Completed geographic surveys retain their own geometry and epoch ancestry. */
export function publishedSurveys(history: HistoryEntry[], id: string): SurveyObservation[] {
  return history.flatMap((entry) => {
    const cause = record(entry.attributes.cause);
    if (
      !cause ||
      cause.kind !== "geography" ||
      cause.featureKind !== "veil:wild" ||
      !Array.isArray(cause.observations)
    )
      return [];
    const observation = cause.observations.map(record).find((item) => item?.id === id);
    if (!observation) return [];
    const ancestry = entry.attributes.ancestry;
    const epoch = Array.isArray(ancestry)
      ? ancestry
          .flatMap((item) => (typeof record(item)?.id === "string" ? [record(item)!.id] : []))
          .join(" / ")
      : entry.title;
    return [{ epoch, geometry: observation.geometry as unknown as Geometry }];
  });
}
function record(value: JsonValue): Record<string, JsonValue> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value : null;
}
