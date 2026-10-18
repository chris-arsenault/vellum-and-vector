import { randomUUID } from "node:crypto";
import {
  requireThat,
  type ChangeSet,
  type DomainSnapshot,
  type ParameterValues,
  type ReadRequirements,
  type RevisionReference,
} from "@atlas/domain";
import { Database, ownedVersion, insertRows, type Sql } from "./database";
import { readProjection } from "./projections";
import { readWorldHeader, writeWorldHeader } from "./worldHeader";
import { applyWrites } from "./changeWriter";
import { currentRevisions } from "./revisions";
import { contentHash } from "./typedValues";
import { existingOperation, writeOperation, type OperationRecord } from "./operations";
import { publishField } from "./fieldArtifacts";

export interface PreparedOperation {
  id: string;
  version: number;
  kind: string;
  expectedVersion: number;
  parameters: ParameterValues;
  requestHash?: string;
  confirmed?: boolean;
  reads: ReadRequirements;
  evaluate(snapshot: DomainSnapshot): ChangeSet;
}
export async function assertReadSet(
  sql: Sql,
  world: string,
  reads: RevisionReference[]
): Promise<void> {
  for (const kind of new Set(reads.map((r) => r.kind))) {
    const group = reads.filter((r) => r.kind === kind),
      current = await currentRevisions(
        sql,
        world,
        kind,
        group.map((r) => r.id)
      );
    requireThat(
      group.every((read) =>
        current.some((r) => r.id === read.id && r.revisionId === read.revisionId)
      ),
      "revision_conflict",
      "An input object changed after this operation was prepared."
    );
  }
}
export async function publishChanges(
  sql: Sql,
  owner: string,
  changes: ChangeSet,
  operation: {
    kind: string;
    version: number;
    parameters: ParameterValues;
    hash: string;
    reads: ReadRequirements;
  }
): Promise<OperationRecord> {
  const before = await readWorldHeader(sql, changes.worldId, changes.expectedVersion);
  await assertReadSet(sql, changes.worldId, changes.readSet);
  const world = { ...before, ...changes.worldMetadata, version: before.version + 1 };
  await writeWorldHeader(sql, world);
  for (const artifact of changes.fieldArtifacts ?? [])
    await publishField(sql, artifact.reference, artifact.grid, world.version);
  const result = await applyWrites(sql, world, changes);
  await writeInvalidations(sql, world.id, world.version, changes, operation.reads);
  const record = operationRecord(
    world.id,
    world.version,
    before.version,
    owner,
    changes,
    operation,
    result.affectedFeatures
  );
  await writeOperation(sql, {
    record,
    parameters: operation.parameters,
    reads: changes.readSet.map((r) => ({ ...r, role: "input" })),
    scopes: [
      {
        role: "read",
        spaceId: operation.reads.scope.spaceId,
        footprint: operation.reads.scope.footprint,
      },
      {
        role: "write",
        spaceId: operation.reads.scope.spaceId,
        footprint: operation.reads.scope.footprint,
      },
    ],
    changes: result.objects,
    worldSettingsChanged: changes.worldMetadata !== undefined,
  });
  await insertRows(
    sql,
    "atlas_operation_artifacts",
    ["world_id", "operation_id", "resource_id"],
    (changes.fieldArtifacts ?? []).map((a) => [world.id, changes.operationId, a.reference.id])
  );
  await sql.query(
    "UPDATE atlas_worlds SET version=$1,name=$2,updated_at=now() WHERE id=$3 AND owner=$4",
    [world.version, world.name, world.id, owner]
  );
  return (await existingOperation(sql, world.id, changes.operationId, operation.hash))!;
}
async function writeInvalidations(
  sql: Sql,
  world: string,
  version: number,
  changes: ChangeSet,
  reads: ReadRequirements
) {
  await insertRows(
    sql,
    "atlas_invalidations",
    [
      "id",
      "world_id",
      "version",
      "space_id",
      "fact",
      "footprint",
      "cause",
      "time_context",
      "resolution",
      "scope_kind",
    ],
    changes.invalidations.map((i) => [
      randomUUID(),
      world,
      version,
      i.scope === "spatial" ? i.spaceId : null,
      i.fact,
      i.scope === "spatial" ? JSON.stringify(i.footprint) : null,
      i.cause,
      reads.scope.time,
      reads.scope.resolution,
      i.scope,
    ]),
    ["footprint"]
  );
}
function operationRecord(
  world: string,
  version: number,
  beforeVersion: number,
  owner: string,
  changes: ChangeSet,
  operation: { kind: string; hash: string; version: number },
  affectedFeatures: string[]
) {
  return {
    worldId: world,
    operationId: changes.operationId,
    version,
    beforeVersion,
    actor: changes.actor,
    kind: operation.kind,
    requestHash: operation.hash,
    commandVersion: operation.version,
    impact: {
      features: affectedFeatures,
      areas: changes.writes.filter((w) => w.kind === "area").map((w) => w.value.id),
      layers: [
        ...new Set(changes.writes.flatMap((w) => ("layerId" in w.value ? [w.value.layerId] : []))),
      ],
      invalidations: [...new Set(changes.invalidations.map((i) => i.fact))],
      highImpact: changes.highImpact,
    },
  };
}
export async function executeOperation(
  sql: Sql,
  world: string,
  owner: string,
  operation: PreparedOperation,
  version: number,
  hash: string,
  actor: string
): Promise<OperationRecord> {
  requireThat(
    operation.reads.scope.worldId === world &&
      operation.reads.scope.revision === version &&
      operation.expectedVersion === version,
    "stale_version",
    "The world changed; reload the affected scope and retry."
  );
  const snapshot = await readProjection(sql, operation.reads),
    changes = operation.evaluate(snapshot);
  requireThat(
    !changes.highImpact || (operation.confirmed === true && actor === `user:${owner}`),
    "confirmation_required",
    "Preview this high-impact change and confirm it through the owner's editor before committing."
  );
  requireThat(
    changes.worldId === world &&
      changes.actor === actor &&
      changes.expectedVersion === version &&
      changes.operationId === operation.id,
    "operation_context",
    "The evaluated operation must retain its authenticated request context."
  );
  return publishChanges(sql, owner, changes, {
    kind: operation.kind,
    version: operation.version,
    parameters: operation.parameters,
    hash,
    reads: operation.reads,
  });
}

export class CommitRepository {
  constructor(private readonly database: Database) {}
  async commit(
    world: string,
    owner: string,
    operation: PreparedOperation,
    actor = `user:${owner}`
  ): Promise<OperationRecord> {
    const hash =
      operation.requestHash ??
      contentHash({
        kind: operation.kind,
        version: operation.version,
        parameters: operation.parameters,
        expectedVersion: operation.expectedVersion,
        scope: operation.reads.scope,
      });
    return this.database.transaction(async (sql) => {
      const version = await ownedVersion(sql, world, owner, true);
      const existing = await existingOperation(sql, world, operation.id, hash);
      if (existing) return existing;
      return executeOperation(sql, world, owner, operation, version, hash, actor);
    });
  }
}
