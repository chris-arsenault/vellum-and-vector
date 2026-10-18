import {
  requireThat,
  assertAgentChangeSafety,
  type ChangeSet,
  type DomainSnapshot,
  type DomainWrite,
  type ReadRequirements,
  type World,
  type FactInvalidation,
  geometrySchema,
} from "@atlas/domain";
import { Database, ownedVersion, type Sql } from "./database";
import { CommitRepository, type PreparedOperation } from "./commits";
import { OperationRepository, existingOperation } from "./operations";
import { historicalWrites } from "./historicalWrites";
import { contentHash } from "./typedValues";
import { readWorldHeader } from "./worldHeader";

function metadata(world: World) {
  return {
    name: world.name,
    seed: world.seed,
    epochs: world.epochs,
    humanEras: world.humanEras ?? [],
  };
}
function validateUndoActor(
  actor: string,
  original: Awaited<ReturnType<OperationRepository["inspect"]>>
) {
  requireThat(
    !actor.startsWith("agent:") || original.record.actor === actor,
    "undo_actor",
    "An agent can undo only its own operations."
  );
  requireThat(
    original.record.kind !== "createWorld",
    "world_creation_undo",
    "World creation is retained as the root of its history."
  );
}
async function restoreMetadata(
  sql: Sql,
  world: string,
  current: number,
  settings: Awaited<ReturnType<OperationRepository["inspect"]>>["worldSettings"]
) {
  if (!settings) return undefined;
  const after = await readWorldHeader(sql, world, settings.afterVersion),
    latest = await readWorldHeader(sql, world, current);
  requireThat(
    contentHash(metadata(after)) === contentHash(metadata(latest)),
    "undo_conflict",
    "World settings changed after the selected operation."
  );
  return metadata(await readWorldHeader(sql, world, settings.beforeVersion));
}
function undoChanges(
  original: Awaited<ReturnType<OperationRepository["inspect"]>>,
  snapshot: DomainSnapshot,
  operationId: string,
  actor: string,
  writes: DomainWrite[],
  restore: ReturnType<typeof metadata> | undefined,
  invalidations: FactInvalidation[]
): ChangeSet {
  for (const change of original.changes)
    requireThat(
      (snapshot.revisions.find((r) => r.kind === change.kind && r.id === change.id)?.revisionId ??
        null) === change.afterRevision,
      "undo_conflict",
      "An affected object changed after the selected operation."
    );
  const changes: ChangeSet = {
    operationId,
    actor,
    worldId: snapshot.world.id,
    expectedVersion: snapshot.world.version,
    readSet: snapshot.revisions,
    writes,
    removes: original.changes
      .filter((c) => c.beforeRevision === null)
      .map((c) => ({ kind: c.kind, id: c.id })),
    worldMetadata: restore,
    invalidations,
    highImpact: original.record.impact.highImpact,
  };
  assertAgentChangeSafety(snapshot, changes);
  return changes;
}
export class UndoRepository {
  constructor(private readonly database: Database) {}
  async undo(
    world: string,
    owner: string,
    operationId: string,
    target: string,
    input: ReadRequirements,
    options: { actor?: string; confirmed?: boolean } = {}
  ) {
    const actor = options.actor ?? `user:${owner}`;
    const original = await new OperationRepository(this.database).inspect(world, owner, target);
    validateUndoActor(actor, original);
    const parameters = { operationId: target };
    const hash = contentHash({
      kind: "undo",
      version: 1,
      parameters,
      expectedVersion: input.scope.revision,
      scope: input.scope,
    });
    const previous = await this.database.transaction(async (sql) => {
      await ownedVersion(sql, world, owner);
      return existingOperation(sql, world, operationId, hash);
    }, true);
    if (previous) return previous;
    const prepared = await this.database.transaction(async (sql): Promise<PreparedOperation> => {
      const current = await ownedVersion(sql, world, owner);
      requireThat(
        current === input.scope.revision,
        "stale_version",
        "Reload the world before undoing an operation."
      );
      const changed = original.changes;
      const writes = await historicalWrites(
        sql,
        world,
        original.record.beforeVersion,
        changed.filter((c) => c.beforeRevision !== null)
      );
      const restore = await restoreMetadata(sql, world, current, original.worldSettings);
      const invalidations = await undoInvalidations(
        sql,
        world,
        original.record.version,
        operationId
      );
      const reads = {
        ...input,
        objects: [...input.objects, ...changed.map((c) => ({ kind: c.kind, ids: [c.id] }))],
      };
      return {
        id: operationId,
        kind: "undo",
        version: 1,
        expectedVersion: current,
        parameters,
        confirmed: options.confirmed,
        reads,
        evaluate(snapshot) {
          return undoChanges(
            original,
            snapshot,
            operationId,
            actor,
            writes,
            restore,
            invalidations
          );
        },
      };
    }, true);
    return new CommitRepository(this.database).commit(world, owner, prepared, actor);
  }
}
async function undoInvalidations(
  sql: Sql,
  world: string,
  version: number,
  cause: string
): Promise<FactInvalidation[]> {
  const rows = await sql.query<{
    fact: string;
    scope_kind: string;
    space_id: string | null;
    footprint: string | null;
  }>(
    "SELECT fact,scope_kind,space_id,ST_AsGeoJSON(footprint,15) AS footprint FROM atlas_invalidations WHERE world_id=$1 AND version=$2",
    [world, version]
  );
  return rows.rows.map((r) =>
    r.scope_kind === "world"
      ? { scope: "world", fact: r.fact, cause }
      : {
          scope: "spatial",
          fact: r.fact,
          cause,
          spaceId: r.space_id!,
          footprint: geometrySchema.parse(JSON.parse(r.footprint!)),
        }
  );
}
