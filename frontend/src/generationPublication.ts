import {
  type CatalogChanges,
  type CatalogRecord,
  type RecordGeometry,
  type ChangeSet,
  type DomainSnapshot,
  type DomainWrite,
  type NumericalResource,
  type FieldGeography,
  type ResourceStore,
  type Band,
  type EpochHistory,
  type WorkspaceChange,
  type FeatureReader,
  type NetworkReader,
  type SpatialStore,
  sameValue,
} from "@atlas/domain";
import { catalogChanges } from "@atlas/application";
import {
  writeFieldLayout,
  writeFieldChannels,
  type FieldLayoutResources,
} from "@atlas/storage-browser";
import { worldMetadata } from "./worldMetadata";
import { snapshotRecords, snapshotRecordValue } from "./snapshotRecords";

interface ReadyGeography {
  resources: NumericalResource[];
  geography: FieldGeography[];
}
type GenerationCatalog = Pick<
  SpatialStore,
  "commit" | "beginPublication" | "appendPublication" | "finishPublication" | "discardPublication"
>;
interface GenerationRecordStores {
  features?: FeatureReader;
  sourceFeatures?: FeatureReader;
  networks?: NetworkReader;
  sourceNetworks?: NetworkReader;
  /** Encodes a record's geometry in stored form at the world's precision. */
  encode?: (record: CatalogRecord) => RecordGeometry;
}
interface Publication extends GenerationRecordStores {
  workspace: GenerationCatalog;
  original: DomainSnapshot;
  snapshot: DomainSnapshot;
  operationId: string;
  ready: ReadyGeography;
  check(): void;
  progress(change: WorkspaceChange): void;
}
/** Initial batches map directly from generated records; regeneration has one catalog commit. */
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
  const ready: ReadyGeography = { resources: [], geography: [] };
  let published = false;
  const publication: Publication = {
    ...records,
    workspace,
    original,
    snapshot,
    operationId,
    ready,
    check,
    progress(change) {
      published = true;
      progress(change);
    },
  };
  try {
    await publishFields(store, publication);
    if (initial) await publishInitial(publication, history);
    else await publishAtomic(publication, history);
  } catch (error) {
    // Progressive batches may already reference these immutable resources.
    if (!published)
      for (const resource of ready.resources.reverse()) await store.remove(resource.id);
    throw error;
  }
}
async function publishFields(store: ResourceStore, publication: Publication) {
  const { original, snapshot, operationId, ready, check } = publication;
  const layouts = new Map<Band, FieldLayoutResources>();
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
}
function* changedRecords(publication: Publication) {
  const { original, snapshot, features, sourceFeatures, networks, sourceNetworks } = publication;
  for (const write of snapshotRecords(snapshot, features?.values(), networks))
    if (
      !sameValue(
        snapshotRecordValue(original, write.kind, write.value.id, sourceFeatures, sourceNetworks),
        write.value
      )
    )
      yield write;
}
function* removedRecords(publication: Publication) {
  const { original, snapshot, features, sourceFeatures, networks, sourceNetworks } = publication;
  for (const write of snapshotRecords(original, sourceFeatures?.values(), sourceNetworks))
    if (!snapshotRecordValue(snapshot, write.kind, write.value.id, features, networks))
      yield { kind: write.kind, id: write.value.id };
}
function* recordBatches(publication: Publication) {
  let writes: DomainWrite[] = [];
  for (const write of changedRecords(publication)) {
    writes.push(write);
    if (writes.length === 128) {
      yield mappedChanges(publication, writes, []);
      writes = [];
    }
  }
  if (writes.length) yield mappedChanges(publication, writes, []);
  let removes: ChangeSet["removes"] = [];
  for (const remove of removedRecords(publication)) {
    removes.push(remove);
    if (removes.length === 128) {
      yield mappedChanges(publication, [], removes);
      removes = [];
    }
  }
  if (removes.length) yield mappedChanges(publication, [], removes);
}
function mappedChanges(
  publication: Publication,
  writes: DomainWrite[],
  removes: ChangeSet["removes"]
): CatalogChanges {
  const { original, snapshot, operationId } = publication;
  // Reach ownership follows its feature even when that feature is in a different batch.
  const owners = { ...snapshot.world.features };
  for (const write of writes) {
    if (write.kind !== "reach" || !publication.features) continue;
    const feature = publication.features.get(write.value.featureId);
    if (feature) owners[feature.id] = feature;
  }
  return encodedChanges(
    publication,
    catalogChanges(
      publicationSource(publication, writes, removes),
      {
        operationId,
        worldId: snapshot.world.id,
        actor: "generator",
        expectedVersion: original.world.version,
        readSet: [],
        writes,
        removes,
        invalidations: [],
        highImpact: false,
      },
      [],
      "generate",
      { ...snapshot.world, features: owners }
    )
  );
}
/** Each record's geometry is encoded here, once; the catalog stores the bytes as given. */
function encodedChanges(publication: Publication, changes: CatalogChanges) {
  const encode = publication.encode;
  if (encode) for (const write of changes.writes) write.encoded = encode(write);
  return changes;
}
function publicationSource(
  publication: Publication,
  writes: DomainWrite[],
  removes: ChangeSet["removes"]
) {
  const { original, sourceFeatures } = publication;
  if (!sourceFeatures) return original;
  const features: DomainSnapshot["world"]["features"] = {};
  const ids = [
    ...writes.filter((write) => write.kind === "feature").map((write) => write.value.id),
    ...removes.filter((remove) => remove.kind === "feature").map((remove) => remove.id),
  ];
  for (const id of ids) {
    const feature = sourceFeatures.get(id);
    if (feature) features[id] = feature;
  }
  return { ...original, world: { ...original.world, features } };
}
function completion(publication: Publication, history: EpochHistory[]) {
  const { id, version, ...metadata } = worldMetadata(publication.snapshot.world);
  void [id, version];
  return {
    metadata,
    causes: {
      runId: publication.operationId,
      areaId: publication.snapshot.scope.areaId,
      entries: history,
    },
  };
}
async function publishInitial(publication: Publication, history: EpochHistory[]) {
  const { workspace, original, ready, check, progress } = publication;
  let revision = original.world.version,
    first = true;
  const complete = completion(publication, history);
  const incomplete: NonNullable<CatalogChanges["metadata"]>["publication"] = {
    operationId: publication.operationId,
    areaId: publication.snapshot.scope.areaId,
    state: "incomplete",
  };
  const commit = async (changes: CatalogChanges) => {
    check();
    changes.expectedWorldRevision = revision;
    if (first)
      Object.assign(changes, ready, {
        metadata: {
          ...complete.metadata,
          generations: original.world.generations,
          publication: incomplete,
        },
      });
    const change = await workspace.commit(changes);
    revision = change.revision;
    first = false;
    progress(change);
  };
  for (const batch of recordBatches(publication)) await commit(batch);
  if (first) await commit(mappedChanges(publication, [], []));
  check();
  const final = mappedChanges(publication, [], []);
  Object.assign(final, complete, {
    metadata: { ...complete.metadata, publication: undefined },
    expectedWorldRevision: revision,
  });
  progress(await workspace.commit(final));
}
async function publishAtomic(publication: Publication, history: EpochHistory[]) {
  const { workspace, original, operationId, ready, check, progress } = publication;
  const token = await workspace.beginPublication({
    worldId: original.world.id,
    operationId,
    expectedWorldRevision: original.world.version,
    history: { kind: "generate", actor: "generator" },
  });
  try {
    for (const batch of recordBatches(publication)) {
      check();
      await workspace.appendPublication(token, batch);
    }
    const final = mappedChanges(publication, [], []);
    Object.assign(final, completion(publication, history), ready);
    await workspace.appendPublication(token, final);
    check();
    progress(await workspace.finishPublication(token));
  } finally {
    await workspace.discardPublication(token);
  }
}
