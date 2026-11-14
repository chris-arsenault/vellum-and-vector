import type { Geometry } from "geojson";
import { requireThat, type SpatialIndex } from "@atlas/domain";
import type { GeometryKernel } from "./geometryKernel";
import { strtree } from "./nativeOperations";

/** Owns borrowed native geometry until close; the same index serves TS scopes and Rust RAII. */
export function createSpatialIndex(
  kernel: GeometryKernel,
  geometries: Geometry[],
  precision: number
): SpatialIndex & { close(): void } {
  const g = kernel.native,
    tree = strtree(kernel),
    owned: number[] = [];
  let active = true;
  const assertActive = () =>
    requireThat(active, "geometry_lifetime", "The spatial index scope has ended.");
  const close = () => {
    if (!active) return;
    active = false;
    tree.close();
    for (const geometry of owned) g.GEOSGeom_destroy(geometry);
  };
  try {
    for (const value of geometries) {
      const shape = kernel.withShape(value, precision, (input) => g.GEOSGeom_clone(input));
      requireThat(shape, "spatial_index", "Could not retain indexed geometry.");
      owned.push(shape);
      tree.insert(shape);
    }
  } catch (error) {
    close();
    throw error;
  }
  return {
    query(bounds) {
      assertActive();
      return kernel.withRectangle(bounds, tree.query);
    },
    nearest(position) {
      assertActive();
      return kernel.withRectangle([position.x, position.y, position.x, position.y], tree.nearest);
    },
    close,
  };
}
