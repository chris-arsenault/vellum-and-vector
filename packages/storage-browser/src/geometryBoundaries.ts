import type { Database } from "@sqlite.org/sqlite-wasm";
import type { Geometry, Position } from "geojson";
import { requireThat, type Bounds } from "@atlas/domain";
import type { GeometryKernel } from "./geometryKernel";
import { boundarySegments } from "./boundarySegments";

/** Storage pieces retain original edges; their endpoints never introduce geographic cuts. */
const boundaryPartSegments = 256;
export function writeGeometryBoundaries(
  db: Database,
  kernel: GeometryKernel,
  geometryId: number,
  precision: number,
  shape?: Geometry
) {
  if (db.selectValue("SELECT 1 FROM geometry_boundary_ready WHERE geometry_id=?", [geometryId]))
    return;
  db.savepoint(() => prepareGeometryBoundaries(db, kernel, geometryId, precision, shape));
}
function prepareGeometryBoundaries(
  db: Database,
  kernel: GeometryKernel,
  geometryId: number,
  precision: number,
  shape?: Geometry
) {
  if (!shape) {
    const bytes = db.selectValue("SELECT data FROM geometry_values WHERE geometry_id=?", [
      geometryId,
    ]);
    requireThat(bytes instanceof Uint8Array, "stored_geometry", "Stored geometry is unavailable.");
    shape = kernel.decode(bytes);
  }
  let lines: Position[][] = [];
  const flush = () => {
    if (!lines.length) return;
    const encoded = kernel.encode({ type: "MultiLineString", coordinates: lines }, precision),
      [x0, y0, x1, y1] = encoded.bounds;
    db.exec({
      sql: "INSERT INTO geometry_boundaries(geometry_id,data) VALUES(?,?)",
      bind: [geometryId, encoded.bytes],
    });
    db.exec({
      sql: "INSERT INTO geometry_boundary_bounds VALUES(last_insert_rowid(),?,?,?,?)",
      bind: [x0, x1, y0, y1],
    });
    lines = [];
  };
  for (const { ax, ay, bx, by } of boundarySegments(shape)) {
    lines.push([
      [ax, ay],
      [bx, by],
    ]);
    if (lines.length === boundaryPartSegments) flush();
  }
  flush();
  db.exec({ sql: "INSERT INTO geometry_boundary_ready VALUES(?)", bind: [geometryId] });
}
export function* geometryBoundaryWindow(db: Database, geometryId: number, b: Bounds) {
  const statement = db.prepare(`SELECT p.part_id,p.data FROM geometry_boundaries p
    JOIN geometry_boundary_bounds b USING(part_id) WHERE p.geometry_id=?
    AND b.min_x<=? AND b.max_x>=? AND b.min_y<=? AND b.max_y>=? ORDER BY p.part_id`);
  try {
    statement.bind([geometryId, b[2], b[0], b[3], b[1]]);
    while (statement.step()) {
      const row = statement.get({});
      yield { partId: -Number(row.part_id), bytes: row.data as Uint8Array };
    }
  } finally {
    statement.finalize();
  }
}
