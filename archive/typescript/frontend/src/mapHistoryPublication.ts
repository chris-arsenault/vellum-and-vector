import type { EpochHistory } from "@atlas/domain";
import type { HistoryEntry, JsonValue } from "@atlas/map";

/** Completed causal records are map content; no saved process or execution state is exposed. */
export function* mapHistoryRecords(
  history: EpochHistory[],
  runId: string
): Generator<HistoryEntry> {
  for (const [entryIndex, entry] of history.entries())
    for (const [causeIndex, cause] of entry.causes.entries()) {
      const featureIds =
        cause.kind === "geography"
          ? cause.observations.map((observation) => observation.id)
          : cause.kind === "domain"
            ? cause.subjects
            : [];
      yield {
        id: `${runId}:${String(entryIndex).padStart(10, "0")}:${String(causeIndex).padStart(10, "0")}`,
        title: cause.process,
        description: cause.kind === "domain" ? cause.description : cause.kind,
        epoch: null,
        featureIds,
        attributes: {
          path: entry.path,
          ancestry: entry.ancestry as unknown as JsonValue,
          cause: cause as unknown as JsonValue,
        },
      };
    }
}
