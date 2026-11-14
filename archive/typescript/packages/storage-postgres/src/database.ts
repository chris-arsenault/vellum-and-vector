import { readFile } from "node:fs/promises";
import type { Pool, PoolClient, QueryResultRow } from "pg";

/** A map adapter needs only this SQL capability; it receives no generation-store handle. */
export interface SqlReader {
  query<Row extends QueryResultRow = QueryResultRow>(
    sql: string,
    values?: unknown[]
  ): Promise<{ rows: Row[] }>;
}
export async function initializeMapSchema(database: SqlReader) {
  await database.query(await readFile(new URL("./map.sql", import.meta.url), "utf8"));
}
export async function initializeGenerationSchema(database: SqlReader) {
  await database.query(await readFile(new URL("./generation.sql", import.meta.url), "utf8"));
}
export async function transaction<T>(
  pool: Pool,
  action: (client: PoolClient) => Promise<T>
): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const result = await action(client);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}
