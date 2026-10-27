import type { Geometry, Position as Coordinate } from "geojson";
import { requireThat, type Position } from "@atlas/domain";
import type { GeometryKernel } from "./geometryKernel";
import { NativeCollection } from "./nativeCollection";

/** Keep noding and face assembly native; only the selected result becomes GeoJSON. */
export function contourArea(
  kernel: GeometryKernel,
  precision: number,
  boundaries: Iterable<Coordinate[]>,
  includes: (point: Position) => boolean
): Geometry | null {
  const lines = new NativeCollection(kernel.native);
  try {
    for (const coordinates of boundaries)
      kernel.withGeometry({ type: "LineString", coordinates }, precision, (line) =>
        lines.add(kernel.native.GEOSGeom_clone(line))
      );
    const collection = lines.finish();
    if (!collection) return null;
    const noded = unionAndRelease(kernel, precision, collection);
    const faces = polygonizeAndRelease(kernel, noded);
    return selectFaces(kernel, precision, faces, includes);
  } finally {
    lines.close();
  }
}
function unionAndRelease(kernel: GeometryKernel, precision: number, input: number) {
  try {
    const result = kernel.native.GEOSUnaryUnionPrec(input, precision);
    requireThat(result, "geometry_noding", "Could not node geographic boundaries.");
    return result;
  } finally {
    kernel.native.GEOSGeom_destroy(input);
  }
}
function polygonizeAndRelease(kernel: GeometryKernel, noded: number) {
  const g = kernel.native,
    pointer = g.Module._malloc(4);
  try {
    g.Module.HEAPU32[pointer / 4] = noded;
    const result = g.GEOSPolygonize(pointer, 1);
    requireThat(result, "geometry_polygonize", "Could not assemble geographic faces.");
    return result;
  } finally {
    g.Module._free(pointer);
    g.GEOSGeom_destroy(noded);
  }
}
function selectFaces(
  kernel: GeometryKernel,
  precision: number,
  faces: number,
  includes: (point: Position) => boolean
) {
  const g = kernel.native,
    selected = new NativeCollection(g);
  try {
    try {
      for (let i = 0; i < g.GEOSGetNumGeometries(faces); i++) {
        const face = g.GEOSGetGeometryN(faces, i);
        if (includes(interiorPoint(kernel, face))) selected.add(g.GEOSGeom_clone(face));
      }
    } finally {
      g.GEOSGeom_destroy(faces);
    }
    const collection = selected.finish();
    if (!collection) return null;
    const result = unionAndRelease(kernel, precision, collection);
    try {
      return g.GEOSisEmpty(result) ? null : kernel.json(result);
    } finally {
      g.GEOSGeom_destroy(result);
    }
  } finally {
    selected.close();
  }
}
function interiorPoint(kernel: GeometryKernel, geometry: number): Position {
  const g = kernel.native,
    point = g.GEOSPointOnSurface(geometry);
  requireThat(point, "geometry_interior", "Geometry needs an interior point.");
  try {
    const value = kernel.json(point);
    requireThat(value.type === "Point", "geometry_interior", "Geometry needs an interior point.");
    return { x: value.coordinates[0], y: value.coordinates[1], z: 0 };
  } finally {
    g.GEOSGeom_destroy(point);
  }
}
