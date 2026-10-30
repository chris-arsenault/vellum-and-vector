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
  private insert: ReturnType<Database["prepare"]>;
  private remove: ReturnType<Database["prepare"]>;
  private head: ReturnType<Database["prepare"]>;
  private next: ReturnType<Database["prepare"]>;
  constructor(
    private db: Database,
    private graph: number
  ) {
    this.insert = db.prepare("INSERT INTO contour_edges VALUES(?,?,?,?,?,?)");
    this.remove = db.prepare("DELETE FROM contour_edges WHERE graph=? AND ordinal=?");
    this.head = db.prepare(
      "SELECT ordinal,ax,ay,bx,by FROM contour_edges WHERE graph=? ORDER BY ordinal LIMIT 1"
    );
    // Ordinal order alone lets SQLite scan the graph once for every next-edge query.
    this.next = db.prepare(
      "SELECT ordinal,ax,ay,bx,by FROM contour_edges INDEXED BY contour_starts WHERE graph=? AND ax=? AND ay=? ORDER BY ordinal"
    );
  }
  add(a: ContourPoint, b: ContourPoint) {
    this.pending.push({ id: ++this.sequence, a, b });
    if (this.pending.length === EDGE_BATCH) this.flush();
  }
  first() {
    this.flush();
    return workingStorage("contour", "read", () => {
      try {
        this.head.bind([this.graph]);
        return this.head.step() ? decodeEdge(this.head.get({})) : undefined;
      } finally {
        this.head.reset();
      }
    });
  }
  outgoing([x, y]: ContourPoint) {
    this.flush();
    return workingStorage("contour", "read", () => {
      const edges: ContourEdge[] = [];
      try {
        this.next.bind([this.graph, x, y]);
        while (this.next.step()) edges.push(decodeEdge(this.next.get({})));
        return edges;
      } finally {
        this.next.reset();
      }
    });
  }
  consume(id: number) {
    workingStorage("contour", "write", () => {
      if (!this.consumed) this.db.exec(`SAVEPOINT contour_walk_${this.graph}`);
      this.consumed++;
      this.execute(this.remove, [this.graph, id]);
      if (this.consumed === EDGE_BATCH) this.finishWalk();
    });
  }
  close() {
    this.pending = [];
    workingStorage("contour", "write", () => {
      try {
        this.finishWalk();
        this.db.exec({ sql: "DELETE FROM contour_edges WHERE graph=?", bind: [this.graph] });
      } finally {
        for (const statement of [this.insert, this.remove, this.head, this.next])
          statement.finalize();
      }
    });
  }
  private finishWalk() {
    if (!this.consumed) return;
    this.db.exec(`RELEASE contour_walk_${this.graph}`);
    this.consumed = 0;
  }
  private execute(statement: ReturnType<Database["prepare"]>, values: number[]) {
    try {
      statement.bind(values).step();
    } finally {
      statement.reset();
    }
  }
  private flush() {
    if (!this.pending.length) return;
    workingStorage("contour", "write", () => {
      this.db.exec("SAVEPOINT contour_batch");
      try {
        for (const edge of this.pending)
          this.execute(this.insert, [this.graph, edge.id, ...edge.a, ...edge.b]);
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
