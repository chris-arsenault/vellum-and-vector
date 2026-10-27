import { requireThat } from "@atlas/domain";
import type { GeometryKernel } from "./geometryKernel";

// Group handles without retaining a JavaScript entry for every input geometry.
const COLLECTION_BATCH = 64;
export class NativeCollection {
  private levels: number[][] = [];
  constructor(private g: GeometryKernel["native"]) {}
  /** Takes ownership of the supplied geometry, including when collection construction fails. */
  add(geometry: number) {
    requireThat(geometry, "geometry_collection", "Could not retain geographic geometry.");
    for (let level = 0; ; level++) {
      const bucket = this.levels[level] ?? (this.levels[level] = []);
      bucket.push(geometry);
      if (bucket.length < COLLECTION_BATCH) return;
      geometry = this.collect(bucket);
      this.levels[level] = [];
    }
  }
  /** Transfers the complete collection to the caller. Zero denotes no input. */
  finish() {
    const parts = this.levels.flat();
    if (!parts.length) return 0;
    const result = this.collect(parts);
    this.levels = [];
    return result;
  }
  close() {
    for (const bucket of this.levels)
      for (const geometry of bucket) this.g.GEOSGeom_destroy(geometry);
    this.levels = [];
  }
  private collect(parts: number[]) {
    const g = this.g,
      pointers = g.Module._malloc(parts.length * 4);
    try {
      g.Module.HEAPU32.set(parts, pointers / 4);
      const result = g.GEOSGeom_createCollection(7, pointers, parts.length);
      requireThat(result, "geometry_collection", "Could not collect geographic geometry.");
      return result;
    } finally {
      // GEOS owns the geometries after successful construction, but never the pointer array.
      g.Module._free(pointers);
    }
  }
}
