import {
  requireThat,
  type ChangeSet,
  type DomainWrite,
  type ObjectKind,
  type World,
  type Area,
} from "@atlas/domain";
import { registerObjects, type Sql } from "./database";
import { allocateRevisions, closeRevisions, currentRevisions } from "./revisions";
import { writeArea } from "./areaWriter";
import { writeFeatureBases, writeEntities, writeLayers, writeConnections } from "./objectWriters";
import { writeRepresentations } from "./representations";
import { writeNodes, writeReaches } from "./networkRows";
import { writeFieldBindings } from "./fieldBindings";
import { recomposeFeatures } from "./recompose";
import type { ObjectChange } from "./operations";
import { writeTemplateInstances } from "./templateInstances";
import { writeCoverage } from "./coverage";
import { writeFieldPatches } from "./fieldPatches";
import { writeMagic, writeViews } from "./settings";

type WriteValues = { [W in DomainWrite as W["kind"]]: W["value"] };
async function registerChangeObjects(sql: Sql, world: World, changes: ChangeSet) {
  await registerObjects(sql, world.id, [
    ...changes.writes
      .filter((w) => w.kind !== "layer")
      .map((w) => ({ id: w.value.id, kind: w.kind })),
    ...(changes.templateInstances ?? []).map((i) => ({ id: i.id, kind: "templateInstance" })),
  ]);
}
function ofKind<K extends ObjectKind>(writes: DomainWrite[], kind: K): WriteValues[K][] {
  return writes
    .filter((w): w is Extract<DomainWrite, { kind: K }> => w.kind === kind)
    .map((w) => w.value) as WriteValues[K][];
}
export async function applyWrites(
  sql: Sql,
  world: World,
  changes: ChangeSet
): Promise<{ objects: ObjectChange[]; affectedFeatures: string[] }> {
  const identities = [
    ...changes.writes.map((w) => ({ kind: w.kind, id: w.value.id })),
    ...changes.removes,
  ];
  requireThat(
    new Set(identities.map((o) => JSON.stringify([o.kind, o.id]))).size === identities.length,
    "duplicate_write",
    "An operation changes each object identity once."
  );
  const objects: ObjectChange[] = [];
  for (const kind of new Set(identities.map((w) => w.kind))) {
    const ids = identities.filter((w) => w.kind === kind).map((w) => w.id),
      before = await currentRevisions(sql, world.id, kind, ids);
    for (const id of ids)
      objects.push({
        kind,
        id,
        beforeRevision: before.find((r) => r.id === id)?.revisionId ?? null,
        afterRevision: null,
      });
    await closeRevisions(sql, world.id, world.version, kind, ids);
  }
  await registerChangeObjects(sql, world, changes);
  const revisions = await allocateRevisions(
    sql,
    world.id,
    changes.writes.map((w) => w.value.id)
  );
  const revised = <T extends { id: string }>(values: T[]) =>
    values.map((value) => ({ value, revision: revisions.get(value.id)! }));
  await writeAreas(sql, world, ofKind(changes.writes, "area"), revisions);
  await writeMagic(sql, world.id, world.version, revised(ofKind(changes.writes, "magic")));
  await writeViews(sql, world.id, world.version, revised(ofKind(changes.writes, "view")));
  await writeLayers(sql, world.id, world.version, revised(ofKind(changes.writes, "layer")));
  await writeFeatureBases(sql, world.id, world.version, revised(ofKind(changes.writes, "feature")));
  await writeEntities(sql, world.id, world.version, revised(ofKind(changes.writes, "entity")));
  await writeNodes(sql, world.id, world.version, revised(ofKind(changes.writes, "node")));
  await writeReaches(sql, world.id, world.version, revised(ofKind(changes.writes, "reach")));
  await writeConnections(
    sql,
    world.id,
    world.version,
    revised(ofKind(changes.writes, "connection"))
  );
  await writeRepresentations(
    sql,
    world.id,
    world.version,
    revised(ofKind(changes.writes, "representation"))
  );
  await writeFieldBindings(sql, world.id, world.version, revised(ofKind(changes.writes, "field")));
  await writeFieldPatches(
    sql,
    world.id,
    world.version,
    revised(ofKind(changes.writes, "fieldPatch"))
  );
  await writeCoverage(sql, world.id, world.version, revised(ofKind(changes.writes, "coverage")));
  await writeTemplateInstances(
    sql,
    world.id,
    world.owner,
    world.version,
    changes.templateInstances ?? []
  );
  for (const object of objects) object.afterRevision = revisions.get(object.id) ?? null;
  const features = await affectedFeatures(sql, world, changes);
  return { objects, affectedFeatures: await recomposeFeatures(sql, world, features) };
}
async function writeAreas(sql: Sql, world: World, values: Area[], revisions: Map<string, string>) {
  const pending = [...values],
    done = new Set<string>();
  while (pending.length) {
    const i = pending.findIndex(
      (a) => a.parentId === null || !values.some((p) => p.id === a.parentId) || done.has(a.parentId)
    );
    requireThat(i >= 0, "area_cycle", "Geographic changes require an acyclic parent hierarchy.");
    const [area] = pending.splice(i, 1);
    await writeArea(sql, world.id, world.version, revisions.get(area.id)!, {
      ...area,
      version: world.version,
    });
    done.add(area.id);
  }
}
async function affectedFeatures(sql: Sql, world: World, changes: ChangeSet): Promise<string[]> {
  const ids = new Set(ofKind(changes.writes, "feature").map((f) => f.id));
  for (const r of ofKind(changes.writes, "representation")) ids.add(r.featureId);
  for (const r of changes.removes.filter((r) => r.kind === "feature")) ids.add(r.id);
  const areas = [
    ...ofKind(changes.writes, "area").map((a) => a.id),
    ...changes.removes.filter((r) => r.kind === "area").map((r) => r.id),
  ];
  const removed = changes.removes.filter((r) => r.kind === "representation").map((r) => r.id);
  const refs = await sql.query<{ feature_id: string }>(
    `SELECT feature_id FROM atlas_representation_ids WHERE scope_id=$1 AND (id=ANY($2::uuid[]) OR area_id=ANY($3::uuid[]))
    UNION SELECT id FROM atlas_features WHERE scope_id=$1 AND area_id=ANY($3::uuid[]) AND valid_to IS NULL`,
    [world.id, removed, areas]
  );
  for (const row of refs.rows) ids.add(row.feature_id);
  return [...ids];
}
