import initGeos from "geos-wasm";
import type { Geometry } from "geojson";
import { requireThat, type Bounds } from "@atlas/domain";
import { ByteCache } from "./byteCache";

type Geos = Awaited<ReturnType<typeof initGeos>>;
let geosReady: ReturnType<typeof initGeos> | undefined;
interface Prepared {
  geometry: number;
  prepared: number;
}
export const preparedGeometryCacheBytes = 16 * 1024 * 1024;

export class GeometryKernel {
  private reader: number;
  private writer: number;
  private prepared: ByteCache<string, Prepared>;
  constructor(
    readonly native: Geos,
    cacheBytes = preparedGeometryCacheBytes
  ) {
    const geos = native;
    this.reader = geos.GEOSGeoJSONReader_create();
    this.writer = geos.GEOSGeoJSONWriter_create();
    this.prepared = new ByteCache(cacheBytes, (entry) => {
      geos.GEOSPreparedGeom_destroy(entry.prepared);
      geos.GEOSGeom_destroy(entry.geometry);
    });
    geos.GEOS_setWKBOutputDims(3);
  }
  static async create(cacheBytes = preparedGeometryCacheBytes) {
    return new GeometryKernel(await (geosReady ??= initGeos()), cacheBytes);
  }
  private get geos() {
    return this.native;
  }
  withGeometry<T>(value: Geometry, precision: number, work: (geometry: number) => T): T {
    const g = this.geos,
      text = new TextEncoder().encode(JSON.stringify(value));
    const buffer = g.Module._malloc(text.byteLength + 1);
    let raw = 0,
      geometry = 0;
    try {
      g.Module.HEAPU8.set(text, buffer);
      g.Module.HEAPU8[buffer + text.byteLength] = 0;
      raw = g.GEOSGeoJSONReader_readGeometry(this.reader, buffer);
      requireThat(raw && g.GEOSisValid(raw) === 1, "invalid_geometry", "Geometry must be valid.");
      geometry = g.GEOSGeom_setPrecision(raw, precision, 0);
      requireThat(
        geometry && g.GEOSisEmpty(geometry) === 0,
        "precision_collapse",
        "Geometry collapses at its declared precision."
      );
      return work(geometry);
    } finally {
      if (geometry) g.GEOSGeom_destroy(geometry);
      if (raw) g.GEOSGeom_destroy(raw);
      g.Module._free(buffer);
    }
  }
  encode(value: Geometry, precision: number) {
    return this.withGeometry(value, precision, (geometry) => ({
      bytes: this.binary(geometry),
      bounds: this.bounds(geometry),
    }));
  }
  canonical(value: Geometry, precision: number) {
    return this.withGeometry(value, precision, (geometry) => {
      return this.json(geometry);
    });
  }
  simplify(value: Geometry, precision: number, tolerance: number) {
    requireThat(
      Number.isFinite(tolerance) && tolerance >= 0,
      "display_tolerance",
      "Display tolerance is a nonnegative metre distance."
    );
    if (!tolerance) return value;
    return this.withGeometry(value, precision, (geometry) => {
      const result = this.geos.GEOSTopologyPreserveSimplify(geometry, tolerance);
      requireThat(result, "display_geometry", "Could not prepare map geometry.");
      try {
        return this.json(result);
      } finally {
        this.geos.GEOSGeom_destroy(result);
      }
    });
  }
  buffer(value: Geometry, distance: number, precision: number) {
    requireThat(Number.isFinite(distance), "invalid_distance", "Buffer distance must be finite.");
    const g = this.geos;
    return this.withGeometry(value, precision, (geometry) => {
      const result = g.GEOSBuffer(geometry, distance, 8);
      requireThat(result, "geometry_buffer", "Could not construct the geographic buffer.");
      try {
        return g.GEOSisEmpty(result) ? null : this.json(result);
      } finally {
        g.GEOSGeom_destroy(result);
      }
    });
  }
  binary(geometry: number) {
    const g = this.geos,
      size = g.Module._malloc(4);
    let data = 0;
    try {
      const type = g.GEOSGeomTypeId(geometry);
      // Precision reduction may rotate polygon rings. Stable bytes let metadata revisions
      // reuse their geometry; directed lines retain their supplied station order.
      if (type === 3 || type === 6)
        requireThat(
          g.GEOSNormalize(geometry) === 0,
          "geometry_normalize",
          "Could not normalize geometry."
        );
      data = g.GEOSGeomToWKB_buf(geometry, size);
      requireThat(data, "geometry_encoding", "Could not encode geometry.");
      return g.Module.HEAPU8.slice(data, data + g.Module.getValue(size, "i32"));
    } finally {
      if (data) g.GEOSFree(data);
      g.Module._free(size);
    }
  }
  private fromBinary(bytes: Uint8Array) {
    const g = this.geos,
      data = g.Module._malloc(bytes.byteLength);
    try {
      g.Module.HEAPU8.set(bytes, data);
      const geometry = g.GEOSGeomFromWKB_buf(data, bytes.byteLength);
      requireThat(geometry, "geometry_encoding", "Could not read stored geometry.");
      return geometry;
    } finally {
      g.Module._free(data);
    }
  }
  withBinary<T>(bytes: Uint8Array, work: (geometry: number) => T): T {
    const geometry = this.fromBinary(bytes);
    try {
      return work(geometry);
    } finally {
      this.geos.GEOSGeom_destroy(geometry);
    }
  }
  decode(bytes: Uint8Array): Geometry {
    const g = this.geos,
      geometry = this.fromBinary(bytes);
    try {
      return this.json(geometry);
    } finally {
      g.GEOSGeom_destroy(geometry);
    }
  }
  json(geometry: number): Geometry {
    const g = this.geos;
    const type = g.GEOSGeomTypeId(geometry);
    if (type === 3 || type === 6)
      requireThat(
        g.GEOSNormalize(geometry) === 0,
        "geometry_normalize",
        "Could not normalize geometry."
      );
    let text = 0;
    try {
      text = g.GEOSGeoJSONWriter_writeGeometry(this.writer, geometry, 0);
      requireThat(text, "geometry_encoding", "Could not present stored geometry.");
      return JSON.parse(g.Module.UTF8ToString(text));
    } finally {
      if (text) g.GEOSFree(text);
    }
  }
  overlay(
    a: Geometry,
    b: Geometry,
    precision: number,
    operation: "intersection" | "difference" | "union"
  ) {
    const g = this.geos;
    return this.withGeometry(a, precision, (left) =>
      this.withGeometry(b, precision, (right) => {
        const result =
          operation === "intersection"
            ? g.GEOSIntersectionPrec(left, right, precision)
            : operation === "difference"
              ? g.GEOSDifferencePrec(left, right, precision)
              : g.GEOSUnionPrec(left, right, precision);
        requireThat(result, "geometry_overlay", "Could not construct the geographic overlay.");
        try {
          return g.GEOSisEmpty(result) ? null : this.json(result);
        } finally {
          g.GEOSGeom_destroy(result);
        }
      })
    );
  }
  relation(
    a: Geometry,
    b: Geometry,
    precision: number,
    predicate: "covers" | "intersects" | "contains"
  ) {
    const g = this.geos;
    return this.withGeometry(a, precision, (left) =>
      this.withGeometry(b, precision, (right) => {
        const result =
          predicate === "covers"
            ? g.GEOSCovers(left, right)
            : predicate === "contains"
              ? g.GEOSContains(left, right)
              : g.GEOSIntersects(left, right);
        requireThat(result !== 2, "geometry_predicate", "Could not query this geometry.");
        return result === 1;
      })
    );
  }
  measure(value: Geometry, precision: number) {
    const g = this.geos,
      output = g.Module._malloc(8);
    try {
      return this.withGeometry(value, precision, (geometry) => {
        requireThat(g.GEOSArea(geometry, output), "geometry_measure", "Could not measure area.");
        const area = g.Module.getValue(output, "double");
        requireThat(
          g.GEOSLength(geometry, output),
          "geometry_measure",
          "Could not measure length."
        );
        return { area, length: g.Module.getValue(output, "double") };
      });
    } finally {
      g.Module._free(output);
    }
  }
  preparePoints(value: Geometry, precision: number, predicate: "covers" | "contains") {
    const g = this.geos;
    const geometry = this.withGeometry(value, precision, (source) => g.GEOSGeom_clone(source));
    const prepared = g.GEOSPrepare(geometry);
    if (!prepared) g.GEOSGeom_destroy(geometry);
    requireThat(prepared, "geometry_prepare", "Could not prepare geographic coverage.");
    return {
      test(x: number, y: number) {
        const p = g.GEOSGeom_createPointFromXY(x, y);
        try {
          const result =
            predicate === "covers"
              ? g.GEOSPreparedCovers(prepared, p)
              : g.GEOSPreparedContains(prepared, p);
          requireThat(result !== 2, "geometry_predicate", "Geographic point query failed.");
          return result === 1;
        } finally {
          g.GEOSGeom_destroy(p);
        }
      },
      close() {
        g.GEOSPreparedGeom_destroy(prepared);
        g.GEOSGeom_destroy(geometry);
      },
    };
  }
  nodeLines(lines: Geometry, clip: Geometry, precision: number) {
    const clipped = this.overlay(lines, clip, precision, "intersection");
    if (!clipped) return null;
    const g = this.geos;
    return this.withGeometry(clipped, precision, (geometry) => {
      const result = g.GEOSUnaryUnionPrec(geometry, precision);
      requireThat(result, "geometry_noding", "Could not node geographic boundaries.");
      try {
        return this.json(result);
      } finally {
        g.GEOSGeom_destroy(result);
      }
    });
  }
  polygonize(lines: Geometry, precision: number) {
    const g = this.geos,
      input = g.Module._malloc(4);
    try {
      return this.withGeometry(lines, precision, (geometry) => {
        g.Module.HEAPU32[input / 4] = geometry;
        const result = g.GEOSPolygonize(input, 1);
        requireThat(result, "geometry_polygonize", "Could not assemble geographic faces.");
        try {
          return this.json(result);
        } finally {
          g.GEOSGeom_destroy(result);
        }
      });
    } finally {
      g.Module._free(input);
    }
  }
  bounds(geometry: number): Bounds {
    const g = this.geos,
      value = g.Module._malloc(8);
    try {
      return [g.GEOSGeom_getXMin, g.GEOSGeom_getYMin, g.GEOSGeom_getXMax, g.GEOSGeom_getYMax].map(
        (read) => {
          requireThat(read(geometry, value), "geometry_bounds", "Could not read geometry bounds.");
          return g.Module.getValue(value, "double");
        }
      ) as Bounds;
    } finally {
      g.Module._free(value);
    }
  }
  matches(key: string, bytes: Uint8Array, target: number, predicate: "covers" | "intersects") {
    return this.withPrepared(key, bytes, (entry) => {
      const result =
        predicate === "covers"
          ? this.geos.GEOSPreparedCovers(entry.prepared, target)
          : this.geos.GEOSPreparedIntersects(entry.prepared, target);
      requireThat(result !== 2, "geometry_predicate", "Geometry query failed.");
      return result === 1;
    });
  }
  withPrepared<T>(key: string, bytes: Uint8Array, work: (entry: Prepared) => T): T {
    const g = this.geos;
    let entry = this.prepared.get(key),
      retained = true;
    if (!entry) {
      const geometry = this.fromBinary(bytes);
      entry = { geometry, prepared: g.GEOSPrepare(geometry) };
      if (!entry.prepared) g.GEOSGeom_destroy(geometry);
      requireThat(entry.prepared, "geometry_prepare", "Could not prepare geometry.");
      retained = this.prepared.set(key, entry, bytes.byteLength * 4);
    }
    try {
      return work(entry);
    } finally {
      if (!retained) {
        g.GEOSPreparedGeom_destroy(entry.prepared);
        g.GEOSGeom_destroy(entry.geometry);
      }
    }
  }
  matchesPoint(key: string, bytes: Uint8Array, x: number, y: number) {
    const point = this.geos.GEOSGeom_createPointFromXY(x, y);
    try {
      return this.matches(key, bytes, point, "covers");
    } finally {
      this.geos.GEOSGeom_destroy(point);
    }
  }
  invalidate(key: string) {
    this.prepared.delete(key);
  }
  close() {
    this.prepared.clear();
    this.geos.GEOSGeoJSONReader_destroy(this.reader);
    this.geos.GEOSGeoJSONWriter_destroy(this.writer);
  }
}
