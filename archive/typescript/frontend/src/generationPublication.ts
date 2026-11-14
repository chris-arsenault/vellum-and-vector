import type {
  Band,
  DomainSnapshot,
  EpochHistory,
  ResourceStore,
  WorkspaceChange,
} from "@atlas/domain";
import {
  publishCompletedGeneration,
  type GenerationCatalog,
  type GenerationRecordStores,
  type ReadyGeography,
} from "@atlas/application";
import {
  writeFieldLayout,
  writeFieldChannels,
  type FieldLayoutResources,
} from "@atlas/storage-browser";

/** The TypeScript producer encodes fields here; Rust supplies its completed local resources. */
export async function publishWorkspaceGeneration(
  workspace: GenerationCatalog,
  store: ResourceStore,
  original: DomainSnapshot,
  snapshot: DomainSnapshot,
  operationId: string,
  initial: boolean,
  history: EpochHistory[],
  progress: (change: WorkspaceChange) => void,
  check: () => void = () => {},
  records: GenerationRecordStores = {}
) {
  const ready =
    records.ready ?? (await publishFields(store, original, snapshot, operationId, check));
  return publishCompletedGeneration(
    workspace,
    store,
    original,
    snapshot,
    operationId,
    initial,
    history,
    progress,
    check,
    { ...records, ready }
  );
}
async function publishFields(
  store: ResourceStore,
  original: DomainSnapshot,
  snapshot: DomainSnapshot,
  operationId: string,
  check: () => void
) {
  const ready: ReadyGeography = { resources: [], geography: [] },
    layouts = new Map<Band, FieldLayoutResources>();
  try {
    for (const field of snapshot.world.fields) {
      if (
        !field.resourceId ||
        original.world.fields.some(
          (old) => old.id === field.id && old.resourceId === field.resourceId
        )
      )
        continue;
      const grid = snapshot.numerical[field.id];
      let shared = layouts.get(grid.active);
      if (!shared) {
        shared = await writeFieldLayout(
          store,
          grid,
          `${operationId}:layout:${layouts.size}`,
          snapshot.world.reference.precision ?? 1e-6,
          check
        );
        layouts.set(grid.active, shared);
        ready.resources.push(shared.layout, ...(shared.tree ? [shared.tree] : []));
        ready.geography.push(shared.geography);
      }
      ready.resources.push(
        await writeFieldChannels(store, grid, field.resourceId, shared, undefined, check)
      );
    }
    return ready;
  } catch (error) {
    for (const resource of ready.resources.reverse()) await store.remove(resource.id);
    throw error;
  }
}
