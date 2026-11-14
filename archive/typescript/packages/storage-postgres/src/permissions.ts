import { escapeIdentifier } from "pg";
import type { SqlReader } from "./database";

/** Provisioned reader credentials can query map products, never private generation inputs. */
export async function grantMapReader(database: SqlReader, role: string) {
  const identifier = escapeIdentifier(role);
  await database.query(`GRANT USAGE ON SCHEMA map TO ${identifier}`);
  await database.query(`GRANT SELECT ON ALL TABLES IN SCHEMA map TO ${identifier}`);
  await database.query(
    `ALTER DEFAULT PRIVILEGES IN SCHEMA map GRANT SELECT ON TABLES TO ${identifier}`
  );
  await database.query(`REVOKE ALL ON SCHEMA generation FROM ${identifier}`);
}
