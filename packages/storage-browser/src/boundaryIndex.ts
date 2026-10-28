import type { Database } from "@sqlite.org/sqlite-wasm";
import type { Bounds, WorkspaceScope } from "@atlas/domain";
import { boundarySegments, type BoundarySegment } from "./boundarySegments";
import type { GeometryKernel } from "./geometryKernel";

const schema = `
CREATE TABLE IF NOT EXISTS boundary_sources (
  source_id INTEGER PRIMARY KEY,
  record_id INTEGER NOT NULL REFERENCES records_core(record_id) ON DELETE CASCADE,
  part_id INTEGER NOT NULL DEFAULT 0,
  world_id TEXT NOT NULL,space_id TEXT NOT NULL,area_id TEXT NOT NULL,
  geometry BLOB NOT NULL, UNIQUE(record_id,world_id,space_id,area_id,part_id)
);
CREATE TABLE IF NOT EXISTS boundary_segments (
  segment_id INTEGER PRIMARY KEY,
  source_id INTEGER NOT NULL REFERENCES boundary_sources(source_id) ON DELETE CASCADE,
  world_id TEXT NOT NULL,space_id TEXT NOT NULL,area_id TEXT NOT NULL,
  ax REAL NOT NULL,ay REAL NOT NULL,bx REAL NOT NULL,by REAL NOT NULL
);
CREATE INDEX IF NOT EXISTS boundary_source ON boundary_segments(source_id);
CREATE VIRTUAL TABLE IF NOT EXISTS boundary_bounds USING rtree(segment_id,min_x,max_x,min_y,max_y);
CREATE TRIGGER IF NOT EXISTS boundary_remove AFTER DELETE ON boundary_segments BEGIN
  DELETE FROM boundary_bounds WHERE segment_id=old.segment_id;
END;`;
const columns = "s.ax,s.ay,s.bx,s.by";
const scoped = "s.world_id=:world AND s.space_id=:space AND s.area_id=:area";
function bindings(scope: WorkspaceScope, extent: Bounds) {
  return {
    ":world": scope.worldId,
    ":space": scope.spaceId,
    ":area": scope.areaId,
    ":west": extent[0],
    ":south": extent[1],
    ":east": extent[2],
    ":north": extent[3],
  };
}
function segment(row: Record<string, unknown>): BoundarySegment {
  return { ax: Number(row.ax), ay: Number(row.ay), bx: Number(row.bx), by: Number(row.by) };
}
/** Raw linework, indexed per scope. Reads here are pure; BoundaryProjection installs sources. */
export class BoundaryIndex {
  constructor(
    private db: Database,
    private kernel: GeometryKernel
  ) {
    db.exec(schema);
  }
  refresh(recordId: number, scope: WorkspaceScope, bytes: Uint8Array, partId = 0) {
    if (
      this.db.selectValue(
        "SELECT geometry=? FROM boundary_sources WHERE record_id=? AND world_id=? AND space_id=? AND area_id=? AND part_id=?",
        [bytes, recordId, scope.worldId, scope.spaceId, scope.areaId, partId]
      ) === 1
    )
      return false;
    this.db.exec({
      sql: `INSERT INTO boundary_sources(record_id,world_id,space_id,area_id,geometry,part_id) VALUES(?,?,?,?,?,?)
        ON CONFLICT(record_id,world_id,space_id,area_id,part_id) DO UPDATE SET geometry=excluded.geometry`,
      bind: [recordId, scope.worldId, scope.spaceId, scope.areaId, bytes, partId],
    });
    const sourceId = this.db.selectValue(
      "SELECT source_id FROM boundary_sources WHERE record_id=? AND world_id=? AND space_id=? AND area_id=? AND part_id=?",
      [recordId, scope.worldId, scope.spaceId, scope.areaId, partId]
    )!;
    this.db.exec({ sql: "DELETE FROM boundary_segments WHERE source_id=?", bind: [sourceId] });
    const insert = this.db.prepare(
      "INSERT INTO boundary_segments(source_id,world_id,space_id,area_id,ax,ay,bx,by) VALUES(?,?,?,?,?,?,?,?)"
    );
    const bound = this.db.prepare(
      "INSERT INTO boundary_bounds VALUES(last_insert_rowid(),?,?,?,?)"
    );
    try {
      for (const s of boundarySegments(this.kernel.decode(bytes))) {
        insert
          .bind([sourceId, scope.worldId, scope.spaceId, scope.areaId, s.ax, s.ay, s.bx, s.by])
          .step();
        insert.reset();
        bound
          .bind([
            Math.min(s.ax, s.bx),
            Math.max(s.ax, s.bx),
            Math.min(s.ay, s.by),
            Math.max(s.ay, s.by),
          ])
          .step();
        bound.reset();
      }
    } finally {
      insert.finalize();
      bound.finalize();
    }
    return true;
  }
  remove(recordId: number, scope: WorkspaceScope) {
    this.db.exec({
      sql: "DELETE FROM boundary_sources WHERE record_id=? AND world_id=? AND space_id=? AND area_id=?",
      bind: [recordId, scope.worldId, scope.spaceId, scope.areaId],
    });
  }
  segments(scope: WorkspaceScope, extent: Bounds) {
    return this.db
      .selectObjects(
        `SELECT ${columns} FROM boundary_segments s JOIN boundary_bounds b USING(segment_id)
      WHERE ${scoped} AND b.min_x<=:east AND b.max_x>=:west AND b.min_y<=:north AND b.max_y>=:south`,
        bindings(scope, extent)
      )
      .map(segment);
  }
  /** The nearest crossing of the eastward ray from (x, y), searched only up to `east`. */
  nearest(scope: WorkspaceScope, x: number, y: number, east: number): BoundarySegment | null {
    const row = this.db.selectObject(
      `SELECT ${columns},s.ax+(:y-s.ay)*(s.bx-s.ax)/(s.by-s.ay) AS hit
      FROM boundary_segments s JOIN boundary_bounds b USING(segment_id)
      WHERE ${scoped} AND b.min_y<=:y AND b.max_y>=:y AND b.max_x>=:x AND b.min_x<=:east
      AND ((s.ay<=:y AND s.by>:y) OR (s.by<=:y AND s.ay>:y))
      AND hit>=:x AND hit<=:east ORDER BY hit LIMIT 1`,
      {
        ":world": scope.worldId,
        ":space": scope.spaceId,
        ":area": scope.areaId,
        ":x": x,
        ":y": y,
        ":east": east,
      }
    );
    return row ? segment(row) : null;
  }
  *inside(scope: WorkspaceScope, extent: Bounds) {
    const statement = this.db
      .prepare(`SELECT ${columns} FROM boundary_segments s JOIN boundary_bounds b USING(segment_id)
      WHERE ${scoped} AND b.min_x<=:east AND b.max_x>=:west AND b.min_y<=:north AND b.max_y>=:south
      ORDER BY min(s.ax,s.bx),s.segment_id`);
    try {
      statement.bind(bindings(scope, extent));
      while (statement.step()) yield segment(statement.get({}));
    } finally {
      statement.finalize();
    }
  }
}
