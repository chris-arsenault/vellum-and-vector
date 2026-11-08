import {
  areaSpace,
  type DomainSnapshot,
  type ChangeSet,
  type BlockCache,
  sameValue,
} from "@atlas/domain";
import { catalogChanges } from "@atlas/application";
import type { BrowserWorkspace } from "@atlas/storage-browser";
import { WorkspaceFields } from "./workspaceFields";
import { openBlockCache } from "@atlas/storage-browser";
import { SnapshotFields } from "./snapshotFields";
import { snapshotRecords } from "./snapshotRecords";
import { worldMetadata } from "./worldMetadata";

function snapshotWrites(snapshot: DomainSnapshot) {
  return [...snapshotRecords(snapshot)];
}
export async function importWorkspace(current: BrowserWorkspace, snapshot: DomainSnapshot) {
  await importState(current, new SnapshotFields(), snapshot);
  return current.catalog.readEditor(snapshot.world.id);
}
export async function importState(
  current: Pick<BrowserWorkspace, "catalog" | "resources">,
  resources: SnapshotFields,
  source: DomainSnapshot,
  previous?: DomainSnapshot,
  blocks?: BlockCache
) {
  const { snapshot, artifacts } = resources.prepare(source),
    { world } = snapshot;
  const root = Object.values(world.areas).find((area) => !area.parentId)!;
  snapshot.scope = { ...snapshot.scope, areaId: root.id, spaceId: areaSpace(world, root.id) };
  const before = previous ?? { ...snapshot, world: { ...world, features: {} }, revisions: [] };
  if (!previous)
    await current.catalog.createWorld({ ...worldMetadata(world), version: world.version - 1 });
  const changes = importedChanges(snapshot, previous);
  changes.fieldArtifacts = artifacts;
  const working = await importWorking(blocks);
  const fields = new WorkspaceFields(current.catalog, current.resources, working.cache);
  try {
    await fields.publish(changes, world.reference.precision ?? 1e-6);
    const publication = catalogChanges(before, changes, fields.outputs, "import");
    publication.geography = fields.geography;
    await current.catalog.importRevision(publication, world.version);
    fields.accept();
    const revisions = new Map((previous?.revisions ?? []).map((r) => [`${r.kind}:${r.id}`, r]));
    for (const ref of publication.removes) revisions.delete(`${ref.kind}:${ref.id}`);
    for (const { reference: ref } of publication.writes)
      revisions.set(`${ref.kind}:${ref.id}`, {
        kind: ref.kind,
        id: ref.id,
        revisionId: ref.id,
        version: world.version,
      });
    snapshot.revisions = [...revisions.values()];
    return snapshot;
  } finally {
    await fields.close();
    await working.close();
  }
}
async function importWorking(blocks?: BlockCache) {
  return blocks ? { cache: blocks, close() {} } : openBlockCache(`import_${crypto.randomUUID()}`);
}
function importedChanges(snapshot: DomainSnapshot, previous?: DomainSnapshot): ChangeSet {
  const writes = snapshotWrites(snapshot),
    ids = new Set(writes.map((w) => `${w.kind}:${w.value.id}`));
  const metadata = worldMetadata(snapshot.world),
    oldMetadata = previous && worldMetadata(previous.world);
  const { id, reference, version, ...values } = metadata;
  void reference;
  const worldMetadataChanges = Object.fromEntries(
    Object.keys({ ...oldMetadata, ...values })
      .filter((key) => !["id", "reference", "version"].includes(key))
      .filter(
        (key) =>
          !sameValue(
            oldMetadata?.[key as keyof typeof oldMetadata],
            values[key as keyof typeof values]
          )
      )
      .map((key) => [key, values[key as keyof typeof values]])
  );
  return {
    operationId: crypto.randomUUID(),
    worldId: id,
    expectedVersion: previous?.world.version ?? version - 1,
    actor: "user",
    readSet: [],
    writes,
    removes: previous
      ? snapshotWrites(previous)
          .filter((write) => !ids.has(`${write.kind}:${write.value.id}`))
          .map((write) => ({ kind: write.kind, id: write.value.id }))
      : [],
    worldMetadata: {
      name: metadata.name,
      seed: metadata.seed,
      epochs: metadata.epochs,
      ...worldMetadataChanges,
    },
    invalidations: [],
    highImpact: false,
  };
}
