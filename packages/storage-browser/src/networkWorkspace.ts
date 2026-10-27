import type { Database } from "@sqlite.org/sqlite-wasm";
import type { NetworkNode, NetworkReach, NetworkWorkspace, ReachSelection } from "@atlas/domain";
import { Encoder } from "cbor-x";
import { workingStorage } from "./workingStorage";

/** Connected graph records share identities with features; coordinates stay in worker storage. */
export class SqliteNetworkWorkspace implements NetworkWorkspace {
  private codec = new Encoder({ structuredClone: true, useRecords: false });
  constructor(
    private db: Database,
    private table: "working_networks" | "source_networks" = "working_networks"
  ) {
    db.exec(`CREATE TABLE IF NOT EXISTS ${table}(
      ordinal INTEGER PRIMARY KEY AUTOINCREMENT,kind TEXT NOT NULL,id TEXT NOT NULL,
      feature_id TEXT,start_id TEXT,end_id TEXT,data BLOB NOT NULL,UNIQUE(kind,id));
      CREATE INDEX IF NOT EXISTS ${table}_feature ON ${table}(feature_id);
      CREATE INDEX IF NOT EXISTS ${table}_start ON ${table}(start_id);
      CREATE INDEX IF NOT EXISTS ${table}_end ON ${table}(end_id);`);
  }
  node(id: string) {
    return this.get<NetworkNode>("node", id);
  }
  reach(id: string) {
    return this.get<NetworkReach>("reach", id);
  }
  nodes() {
    return this.values<NetworkNode>("node");
  }
  reaches(selection: ReachSelection = {}) {
    return this.values<NetworkReach>("reach", selection);
  }
  putNode(node: NetworkNode) {
    this.put("node", node, null, null, null);
  }
  putReach(reach: NetworkReach) {
    this.put("reach", reach, reach.featureId, reach.start, reach.end);
  }
  removeReach(id: string) {
    workingStorage("network", "write", () =>
      this.db.exec({ sql: `DELETE FROM ${this.table} WHERE kind='reach' AND id=?`, bind: [id] })
    );
  }
  private get<T>(kind: string, id: string): T | undefined {
    return workingStorage("network", "read", () => {
      const bytes = this.db.selectValue(`SELECT data FROM ${this.table} WHERE kind=? AND id=?`, [
        kind,
        id,
      ]);
      return bytes === undefined ? undefined : (this.codec.decode(bytes as Uint8Array) as T);
    });
  }
  private put(
    kind: string,
    value: NetworkNode | NetworkReach,
    feature: string | null,
    start: string | null,
    end: string | null
  ) {
    workingStorage("network", "write", () =>
      this.db.exec({
        sql: `INSERT INTO ${this.table}(kind,id,feature_id,start_id,end_id,data) VALUES(?,?,?,?,?,?)
        ON CONFLICT(kind,id) DO UPDATE SET feature_id=excluded.feature_id,start_id=excluded.start_id,
        end_id=excluded.end_id,data=excluded.data`,
        bind: [kind, value.id, feature, start, end, this.codec.encode(value)],
      })
    );
  }
  private *values<T>(kind: string, selection: ReachSelection = {}) {
    let after = 0;
    for (;;) {
      const rows = workingStorage("network", "read", () =>
        this.db.selectObjects(
          `SELECT ordinal,id FROM ${this.table} WHERE kind=? AND ordinal>?
        AND (? IS NULL OR feature_id=?) AND (? IS NULL OR start_id=? OR end_id=?) ORDER BY ordinal LIMIT 64`,
          [
            kind,
            after,
            selection.featureId ?? null,
            selection.featureId ?? null,
            selection.nodeId ?? null,
            selection.nodeId ?? null,
            selection.nodeId ?? null,
          ]
        )
      );
      if (!rows.length) return;
      for (const row of rows) {
        after = Number(row.ordinal);
        const value = this.get<T>(kind, String(row.id));
        if (value) yield value;
      }
    }
  }
}
