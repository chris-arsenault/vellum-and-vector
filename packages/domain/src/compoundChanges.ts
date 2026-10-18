import type { ChangeSet, DomainSnapshot, DomainWrite } from "./operations";
import { intentChanges, type IntentContext } from "./intent";
import { projectChanges } from "./projection";

export function combineChanges(
  context: IntentContext,
  source: DomainSnapshot,
  parts: ChangeSet[]
): ChangeSet {
  const result = intentChanges(context, source),
    writes = new Map<string, DomainWrite>(),
    removes = new Map<string, ChangeSet["removes"][number]>();
  const invalidations = new Map<string, ChangeSet["invalidations"][number]>();
  for (const part of parts) {
    for (const write of part.writes) {
      const key = `${write.kind}:${write.value.id}`;
      writes.set(key, write);
      removes.delete(key);
    }
    for (const removed of part.removes) {
      const key = `${removed.kind}:${removed.id}`;
      removes.set(key, removed);
      writes.delete(key);
    }
    for (const invalidation of part.invalidations)
      invalidations.set(
        JSON.stringify(
          invalidation.scope === "world"
            ? ["world", invalidation.fact]
            : [invalidation.spaceId, invalidation.fact, invalidation.footprint]
        ),
        invalidation
      );
    result.highImpact ||= part.highImpact;
    if (part.worldMetadata) result.worldMetadata = part.worldMetadata;
    if (part.fieldArtifacts)
      result.fieldArtifacts = [...(result.fieldArtifacts ?? []), ...part.fieldArtifacts];
  }
  result.writes = [...writes.values()];
  result.removes = [...removes.values()];
  result.invalidations = [...invalidations.values()];
  return result;
}
export function stagedSnapshot(source: DomainSnapshot, changes: ChangeSet): DomainSnapshot {
  const candidate = projectChanges(source, changes);
  candidate.world.version = source.world.version;
  return candidate;
}
