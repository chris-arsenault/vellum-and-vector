import { PostgreSqlContainer } from "@testcontainers/postgresql";
import { Client } from "pg";
import { readdir, readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const directory = fileURLToPath(new URL("../../db/migrations/", import.meta.url));

function migrationFailure(name: string, rollback: boolean, error: unknown): Error {
  const detail =
    error !== null && typeof error === "object" && "detail" in error ? String(error.detail) : "";
  return new Error(
    `Migration ${rollback ? "rollback/" : ""}${name} failed: ${error instanceof Error ? error.message : String(error)} ${detail}`,
    { cause: error }
  );
}

export async function migrations(
  client: Client,
  rollback = false,
  through = Infinity
): Promise<void> {
  const names = (await readdir(directory))
    .filter((name) => name.endsWith(".sql") && Number(name.slice(0, 3)) <= through)
    .sort();
  for (const name of rollback ? names.reverse() : names) {
    const file = rollback ? `${directory}/rollback/${name}` : `${directory}/${name}`;
    try {
      await client.query(await readFile(file, "utf8"));
    } catch (error) {
      throw migrationFailure(name, rollback, error);
    }
  }
}

export async function testDatabase(through = Infinity) {
  const container = await new PostgreSqlContainer("postgis/postgis:16-3.5").start();
  const admin = new Client({ connectionString: container.getConnectionUri() });
  let client: Client | null = null;
  try {
    await admin.connect();
    await admin.query(
      "CREATE EXTENSION IF NOT EXISTS postgis; CREATE EXTENSION IF NOT EXISTS btree_gist"
    );
    await admin.query(
      "CREATE ROLE atlas_app LOGIN PASSWORD 'disposable-test'; GRANT USAGE,CREATE ON SCHEMA public TO atlas_app"
    );
    const uri = new URL(container.getConnectionUri());
    uri.username = "atlas_app";
    uri.password = "disposable-test";
    client = new Client({ connectionString: uri.toString() });
    await client.connect();
    await migrations(client, false, through);
    return {
      client,
      async close() {
        await client?.end();
        await admin.end();
        await container.stop();
      },
    };
  } catch (error) {
    await client?.end();
    await admin.end();
    await container.stop();
    throw error;
  }
}
