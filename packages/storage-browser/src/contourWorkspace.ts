import type { Database } from "@sqlite.org/sqlite-wasm";
import type { ContourEdge, ContourEdges, ContourPoint, ContourWorkspace } from "@atlas/domain";
import { workingStorage } from "./workingStorage";

// Batches amortize SQLite commits; they do not limit contour coverage or precision.
const EDGE_BATCH = 256;
export class SqliteContourWorkspace implements ContourWorkspace {
  private sequence = 0;
  constructor(private readonly db: Database) {
    workingStorage("contour", "write", () =>
      db.exec(`
      CREATE TABLE IF NOT EXISTS contour_edges(
        graph INTEGER NOT NULL, ordinal INTEGER NOT NULL,
        ax REAL NOT NULL, ay REAL NOT NULL, bx REAL NOT NULL, by REAL NOT NULL,
        PRIMARY KEY(graph,ordinal)
      ) WITHOUT ROWID;
      CREATE INDEX IF NOT EXISTS contour_starts ON contour_edges(graph,ax,ay,ordinal);
    `)
    );
  }
  open() {
    return new SqliteContourEdges(this.db, ++this.sequence);
  }
}
class SqliteContourEdges implements ContourEdges {
  private sequence = 0;
  private pending: ContourEdge[] = [];
  private consumed = 0;
  constructor(
    private db: Database,
    private graph: number
  ) {}
  add(a: ContourPoint, b: ContourPoint) {
    this.pending.push({ id: ++this.sequence, a, b });
    if (this.pending.length === EDGE_BATCH) this.flush();
  }
  first() {
    this.flush();
    return workingStorage("contour", "read", () => {
      const row = this.db.selectObject(
        "SELECT ordinal,ax,ay,bx,by FROM contour_edges WHERE graph=? ORDER BY ordinal LIMIT 1",
        [this.graph]
      );
      return row ? decodeEdge(row) : undefined;
    });
  }
  outgoing([x, y]: ContourPoint) {
    this.flush();
    return workingStorage("contour", "read", () =>
      this.db
        .selectObjects(
          "SELECT ordinal,ax,ay,bx,by FROM contour_edges WHERE graph=? AND ax=? AND ay=? ORDER BY ordinal",
          [this.graph, x, y]
        )
        .map(decodeEdge)
    );
  }
  consume(id: number) {
    workingStorage("contour", "write", () => {
      if (!this.consumed) this.db.exec(`SAVEPOINT contour_walk_${this.graph}`);
      this.consumed++;
      this.db.exec({
        sql: "DELETE FROM contour_edges WHERE graph=? AND ordinal=?",
        bind: [this.graph, id],
      });
      if (this.consumed === EDGE_BATCH) this.finishWalk();
    });
  }
  close() {
    this.pending = [];
    workingStorage("contour", "write", () => {
      this.finishWalk();
      this.db.exec({
        sql: "DELETE FROM contour_edges WHERE graph=?",
        bind: [this.graph],
      });
    });
  }
  private finishWalk() {
    if (!this.consumed) return;
    this.db.exec(`RELEASE contour_walk_${this.graph}`);
    this.consumed = 0;
  }
  private flush() {
    if (!this.pending.length) return;
    workingStorage("contour", "write", () => {
      this.db.exec("SAVEPOINT contour_batch");
      try {
        for (const edge of this.pending)
          this.db.exec({
            sql: "INSERT INTO contour_edges VALUES(?,?,?,?,?,?)",
            bind: [this.graph, edge.id, ...edge.a, ...edge.b],
          });
        this.db.exec("RELEASE contour_batch");
        this.pending = [];
      } catch (error) {
        this.db.exec("ROLLBACK TO contour_batch");
        this.db.exec("RELEASE contour_batch");
        throw error;
      }
    });
  }
}
function decodeEdge(row: Record<string, unknown>): ContourEdge {
  return {
    id: Number(row.ordinal),
    a: [Number(row.ax), Number(row.ay)],
    b: [Number(row.bx), Number(row.by)],
  };
}
