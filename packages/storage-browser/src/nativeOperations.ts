import type { Geometry, Point } from "geojson";
import { requireThat, type Bounds } from "@atlas/domain";
import type { GeometryKernel } from "./geometryKernel";

/** GEOS window, linear-referencing, Voronoi and STRtree operations over kernel handles. */
export function clipByRect(
  kernel: GeometryKernel,
  value: Geometry,
  bounds: Bounds,
  precision: number
) {
  const g = kernel.native;
  return kernel.withShape(value, precision, (geometry) => {
    const result = g.GEOSClipByRect(geometry, ...bounds);
    requireThat(result, "geometry_clip", "Could not clip geography to the window.");
    try {
      return g.GEOSisEmpty(result) ? null : kernel.json(result);
    } finally {
      g.GEOSGeom_destroy(result);
    }
  });
}
/** The closest pair of points, first on `a`, then on `b`. */
export function nearestPoints(
  kernel: GeometryKernel,
  a: Geometry,
  b: Geometry,
  precision: number
): [number[], number[]] {
  const g = kernel.native;
  return kernel.withShape(a, precision, (left) =>
    kernel.withShape(b, precision, (right) => {
      const sequence = g.GEOSNearestPoints(left, right);
      requireThat(sequence, "geometry_distance", "Could not find the nearest points.");
      const x = g.Module._malloc(8),
        y = g.Module._malloc(8);
      try {
        return [0, 1].map((i) => {
          requireThat(
            g.GEOSCoordSeq_getXY(sequence, i, x, y),
            "geometry_distance",
            "Could not read the nearest points."
          );
          return [g.Module.getValue(x, "double"), g.Module.getValue(y, "double")];
        }) as [number[], number[]];
      } finally {
        g.Module._free(x);
        g.Module._free(y);
        g.GEOSCoordSeq_destroy(sequence);
      }
    })
  );
}
/** Linear referencing: the fraction of a line's length at its point closest to `x, y`. */
export function project(
  kernel: GeometryKernel,
  line: Geometry,
  x: number,
  y: number,
  precision: number
) {
  const g = kernel.native;
  return kernel.withShape(line, precision, (geometry) => {
    const p = g.GEOSGeom_createPointFromXY(x, y);
    try {
      const fraction = g.GEOSProjectNormalized(geometry, p);
      requireThat(fraction >= 0, "geometry_reference", "Could not locate the point on the line.");
      return fraction;
    } finally {
      g.GEOSGeom_destroy(p);
    }
  });
}
export function interpolate(
  kernel: GeometryKernel,
  line: Geometry,
  fraction: number,
  precision: number
) {
  const g = kernel.native;
  return kernel.withShape(line, precision, (geometry) => {
    const p = g.GEOSInterpolateNormalized(geometry, fraction);
    requireThat(p, "geometry_reference", "Could not locate the fraction on the line.");
    try {
      return kernel.json(p) as Point;
    } finally {
      g.GEOSGeom_destroy(p);
    }
  });
}
/** Voronoi cells in site order, clipped to `bounds`; coincident sites share one cell. */
export function voronoi(
  kernel: GeometryKernel,
  sites: number[][],
  bounds: Bounds,
  precision: number
): (Geometry | null)[] {
  const g = kernel.native,
    unique = new Map(sites.map((p) => [`${p[0]},${p[1]}`, p]));
  if (!unique.size) return [];
  const siteCells = (cells: number, clip: number) => {
    const tree = strtree(kernel),
      parts = Array.from({ length: g.GEOSGetNumGeometries(cells) }, (_, i) =>
        g.GEOSGetGeometryN(cells, i)
      );
    try {
      for (const part of parts) tree.insert(part);
      return sites.map(([x, y]) => {
        const p = g.GEOSGeom_createPointFromXY(x, y);
        try {
          const cell = tree
            .query(p)
            .map((i) => parts[i])
            .find((part) => g.GEOSIntersects(part, p) === 1);
          if (!cell) return null;
          const clipped = g.GEOSIntersectionPrec(cell, clip, precision);
          requireThat(clipped, "geometry_voronoi", "Could not clip the site cell.");
          try {
            return g.GEOSisEmpty(clipped) ? null : kernel.json(clipped);
          } finally {
            g.GEOSGeom_destroy(clipped);
          }
        } finally {
          g.GEOSGeom_destroy(p);
        }
      });
    } finally {
      tree.close();
    }
  };
  return kernel.withShape(
    { type: "MultiPoint", coordinates: [...unique.values()] },
    precision,
    (input) =>
      kernel.withRectangle(bounds, (envelope) => {
        const cells = g.GEOSVoronoiDiagram(input, envelope, 0, 0);
        requireThat(cells, "geometry_voronoi", "Could not divide the sites.");
        try {
          return kernel.withRectangle(bounds, (clip) => siteCells(cells, clip));
        } finally {
          g.GEOSGeom_destroy(cells);
        }
      })
  );
}
let queryHits: number[] = [];
let queryCallback = 0;
/** A native STRtree over borrowed geometry handles; items are reported by insertion order. */
export function strtree(kernel: GeometryKernel) {
  const g = kernel.native,
    tree = g.GEOSSTRtree_create(10),
    items = new Map<number, number>();
  requireThat(tree, "spatial_index", "Could not create the spatial index.");
  // The Emscripten runtime exports addFunction; the package typings omit it.
  const runtime = g.Module as unknown as {
    addFunction(callback: (item: number) => void, signature: string): number;
  };
  queryCallback ||= runtime.addFunction((item) => {
    queryHits.push(item);
  }, "vii");
  return {
    insert(geometry: number) {
      items.set(geometry, items.size);
      g.GEOSSTRtree_insert(tree, geometry, geometry);
    },
    query(geometry: number) {
      queryHits = [];
      g.GEOSSTRtree_query(tree, geometry, queryCallback, 0);
      return queryHits.map((item) => items.get(item)!).sort((a, b) => a - b);
    },
    nearest(geometry: number) {
      if (!items.size) return -1;
      const item = g.GEOSSTRtree_nearest(tree, geometry);
      requireThat(item, "spatial_index", "Could not search the spatial index.");
      return items.get(item)!;
    },
    close() {
      g.GEOSSTRtree_destroy(tree);
    },
  };
}
