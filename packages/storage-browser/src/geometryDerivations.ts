import type { Database } from "@sqlite.org/sqlite-wasm";
import type { Geometry, Position } from "geojson";
import { rectangle, requireThat, type Bounds } from "@atlas/domain";
import type { GeometryKernel } from "./geometryKernel";
import { boundarySegments } from "./boundarySegments";
import { ByteCache } from "./byteCache";

/** Storage pieces retain original edges; their endpoints never introduce geographic cuts. */
const boundaryPartSegments = 256;
/** These are storage partitions and display products; canonical feature geometry is unchanged. */
const geometryPieceCoordinates = 4096;

/** Every derived product of a stored geometry row (boundary parts, spatial pieces, overviews)
 * is prepared here, lazily, keyed by the immutable geometry id. Writes never derive. */
export const displayGeometryCacheBytes = 16 * 1024 * 1024;
export class GeometryDerivations {
  private shown = new ByteCache<string, Geometry>(displayGeometryCacheBytes);
  constructor(
    private db: Database,
    private kernel: GeometryKernel
  ) {}
  ensureBoundaries(geometryId: number, precision: number, shape?: Geometry) {
    if (
      this.db.selectValue("SELECT 1 FROM geometry_boundary_ready WHERE geometry_id=?", [geometryId])
    )
      return;
    this.db.savepoint(() => this.prepareBoundaries(geometryId, precision, shape));
  }
  private prepareBoundaries(geometryId: number, precision: number, shape?: Geometry) {
    const db = this.db,
      kernel = this.kernel;
    if (!shape) shape = kernel.decode(this.stored(geometryId));
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
  *boundaryWindow(geometryId: number, b: Bounds) {
    const statement = this.db.prepare(`SELECT p.part_id,p.data FROM geometry_boundaries p
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
  private stored(geometryId: number) {
    const bytes = this.db.selectValue("SELECT data FROM geometry_values WHERE geometry_id=?", [
      geometryId,
    ]);
    requireThat(bytes instanceof Uint8Array, "stored_geometry", "Stored geometry is unavailable.");
    return bytes;
  }
  ensurePieces(id: number, precision: number) {
    if (this.db.selectValue("SELECT 1 FROM geometry_piece_ready WHERE geometry_id=?", [id])) return;
    this.db.savepoint(() => this.preparePieces(id, precision));
  }
  private preparePieces(id: number, precision: number) {
    const db = this.db,
      kernel = this.kernel;
    kernel.withBinary(this.stored(id), (geometry) => {
      this.partition(geometry, precision, (part) => {
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
        this.writeOverviews(id, geometry);
    });
    db.exec({ sql: "INSERT INTO geometry_piece_ready VALUES(?)", bind: [id] });
  }
  private partition(geometry: number, precision: number, emit: (part: number) => void) {
    const kernel = this.kernel,
      g = kernel.native;
    if (g.GEOSGeomTypeId(geometry) === 7) {
      eachGeometry(kernel, geometry, (part) => this.partition(part, precision, emit));
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
      kernel.withShape(rectangle(box), precision, (mask) => {
        const part = g.GEOSIntersectionPrec(geometry, mask, precision);
        requireThat(part, "geometry_partition", "Could not partition geographic geometry.");
        try {
          if (!g.GEOSisEmpty(part)) this.partition(part, precision, emit);
        } finally {
          g.GEOSGeom_destroy(part);
        }
      });
    }
  }
  private writeOverviews(id: number, geometry: number) {
    const kernel = this.kernel,
      g = kernel.native,
      b = kernel.bounds(geometry),
      span = Math.max(b[2] - b[0], b[3] - b[1]);
    const first = 2 ** Math.floor(Math.log2(span / 2048));
    for (let tolerance = first; tolerance < span; tolerance *= 4) {
      const simplified = g.GEOSTopologyPreserveSimplify(geometry, tolerance);
      requireThat(simplified, "display_geometry", "Could not prepare geographic overview.");
      try {
        this.db.exec({
          sql: "INSERT INTO geometry_overviews VALUES(?,?,?)",
          bind: [id, tolerance, kernel.binary(simplified)],
        });
      } finally {
        g.GEOSGeom_destroy(simplified);
      }
    }
  }
  pieceMatches(id: number, bounds: Bounds, target: number) {
    for (const row of this.pieces(id, bounds))
      if (this.kernel.matches(`piece:${row.id}`, row.bytes, target, "intersects")) return true;
    return false;
  }
  private overview(id: number, tolerance: number) {
    if (!(tolerance > 0)) return undefined;
    const bytes = this.db.selectValue(
      "SELECT data FROM geometry_overviews WHERE geometry_id=? AND tolerance<=? ORDER BY tolerance DESC LIMIT 1",
      [id, tolerance]
    );
    return bytes instanceof Uint8Array ? bytes : undefined;
  }
  /** The whole geometry at a display tolerance, for features that fit inside the window. */
  whole(id: number, precision: number, tolerance = 0): Geometry {
    const key = `${id}:${tolerance}`;
    const cached = this.shown.get(key);
    if (cached) return cached;
    const overview = this.overview(id, tolerance);
    const geometry = this.kernel.withBinary(overview ?? this.stored(id), (source) =>
      displayPart(this.kernel, source, overview ? 0 : tolerance)
    );
    void precision;
    this.shown.set(key, geometry, JSON.stringify(geometry).length * 2);
    return geometry;
  }
  window(id: number, bounds: Bounds, precision: number, tolerance = 0): Geometry | null {
    const overview = this.overview(id, tolerance);
    const inputs = overview ? [{ id: -id, bytes: overview }] : this.pieces(id, bounds);
    return this.clippedWindow(inputs, bounds, precision, tolerance);
  }
  private *pieces(id: number, b: Bounds) {
    const statement = this.db.prepare(`SELECT p.piece_id,p.data FROM geometry_pieces p
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
  private clippedWindow(
    inputs: Iterable<{ bytes: Uint8Array }>,
    bounds: Bounds,
    precision: number,
    tolerance: number
  ): Geometry | null {
    const kernel = this.kernel,
      g = kernel.native;
    return kernel.withShape(rectangle(bounds), precision, (mask) => {
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
        const geometries = [...combined.values()].map((part) =>
          displayPart(kernel, part, tolerance)
        );
        return geometries.length > 1
          ? { type: "GeometryCollection", geometries }
          : (geometries[0] ?? null);
      } finally {
        for (const part of combined.values()) g.GEOSGeom_destroy(part);
      }
    });
  }
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
