import type { Geometry } from "geojson";
import { requireThat, type Bounds } from "@atlas/domain";
import type { GeometryKernel } from "./geometryKernel";
import type { GeosSpatial } from "./geosSpatial";

const geometry = (value: string) => JSON.parse(value) as Geometry;
const geometries = (value: string) => JSON.parse(value) as Geometry[];

/** Parse and prepare masks once per batch; all geometry work stays in the selected worker. */
export function rustSpatialBulk(kernel: GeometryKernel, spatial: GeosSpatial, precision: number) {
  return {
    lineFractions(line: string, points: Float64Array) {
      if (points.length % 2) throw new Error("Point batches require XY pairs");
      return kernel.withGeometry(geometry(line), precision, (input) => {
        const g = kernel.native;
        return Float64Array.from({ length: points.length / 2 }, (_, i) => {
          const snap = (value: number) => Math.round(value / precision) * precision,
            point = g.GEOSGeom_createPointFromXY(snap(points[2 * i]), snap(points[2 * i + 1]));
          requireThat(point, "geometry_point", "Could not create station query.");
          try {
            const fraction = g.GEOSProjectNormalized(input, point);
            requireThat(fraction >= 0, "geometry_station", "Could not locate station.");
            return fraction;
          } finally {
            g.GEOSGeom_destroy(point);
          }
        });
      });
    },
    boundary(value: string) {
      return kernel.withGeometry(geometry(value), precision, (input) => {
        const g = kernel.native,
          output = g.GEOSBoundary(input);
        requireThat(output, "geometry_boundary", "Could not read geographic boundary.");
        try {
          return JSON.stringify(g.GEOSisEmpty(output) ? null : kernel.json(output));
        } finally {
          g.GEOSGeom_destroy(output);
        }
      });
    },
    relations(mask: string, values: string, predicate: "covers" | "intersects") {
      if (predicate !== "covers" && predicate !== "intersects")
        throw new Error("Unknown geometry predicate");
      const query =
        predicate === "covers"
          ? spatial.geometryCoverage(geometry(mask))
          : spatial.intersectionPredicate(geometry(mask));
      return JSON.stringify(geometries(values).map(query));
    },
    overlays(mask: string, values: string, operation: "intersection" | "difference" | "union") {
      const shape = geometry(mask);
      if (!["intersection", "difference", "union"].includes(operation))
        throw new Error("Unknown geometry overlay");
      const apply =
        operation === "intersection"
          ? spatial.intersectionWith(shape)
          : operation === "difference"
            ? spatial.differenceFrom(shape)
            : (value: Geometry) => spatial.union(value, shape);
      return JSON.stringify(geometries(values).map(apply));
    },
    intersectionAreas(mask: string, values: string) {
      return JSON.stringify(geometries(values).map(spatial.intersectionArea(geometry(mask))));
    },
    clipWindows(value: string, windows: string) {
      return spatial.withClipByRect(geometry(value), (clip) =>
        JSON.stringify((JSON.parse(windows) as Bounds[]).map(clip))
      );
    },
    interiors: (values: string) =>
      JSON.stringify(
        geometries(values).map((value) => {
          const { x, y, z } = spatial.interiorPosition(value);
          return [x, y, z];
        })
      ),
  };
}
