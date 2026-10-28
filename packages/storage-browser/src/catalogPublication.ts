import type { Database } from "@sqlite.org/sqlite-wasm";
import { requireThat, type CatalogChanges, type CatalogPublication } from "@atlas/domain";
import { Encoder } from "cbor-x";
import type { CatalogMutation } from "./catalogMutation";

/**
 * Session scratch in SQLite's file, never authoritative geography or resumable execution.
 * Batches are staged as CBOR so producer-encoded geometry stays bytes until the commit.
 */
export class PublicationStaging {
  private active = new Map<string, CatalogPublication>();
  private codec = new Encoder({ useRecords: false });
  constructor(
    private db: Database,
    private mutation: CatalogMutation
  ) {
    const file = db.selectValue("SELECT file FROM pragma_database_list WHERE name='main'");
    db.exec({
      sql: "ATTACH DATABASE ? AS publication_scratch",
      bind: [file ? `${file}.publication` : ":memory:"],
    });
    db.exec(`CREATE TABLE IF NOT EXISTS publication_scratch.batches (
      sequence INTEGER PRIMARY KEY, token TEXT NOT NULL, data BLOB NOT NULL);
      CREATE INDEX IF NOT EXISTS publication_scratch.batch_owner ON batches(token,sequence);
      DELETE FROM publication_scratch.batches;`);
  }
  begin(input: CatalogPublication) {
    const token = crypto.randomUUID();
    this.active.set(token, input);
    return token;
  }
  append(token: string, batch: CatalogChanges) {
    const input = this.require(token);
    requireThat(
      batch.worldId === input.worldId && batch.operationId === input.operationId,
      "publication_identity",
      "A batch belongs to its publication world and operation."
    );
    this.db.exec({
      sql: "INSERT INTO publication_scratch.batches(token,data) VALUES(?,?)",
      bind: [token, this.codec.encode(batch)],
    });
  }
  finish(token: string) {
    const input = this.require(token);
    try {
      return this.mutation.commit(
        input.worldId,
        input.operationId,
        this.batches(token, input),
        true
      );
    } finally {
      this.discard(token);
    }
  }
  discard(token: string) {
    this.db.exec({ sql: "DELETE FROM publication_scratch.batches WHERE token=?", bind: [token] });
    this.active.delete(token);
  }
  /** Drop every staged batch of an operation whose worker no longer exists. */
  abandon(operationId: string) {
    for (const [token, input] of [...this.active])
      if (input.operationId === operationId) this.discard(token);
  }
  private require(token: string) {
    const input = this.active.get(token);
    requireThat(input, "publication_missing", "This publication is no longer active.");
    return input;
  }
  private *batches(token: string, input: CatalogPublication): IterableIterator<CatalogChanges> {
    // Even an empty publication validates its pinned revision.
    yield { ...input, writes: [], removes: [], expected: [], resources: [] };
    let after = 0;
    for (;;) {
      const row = this.db.selectObject(
        "SELECT sequence,data FROM publication_scratch.batches WHERE token=? AND sequence>? ORDER BY sequence LIMIT 1",
        [token, after]
      );
      if (!row) return;
      after = Number(row.sequence);
      yield {
        ...(this.codec.decode(row.data as Uint8Array) as CatalogChanges),
        expectedWorldRevision: input.expectedWorldRevision,
      };
    }
  }
}
