import type { Database } from "@sqlite.org/sqlite-wasm";
import type { Geometry } from "geojson";
import { rectangle, requireThat, type Bounds } from "@atlas/domain";
import type { GeometryKernel } from "./geometryKernel";

/** These are storage partitions and display products; canonical feature geometry is unchanged. */
const geometryPieceCoordinates = 4096;
export function writeGeometryPieces(
  db: Database,
  kernel: GeometryKernel,
  id: number,
  precision: number
) {
  if (db.selectValue("SELECT 1 FROM geometry_piece_ready WHERE geometry_id=?", [id])) return;
  db.savepoint(() => prepareGeometryPieces(db, kernel, id, precision));
}
function prepareGeometryPieces(
  db: Database,
  kernel: GeometryKernel,
  id: number,
  precision: number
) {
  const bytes = db.selectValue("SELECT data FROM geometry_values WHERE geometry_id=?", [id]);
  requireThat(bytes instanceof Uint8Array, "stored_geometry", "Stored geometry is unavailable.");
  kernel.withBinary(bytes, (geometry) => {
    partitionGeometry(kernel, geometry, precision, (part) => {
      const [x0, y0, x1, y1] = kernel.bounds(part);
      db.exec({
        sql: "INSERT INTO geometry_pieces(geometry_id,data) VALUES(?,?)",
        bind: [id, kernel.binary(part)],
      });
      db.exec({
        sql: "INSERT INTO geometry_piece_bounds VALUES(last_insert_rowid(),?,?,?,?)",
        bind: [x0, x1, y0, y1],
      });
    });
    if (kernel.native.GEOSGetNumCoordinates(geometry) > geometryPieceCoordinates)
      writeOverviews(db, kernel, id, geometry);
  });
  db.exec({ sql: "INSERT INTO geometry_piece_ready VALUES(?)", bind: [id] });
}
function partitionGeometry(
  kernel: GeometryKernel,
  geometry: number,
  precision: number,
  emit: (part: number) => void
) {
  const g = kernel.native;
  if (g.GEOSGeomTypeId(geometry) === 7) {
    eachGeometry(kernel, geometry, (part) => partitionGeometry(kernel, part, precision, emit));
    return;
  }
  const bounds = kernel.bounds(geometry),
    axis = bounds[2] - bounds[0] >= bounds[3] - bounds[1] ? 0 : 1;
  if (
    g.GEOSGetNumCoordinates(geometry) <= geometryPieceCoordinates ||
    bounds[axis + 2] - bounds[axis] <= precision * 4
  ) {
    emit(geometry);
    return;
  }
  const midpoint = (bounds[axis] + bounds[axis + 2]) / 2;
  for (const side of [0, 1]) {
    const box = [...bounds] as Bounds;
    box[axis + (side ? 0 : 2)] = midpoint;
    // Lines can have a zero-height or zero-width envelope. The clipping rectangle remains an area.
    for (let a = 0; a < 2; a++)
      if (box[a] === box[a + 2]) {
        box[a] -= precision;
        box[a + 2] += precision;
      }
    kernel.withGeometry(rectangle(box), precision, (mask) => {
      const part = g.GEOSIntersectionPrec(geometry, mask, precision);
      requireThat(part, "geometry_partition", "Could not partition geographic geometry.");
      try {
        if (!g.GEOSisEmpty(part)) partitionGeometry(kernel, part, precision, emit);
      } finally {
        g.GEOSGeom_destroy(part);
      }
    });
  }
}
function writeOverviews(db: Database, kernel: GeometryKernel, id: number, geometry: number) {
  const g = kernel.native,
    b = kernel.bounds(geometry),
    span = Math.max(b[2] - b[0], b[3] - b[1]);
  const first = 2 ** Math.floor(Math.log2(span / 2048));
  for (let tolerance = first; tolerance < span; tolerance *= 4) {
    const simplified = g.GEOSTopologyPreserveSimplify(geometry, tolerance);
    requireThat(simplified, "display_geometry", "Could not prepare geographic overview.");
    try {
      db.exec({
        sql: "INSERT INTO geometry_overviews VALUES(?,?,?)",
        bind: [id, tolerance, kernel.binary(simplified)],
      });
    } finally {
      g.GEOSGeom_destroy(simplified);
    }
  }
}
export function geometryPieceMatches(
  db: Database,
  kernel: GeometryKernel,
  id: number,
  bounds: Bounds,
  target: number
) {
  for (const row of pieces(db, id, bounds))
    if (kernel.matches(`piece:${row.id}`, row.bytes, target, "intersects")) return true;
  return false;
}
export function geometryWindow(
  db: Database,
  kernel: GeometryKernel,
  id: number,
  bounds: Bounds,
  precision: number,
  tolerance = 0
): Geometry | null {
  const overview =
    tolerance > 0
      ? db.selectValue(
          "SELECT data FROM geometry_overviews WHERE geometry_id=? AND tolerance<=? ORDER BY tolerance DESC LIMIT 1",
          [id, tolerance]
        )
      : undefined;
  const inputs =
    overview instanceof Uint8Array ? [{ id: -id, bytes: overview }] : pieces(db, id, bounds);
  return clippedWindow(kernel, inputs, bounds, precision, tolerance);
}
function* pieces(db: Database, id: number, b: Bounds) {
  const statement = db.prepare(`SELECT p.piece_id,p.data FROM geometry_pieces p
    JOIN geometry_piece_bounds b USING(piece_id) WHERE p.geometry_id=?
    AND b.min_x<=? AND b.max_x>=? AND b.min_y<=? AND b.max_y>=? ORDER BY p.piece_id`);
  try {
    statement.bind([id, b[2], b[0], b[3], b[1]]);
    while (statement.step()) {
      const row = statement.get({});
      yield { id: Number(row.piece_id), bytes: row.data as Uint8Array };
    }
  } finally {
    statement.finalize();
  }
}
function clippedWindow(
  kernel: GeometryKernel,
  inputs: Iterable<{ bytes: Uint8Array }>,
  bounds: Bounds,
  precision: number,
  tolerance: number
): Geometry | null {
  const g = kernel.native;
  return kernel.withGeometry(rectangle(bounds), precision, (mask) => {
    const combined = new Map<number, number>();
    try {
      for (const input of inputs)
        kernel.withBinary(input.bytes, (source) => {
          eachGeometry(kernel, source, (part) => {
            const clipped = g.GEOSIntersectionPrec(part, mask, precision);
            requireThat(clipped, "geometry_window", "Could not read geographic window.");
            try {
              eachGeometry(kernel, clipped, (piece) =>
                mergePiece(kernel, combined, piece, precision)
              );
            } finally {
              g.GEOSGeom_destroy(clipped);
            }
          });
        });
      const geometries = [...combined.values()].map((part) => displayPart(kernel, part, tolerance));
      return geometries.length > 1
        ? { type: "GeometryCollection", geometries }
        : (geometries[0] ?? null);
    } finally {
      for (const part of combined.values()) g.GEOSGeom_destroy(part);
    }
  });
}
/** GEOS binary overlays accept homogeneous inputs; clipping may produce mixed collections. */
function eachGeometry(kernel: GeometryKernel, geometry: number, visit: (part: number) => void) {
  const g = kernel.native;
  if (g.GEOSisEmpty(geometry)) return;
  if (g.GEOSGeomTypeId(geometry) !== 7) {
    visit(geometry);
    return;
  }
  for (let i = 0; i < g.GEOSGetNumGeometries(geometry); i++)
    eachGeometry(kernel, g.GEOSGetGeometryN(geometry, i), visit);
}
function mergePiece(
  kernel: GeometryKernel,
  combined: Map<number, number>,
  piece: number,
  precision: number
) {
  const g = kernel.native,
    dimension = g.GEOSGeom_getDimensions(piece),
    previous = combined.get(dimension);
  const merged = previous ? g.GEOSUnionPrec(previous, piece, precision) : g.GEOSGeom_clone(piece);
  requireThat(merged, "geometry_window", "Could not join geographic window pieces.");
  if (previous) g.GEOSGeom_destroy(previous);
  combined.set(dimension, merged);
}
function displayPart(kernel: GeometryKernel, geometry: number, tolerance: number) {
  if (!tolerance) return kernel.json(geometry);
  const simplified = kernel.native.GEOSTopologyPreserveSimplify(geometry, tolerance);
  requireThat(simplified, "display_geometry", "Could not prepare map window.");
  try {
    return kernel.json(simplified);
  } finally {
    kernel.native.GEOSGeom_destroy(simplified);
  }
}
