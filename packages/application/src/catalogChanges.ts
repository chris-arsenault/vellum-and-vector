import {
  areaSpace,
  representationId,
  sameValue,
  requireThat,
  type CatalogChanges,
  type CatalogRecord,
  type ChangeSet,
  type DomainSnapshot,
  type DomainWrite,
  type NumericalResource,
  type ObjectKind,
  type RecordReference,
  type World,
} from "@atlas/domain";

function expected(snapshot: DomainSnapshot, kind: ObjectKind, id: string): RecordReference {
  const revision = snapshot.revisions.find((r) => r.kind === kind && r.id === id)?.version ?? 0;
  return { kind, id, revision };
}
function areaId(data: DomainWrite, snapshot: DomainSnapshot, world: World) {
  if (data.kind === "area") return data.value.id;
  if (data.kind === "reach")
    return world.features[data.value.featureId]?.areaId ?? snapshot.scope.areaId;
  if (data.kind === "connection") return data.value.a.areaId;
  return "areaId" in data.value
    ? (data.value.areaId ?? snapshot.scope.areaId)
    : snapshot.scope.areaId;
}
function record(data: DomainWrite, snapshot: DomainSnapshot, world: World): CatalogRecord {
  const id = data.value.id;
  requireThat(id, "record_identity", "A stored domain record needs its semantic identity.");
  const area = areaId(data, snapshot, world);
  const spaceId = data.kind === "node" ? data.value.spaceId : areaSpace(world, area);
  requireThat(spaceId, "record_space", "A stored spatial record needs its located space.");
  return {
    scope: { worldId: world.id, spaceId, areaId: area },
    reference: expected(snapshot, data.kind, id),
    data,
  };
}
function details(data: Extract<DomainWrite, { kind: "feature" }>, snapshot: DomainSnapshot) {
  const writes: DomainWrite[] = [],
    removes: { kind: ObjectKind; id: string }[] = [];
  const previous = snapshot.world.features[data.value.id]?.detail ?? {};
  for (const [areaId, detail] of Object.entries(data.value.detail)) {
    if (sameValue(detail, previous[areaId])) continue;
    writes.push({
      kind: "representation",
      value: {
        ...detail,
        id: detail.id ?? representationId(snapshot.world.id, data.value.id, areaId),
        featureId: data.value.id,
        areaId,
      },
    });
  }
  for (const [areaId, detail] of Object.entries(previous))
    if (!data.value.detail[areaId]) {
      removes.push({
        kind: "representation",
        id: detail.id ?? representationId(snapshot.world.id, data.value.id, areaId),
      });
    }
  return { writes, removes };
}
/** Domain writes retain semantic shapes; each adapter maps those to its own physical schema. */
function readReferences(
  changes: ChangeSet,
  writes: Map<string, CatalogRecord>,
  removed: RecordReference[]
) {
  const references = new Map(
    changes.readSet.map((r) => [
      `${r.kind}:${r.id}`,
      { kind: r.kind, id: r.id, revision: r.version },
    ])
  );
  for (const ref of [...[...writes.values()].map((r) => r.reference), ...removed]) {
    const key = `${ref.kind}:${ref.id}`;
    if (!references.has(key)) references.set(key, ref);
  }
  return [...references.values()];
}
function removedRepresentations(snapshot: DomainSnapshot, removed: ChangeSet["removes"]) {
  const details: ChangeSet["removes"] = [];
  for (const record of removed) {
    if (record.kind !== "feature") continue;
    const feature = snapshot.world.features[record.id];
    for (const [areaId, detail] of Object.entries(feature?.detail ?? {}))
      details.push({
        kind: "representation",
        id: detail.id ?? representationId(snapshot.world.id, record.id, areaId),
      });
  }
  return details;
}
export function catalogChanges(
  snapshot: DomainSnapshot,
  changes: ChangeSet,
  resources: NumericalResource[],
  kind: string,
  resultingWorld?: World
): CatalogChanges {
  const world = resultingWorld ?? writtenWorld(snapshot, changes);
  const writes = new Map<string, CatalogRecord>(),
    removes = new Map(changes.removes.map((r) => [`${r.kind}:${r.id}`, r]));
  for (const removed of removedRepresentations(snapshot, changes.removes))
    removes.set(`representation:${removed.id}`, removed);
  const put = (data: DomainWrite) =>
    writes.set(`${data.kind}:${data.value.id}`, record(data, snapshot, world));
  for (const write of changes.writes) {
    if (write.kind !== "feature") continue;
    const finer = details(write, snapshot);
    for (const detail of finer.writes) put(detail);
    for (const remove of finer.removes) removes.set(`${remove.kind}:${remove.id}`, remove);
  }
  for (const write of changes.writes)
    put(write.kind === "feature" ? { ...write, value: { ...write.value, detail: {} } } : write);
  const metadata = publishSocieties(changes, put);
  const removed = [...removes.values()].map((r) => expected(snapshot, r.kind, r.id));
  return {
    operationId: changes.operationId,
    worldId: changes.worldId,
    expectedWorldRevision: changes.expectedVersion,
    expected: readReferences(changes, writes, removed),
    writes: [...writes.values()],
    removes: removed,
    metadata,
    resources,
    history: { kind, actor: changes.actor },
  };
}
function writtenWorld(snapshot: DomainSnapshot, changes: ChangeSet) {
  const world = {
    ...snapshot.world,
    areas: { ...snapshot.world.areas },
    features: { ...snapshot.world.features },
  };
  for (const write of changes.writes) {
    if (write.kind === "area") world.areas[write.value.id] = write.value;
    if (write.kind === "feature") world.features[write.value.id] = write.value;
  }
  return world;
}
function publishSocieties(changes: ChangeSet, put: (data: DomainWrite) => void) {
  for (const value of Object.values(changes.worldMetadata?.societies ?? {}))
    put({ kind: "society", value: { ...value, id: `society:${value.areaId}` } });
  const metadata = changes.worldMetadata ? { ...changes.worldMetadata } : undefined;
  if (metadata) delete metadata.societies;
  return metadata;
}
