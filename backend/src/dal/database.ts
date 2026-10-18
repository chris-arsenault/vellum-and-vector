import { Pool, type PoolClient, type QueryResult, type QueryResultRow, type Client } from "pg";
import { requireThat, type ObjectKind, type RevisionReference } from "@atlas/domain";

export interface Sql {
  query<T extends QueryResultRow = QueryResultRow>(
    text: string,
    values?: unknown[]
  ): Promise<QueryResult<T>>;
}
export class Database {
  constructor(readonly source: Pool | Client) {}

  async transaction<T>(work: (sql: Sql) => Promise<T>, readOnly = false): Promise<T> {
    const connection = this.source instanceof Pool ? await this.source.connect() : this.source;
    try {
      await connection.query(
        readOnly ? "BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY" : "BEGIN"
      );
      const result = await work(connection);
      await connection.query("COMMIT");
      return result;
    } catch (error) {
      try {
        await connection.query("ROLLBACK");
      } catch (rollbackError) {
        throw new AggregateError(
          [error, rollbackError],
          "Transaction failed and rollback also failed"
        );
      }
      throw error;
    } finally {
      if (this.source instanceof Pool) (connection as PoolClient).release();
    }
  }
}

export async function ownedVersion(
  sql: Sql,
  worldId: string,
  owner: string,
  lock = false
): Promise<number> {
  const result = await sql.query<{ version: string }>(
    `SELECT version FROM atlas_worlds WHERE id=$1 AND owner=$2${lock ? " FOR UPDATE" : ""}`,
    [worldId, owner]
  );
  requireThat(result.rowCount === 1, "not_found", "World not found.");
  return integer(result.rows[0].version);
}

export function integer(value: number | string): number {
  const result = Number(value);
  requireThat(
    Number.isSafeInteger(result),
    "invalid_integer",
    "Stored integer is outside the supported exact range."
  );
  return result;
}

export function sqlIdentifier(name: string): string {
  requireThat(
    /^[a-z_]+$/.test(name),
    "invalid_sql_identifier",
    "SQL identifiers must be static names."
  );
  return `"${name}"`;
}

export function asRevision(
  kind: ObjectKind,
  row: { id: string; revision_id: string; valid_from: string | number }
): RevisionReference {
  return { kind, id: row.id, revisionId: row.revision_id, version: integer(row.valid_from) };
}

export async function insertRows(
  sql: Sql,
  table: string,
  columns: readonly string[],
  rows: unknown[][],
  geometryColumns: readonly string[] = []
): Promise<void> {
  if (rows.length === 0) return;
  requireThat(
    columns.length > 0 && rows.every((row) => row.length === columns.length),
    "invalid_sql_rows",
    "Batch rows must match declared columns."
  );
  const batchSize = Math.floor(65535 / columns.length);
  for (let start = 0; start < rows.length; start += batchSize) {
    const batch = rows.slice(start, start + batchSize);
    const placeholders = batch.map(
      (_row, i) =>
        `(${columns
          .map((column, j) => {
            const parameter = `$${i * columns.length + j + 1}`;
            return geometryColumns.includes(column)
              ? `ST_SetSRID(ST_GeomFromGeoJSON(${parameter}::text),0)`
              : parameter;
          })
          .join(",")})`
    );
    await sql.query(
      `INSERT INTO ${sqlIdentifier(table)} (${columns.map(sqlIdentifier).join(",")}) VALUES ${placeholders.join(",")}`,
      batch.flat()
    );
  }
}

export async function registerObjects(
  sql: Sql,
  scope: string,
  objects: { id: string; kind: string }[]
): Promise<void> {
  if (objects.length === 0) return;
  await sql.query(
    `INSERT INTO atlas_objects(scope_id,id,kind)
    SELECT $1,unnest($2::uuid[]),unnest($3::text[]) ON CONFLICT(scope_id,id) DO NOTHING`,
    [scope, objects.map((o) => o.id), objects.map((o) => o.kind)]
  );
  const kinds = new Map(objects.map((object) => [object.id, object.kind]));
  requireThat(
    objects.every((object) => kinds.get(object.id) === object.kind),
    "identity_kind_conflict",
    "An identity cannot have competing object kinds."
  );
  const stored = await sql.query<{ id: string; kind: string }>(
    "SELECT id,kind FROM atlas_objects WHERE scope_id=$1 AND id=ANY($2::uuid[])",
    [scope, [...kinds.keys()]]
  );
  requireThat(
    stored.rows.every((object) => kinds.get(object.id) === object.kind),
    "identity_kind_conflict",
    "An existing identity belongs to a different object kind."
  );
}
