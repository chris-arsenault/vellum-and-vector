import {
  requireThat,
  geometrySchema,
  type Impact,
  type ObjectKind,
  type ParameterValues,
  type RevisionReference,
  type Scalar,
} from "@atlas/domain";
import type { Geometry } from "geojson";
import { Database, insertRows, integer, ownedVersion, type Sql } from "./database";
import type { PageRequest } from "./spatialRows";

export interface OperationRecord {
  worldId: string;
  operationId: string;
  version: number;
  beforeVersion: number;
  actor: string;
  kind: string;
  requestHash: string;
  commandVersion: number;
  impact: Impact;
  at: string;
}
export interface ObjectChange {
  kind: ObjectKind;
  id: string;
  beforeRevision: string | null;
  afterRevision: string | null;
}
export interface OperationInput {
  record: Omit<OperationRecord, "at">;
  parameters: ParameterValues;
  reads: (RevisionReference & { role: string })[];
  scopes: { role: "read" | "write"; spaceId: string; footprint: Geometry }[];
  changes: ObjectChange[];
  worldSettingsChanged: boolean;
}
interface OperationRow {
  world_id: string;
  operation_id: string;
  version: string;
  before_version: string;
  actor: string;
  kind: string;
  request_hash: string;
  command_version: number;
  created_at: Date;
  features: string[];
  areas: string[];
  layers: string[];
  invalidations: string[];
  high_impact: boolean;
}
const operationColumns = `world_id,operation_id,version,before_version,actor,kind,request_hash,command_version,created_at,
  (impact).features,(impact).areas,(impact).layers,(impact).invalidations,(impact).high_impact`;

async function operationSources(sql: Sql, world: string, id: string) {
  const reads = await sql.query<{
    kind: ObjectKind;
    object_id: string;
    revision_id: string;
    version: string;
    role: string;
  }>(
    "SELECT * FROM atlas_operation_inputs WHERE world_id=$1 AND operation_id=$2 ORDER BY ordinal",
    [world, id]
  );
  const scopes = await sql.query<{ role: "read" | "write"; space_id: string; footprint: string }>(
    "SELECT role,space_id,ST_AsGeoJSON(footprint,15) AS footprint FROM atlas_operation_scopes WHERE world_id=$1 AND operation_id=$2 ORDER BY ordinal",
    [world, id]
  );
  const metadata = await sql.query<{ before_version: string; after_version: string }>(
    "SELECT before_version,after_version FROM atlas_operation_world_changes WHERE world_id=$1 AND operation_id=$2",
    [world, id]
  );
  return {
    reads: reads.rows.map((row) => ({
      kind: row.kind,
      id: row.object_id,
      revisionId: row.revision_id,
      version: integer(row.version),
      role: row.role,
    })),
    scopes: scopes.rows.map((row) => ({
      role: row.role,
      spaceId: row.space_id,
      footprint: geometrySchema.parse(JSON.parse(row.footprint)),
    })),
    worldSettings: metadata.rowCount
      ? {
          beforeVersion: integer(metadata.rows[0].before_version),
          afterVersion: integer(metadata.rows[0].after_version),
        }
      : null,
  };
}

function operationRecord(row: OperationRow): OperationRecord {
  return {
    worldId: row.world_id,
    operationId: row.operation_id,
    version: integer(row.version),
    beforeVersion: integer(row.before_version),
    actor: row.actor,
    kind: row.kind,
    requestHash: row.request_hash,
    commandVersion: row.command_version,
    at: row.created_at.toISOString(),
    impact: {
      features: row.features,
      areas: row.areas,
      layers: row.layers,
      invalidations: row.invalidations,
      highImpact: row.high_impact,
    },
  };
}

export async function existingOperation(
  sql: Sql,
  world: string,
  id: string,
  requestHash: string
): Promise<OperationRecord | null> {
  const result = await sql.query<OperationRow>(
    `SELECT ${operationColumns} FROM atlas_operations WHERE world_id=$1 AND operation_id=$2 AND sealed`,
    [world, id]
  );
  if (!result.rowCount) return null;
  requireThat(
    result.rows[0].request_hash === requestHash,
    "idempotency_conflict",
    "An operation identity cannot be reused with different inputs."
  );
  return operationRecord(result.rows[0]);
}

export async function writeOperation(sql: Sql, input: OperationInput): Promise<void> {
  const r = input.record,
    i = r.impact;
  await sql.query(
    `INSERT INTO atlas_operations(world_id,operation_id,version,before_version,actor,kind,request_hash,impact,command_version,sealed)
    VALUES($1,$2,$3,$4,$5,$6,$7,ROW($8::uuid[],$9::uuid[],$10::text[],$11::text[],$12)::atlas_impact,$13,false)`,
    [
      r.worldId,
      r.operationId,
      r.version,
      r.beforeVersion,
      r.actor,
      r.kind,
      r.requestHash,
      i.features,
      i.areas,
      i.layers,
      i.invalidations,
      i.highImpact,
      r.commandVersion,
    ]
  );
  await insertRows(
    sql,
    "atlas_operation_settings",
    ["world_id", "operation_id", "name", "kind", "text_value", "number_value", "boolean_value"],
    Object.entries(compactSettings(input.parameters)).map(([name, value]) => [
      r.worldId,
      r.operationId,
      name,
      value === null ? "null" : typeof value === "string" ? "text" : typeof value,
      typeof value === "string" ? value : null,
      typeof value === "number" ? value : null,
      typeof value === "boolean" ? value : null,
    ])
  );
  await writeOperationRows(sql, input);
  await sql.query("UPDATE atlas_operations SET sealed=true WHERE world_id=$1 AND operation_id=$2", [
    r.worldId,
    r.operationId,
  ]);
}

// Geometry, channel samples and authored object records already live in the
// immutable revisions referenced by operation_changes. History keeps scalar
// command settings here instead of storing those payloads a second time as rows.
function compactSettings(parameters: ParameterValues): Record<string, Scalar> {
  return Object.fromEntries(
    Object.entries(parameters).filter(
      (entry): entry is [string, Scalar] => entry[1] === null || typeof entry[1] !== "object"
    )
  );
}

async function writeOperationRows(sql: Sql, input: OperationInput): Promise<void> {
  const r = input.record;
  await insertRows(
    sql,
    "atlas_operation_inputs",
    ["world_id", "operation_id", "ordinal", "role", "kind", "object_id", "revision_id", "version"],
    input.reads.map((read, n) => [
      r.worldId,
      r.operationId,
      n,
      read.role,
      read.kind,
      read.id,
      read.revisionId,
      read.version,
    ])
  );
  await insertRows(
    sql,
    "atlas_operation_changes",
    [
      "world_id",
      "operation_id",
      "ordinal",
      "kind",
      "object_id",
      "before_revision",
      "after_revision",
    ],
    input.changes.map((change, n) => [
      r.worldId,
      r.operationId,
      n,
      change.kind,
      change.id,
      change.beforeRevision,
      change.afterRevision,
    ])
  );
  await insertRows(
    sql,
    "atlas_operation_scopes",
    ["world_id", "operation_id", "ordinal", "role", "space_id", "footprint"],
    input.scopes.map((scope, n) => [
      r.worldId,
      r.operationId,
      n,
      scope.role,
      scope.spaceId,
      JSON.stringify(geometrySchema.parse(scope.footprint)),
    ]),
    ["footprint"]
  );
  if (input.worldSettingsChanged)
    await sql.query("INSERT INTO atlas_operation_world_changes VALUES($1,$2,$3,$4)", [
      r.worldId,
      r.operationId,
      r.beforeVersion,
      r.version,
    ]);
}

export class OperationRepository {
  constructor(private readonly database: Database) {}

  async history(
    world: string,
    owner: string,
    page: PageRequest
  ): Promise<{ items: OperationRecord[]; total: number; nextOffset: number | null }> {
    requireThat(
      Number.isSafeInteger(page.offset) &&
        page.offset >= 0 &&
        Number.isSafeInteger(page.limit) &&
        page.limit > 0,
      "invalid_page",
      "History requires a valid page."
    );
    return this.database.transaction(async (sql) => {
      await ownedVersion(sql, world, owner);
      const rows = await sql.query<OperationRow>(
        `SELECT ${operationColumns} FROM atlas_operations WHERE world_id=$1 AND sealed ORDER BY version DESC OFFSET $2 LIMIT $3`,
        [world, page.offset, page.limit]
      );
      const count = await sql.query<{ total: string }>(
        "SELECT count(*) AS total FROM atlas_operations WHERE world_id=$1 AND sealed",
        [world]
      );
      const total = integer(count.rows[0].total),
        items = rows.rows.map(operationRecord);
      return {
        items,
        total,
        nextOffset: page.offset + items.length < total ? page.offset + items.length : null,
      };
    }, true);
  }

  async inspect(world: string, owner: string, id: string) {
    return this.database.transaction(async (sql) => {
      await ownedVersion(sql, world, owner);
      const rows = await sql.query<OperationRow>(
        `SELECT ${operationColumns} FROM atlas_operations WHERE world_id=$1 AND operation_id=$2 AND sealed`,
        [world, id]
      );
      requireThat(rows.rowCount === 1, "not_found", "Operation not found.");
      const values = await sql.query<{
        name: string;
        kind: string;
        text_value: string | null;
        number_value: number | null;
        boolean_value: boolean | null;
      }>(
        "SELECT * FROM atlas_operation_settings WHERE world_id=$1 AND operation_id=$2 ORDER BY name",
        [world, id]
      );
      const parameters = Object.fromEntries(
        values.rows.map((r) => [
          r.name,
          r.kind === "text"
            ? r.text_value
            : r.kind === "number"
              ? r.number_value
              : r.kind === "boolean"
                ? r.boolean_value
                : null,
        ])
      );
      const changes = await sql.query<{
        kind: ObjectKind;
        object_id: string;
        before_revision: string | null;
        after_revision: string | null;
      }>(
        "SELECT * FROM atlas_operation_changes WHERE world_id=$1 AND operation_id=$2 ORDER BY ordinal",
        [world, id]
      );
      return {
        record: operationRecord(rows.rows[0]),
        ...(await operationSources(sql, world, id)),
        parameters,
        changes: changes.rows.map((row) => ({
          kind: row.kind,
          id: row.object_id,
          beforeRevision: row.before_revision,
          afterRevision: row.after_revision,
        })),
      };
    }, true);
  }
}
