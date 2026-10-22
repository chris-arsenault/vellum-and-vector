import type { Geometry, LineString, Position as Coordinate } from "geojson";
import GeoJSONReader from "jsts/org/locationtech/jts/io/GeoJSONReader.js";
import GeoJSONWriter from "jsts/org/locationtech/jts/io/GeoJSONWriter.js";
import GeometryFactory from "jsts/org/locationtech/jts/geom/GeometryFactory.js";
import PrecisionModel from "jsts/org/locationtech/jts/geom/PrecisionModel.js";
import IsValidOp from "jsts/org/locationtech/jts/operation/valid/IsValidOp.js";
import RelateOp from "jsts/org/locationtech/jts/operation/relate/RelateOp.js";
import OverlayOp from "jsts/org/locationtech/jts/operation/overlay/OverlayOp.js";
import DistanceOp from "jsts/org/locationtech/jts/operation/distance/DistanceOp.js";
import BufferOp from "jsts/org/locationtech/jts/operation/buffer/BufferOp.js";
import VariableBuffer from "jsts/org/locationtech/jts/operation/buffer/VariableBuffer.js";
import CoordinatePrecisionReducerFilter from "jsts/org/locationtech/jts/precision/CoordinatePrecisionReducerFilter.js";
import GeometryPrecisionReducer from "jsts/org/locationtech/jts/precision/GeometryPrecisionReducer.js";
import ConvexHull from "jsts/org/locationtech/jts/algorithm/ConvexHull.js";
import RectangleLineIntersector from "jsts/org/locationtech/jts/algorithm/RectangleLineIntersector.js";
import UnaryUnionOp from "jsts/org/locationtech/jts/operation/union/UnaryUnionOp.js";
import IndexedPointInAreaLocator from "jsts/org/locationtech/jts/algorithm/locate/IndexedPointInAreaLocator.js";
import Location from "jsts/org/locationtech/jts/geom/Location.js";
import InteriorPointArea from "jsts/org/locationtech/jts/algorithm/InteriorPointArea.js";
import STRtree from "jsts/org/locationtech/jts/index/strtree/STRtree.js";
import Envelope from "jsts/org/locationtech/jts/geom/Envelope.js";
import CoordinatePoint from "jsts/org/locationtech/jts/geom/Coordinate.js";
import type { Frame, Position } from "./model";
import { frameSchema, geometrySchema } from "./schemas";
import { requireThat } from "./errors";
import { polygonOverlay, partitionPolygon, nodedPolygonOverlay } from "./polygonOverlay";

interface Shape {
  isRectangle(): boolean;
  isEmpty(): boolean;
  normalize(): void;
  getGeometryType(): string;
  getBoundary(): Shape;
  getNumGeometries(): number;
  getGeometryN(index: number): Shape;
  getCoordinates(): { x: number; y: number; z: number }[];
  getArea(): number;
  getLength(): number;
  getEnvelopeInternal(): {
    getMinX(): number;
    getMinY(): number;
    getMaxX(): number;
    getMaxY(): number;
  };
}

export type Bounds = [number, number, number, number];

export class Spatial {
  private readonly model: PrecisionModel;
  private readonly reader: GeoJSONReader;
  private readonly writer = new GeoJSONWriter();

  constructor(readonly precision = 0.000001) {
    requireThat(
      Number.isFinite(precision) && precision > 0,
      "invalid_precision",
      "Precision must be positive."
    );
    this.model = new PrecisionModel(1 / precision);
    // Quantize complete geometries at the API boundary. Fixed-precision edge
    // intersections in the legacy JSTS overlay can move a crossing off its
    // segment without renoding adjacent edges; overlay arithmetic stays floating.
    this.reader = new GeoJSONReader(new GeometryFactory());
  }

  read(value: Geometry): Shape {
    const original = this.reader.read(geometrySchema.parse(value)) as Shape;
    requireThat(
      !original.isEmpty() && IsValidOp.isValid(original),
      "invalid_geometry",
      "Geometry must be nonempty and topologically valid."
    );
    const shape = GeometryPrecisionReducer.reduce(original, this.model) as Shape;
    requireThat(
      !shape.isEmpty() && IsValidOp.isValid(shape),
      "precision_collapse",
      "Geometry collapses at the world's declared precision."
    );
    return shape;
  }

  private write(shape: Shape): Geometry | null {
    if (shape.getGeometryType() === "GeometryCollection") {
      const geometries = Array.from({ length: shape.getNumGeometries() }, (_, i) =>
        this.write(shape.getGeometryN(i))
      ).filter((part): part is Geometry => part !== null);
      return geometries.length ? { type: "GeometryCollection", geometries } : null;
    }
    const original = shape;
    shape = GeometryPrecisionReducer.reduce(shape, this.model) as Shape;
    if (shape.isEmpty()) return null;
    if (["Polygon", "MultiPolygon"].includes(shape.getGeometryType())) {
      if (!IsValidOp.isValid(shape)) {
        // Reduction can create touching slivers even from a valid overlay.
        // Re-node its boundary at the same declared precision before delivery.
        const noded = nodedPolygonOverlay(original, original, this.model, "union") as Shape | null;
        if (!noded) return null;
        shape = GeometryPrecisionReducer.reduce(noded, this.model) as Shape;
        requireThat(
          IsValidOp.isValid(shape),
          "invalid_geometry",
          "Polygon output must be topologically valid."
        );
      }
      shape.normalize();
    }
    const coordinates = shape.getCoordinates();
    let index = 0;
    const restoreZeroZ = (geometry: Geometry): Geometry =>
      geometry.type === "GeometryCollection"
        ? { ...geometry, geometries: geometry.geometries.map(restoreZeroZ) }
        : ({
            ...geometry,
            coordinates: mapCoordinates(geometry.coordinates, (c) => {
              const source = coordinates[index++];
              return source.z === 0 && c.length === 2 ? [...c, 0] : c;
            }),
          } as Geometry);
    // JSTS's GeoJSON writer tests Z for truthiness and omits an explicit zero.
    return geometrySchema.parse(restoreZeroZ(this.writer.write(shape) as Geometry));
  }

  canonical(value: Geometry): Geometry {
    return this.write(this.read(value))!;
  }

  convexHull(value: Geometry): Geometry {
    return this.write(new ConvexHull(this.read(value)).getConvexHull() as Shape)!;
  }

  covers(a: Geometry, b: Geometry): boolean {
    return Boolean(RelateOp.covers(this.read(a), this.read(b)));
  }
  geometryCoverage(footprint: Geometry): (geometry: Geometry) => boolean {
    const shape = this.read(footprint);
    if (!shape.isRectangle())
      return (geometry) => Boolean(RelateOp.covers(shape, this.read(geometry)));
    // A rectangle is convex: envelope containment is exact coverage for any
    // valid geometry. Other footprints retain their full topological predicate.
    const extent = shape.getEnvelopeInternal();
    return (geometry) => {
      const probe = this.read(geometry).getEnvelopeInternal();
      return (
        extent.getMinX() <= probe.getMinX() &&
        extent.getMaxX() >= probe.getMaxX() &&
        extent.getMinY() <= probe.getMinY() &&
        extent.getMaxY() >= probe.getMaxY()
      );
    };
  }
  pointCoverage(footprint: Geometry): (position: Position) => boolean {
    const shape = this.read(footprint),
      locator = ["Polygon", "MultiPolygon"].includes(shape.getGeometryType())
        ? new IndexedPointInAreaLocator(shape)
        : null;
    return (position) => {
      if (!locator) return Boolean(RelateOp.covers(shape, this.read(point(position))));
      requireThat(
        Number.isFinite(position.x) && Number.isFinite(position.y) && Number.isFinite(position.z),
        "invalid_geometry",
        "Point coordinates must be finite."
      );
      const probe = new CoordinatePoint(
        this.model.makePrecise(position.x),
        this.model.makePrecise(position.y)
      );
      return locator.locate(probe) !== Location.EXTERIOR;
    };
  }
  intersects(a: Geometry, b: Geometry): boolean {
    return Boolean(RelateOp.intersects(this.read(a), this.read(b)));
  }
  intersectionPredicate(footprint: Geometry): (geometry: Geometry) => boolean {
    const shape = this.read(footprint);
    return (geometry) => Boolean(RelateOp.intersects(this.read(geometry), shape));
  }
  /** Conservative box overlap, retaining every box which might cross a polygon. */
  boundsIntersectionCandidate(footprint: Geometry): (box: Bounds) => boolean {
    const shape = this.read(footprint),
      locator = new IndexedPointInAreaLocator(shape),
      boundary = new STRtree(),
      rings = shape.getBoundary();
    for (let ring = 0; ring < rings.getNumGeometries(); ring++) {
      const coordinates = rings.getGeometryN(ring).getCoordinates();
      for (let i = 1; i < coordinates.length; i++) {
        const a = coordinates[i - 1],
          b = coordinates[i];
        boundary.insert(new Envelope(a.x, b.x, a.y, b.y), [a, b]);
      }
    }
    return (box) => {
      const envelope = new Envelope(
          box[0] - this.precision,
          box[2] + this.precision,
          box[1] - this.precision,
          box[3] + this.precision
        ),
        intersector = new RectangleLineIntersector(envelope),
        candidates = boundary.query(envelope).iterator();
      while (candidates.hasNext()) {
        const [a, b] = candidates.next();
        if (intersector.intersects(a, b)) return true;
      }
      return locator.locate(new CoordinatePoint(box[0], box[1])) !== Location.EXTERIOR;
    };
  }
  distance(a: Geometry, b: Geometry): number {
    return DistanceOp.distance(this.read(a), this.read(b)) as number;
  }
  area(value: Geometry): number {
    return this.read(value).getArea();
  }
  length(value: Geometry): number {
    return this.read(value).getLength();
  }
  intersection(a: Geometry, b: Geometry): Geometry | null {
    const result = polygonOverlay(
      this.read(a),
      this.read(b),
      this.model,
      "intersection"
    ) as Shape | null;
    return result ? this.write(result) : null;
  }
  /** Reuse a validated footprint and measure intersections without a GeoJSON round trip. */
  intersectionArea(footprint: Geometry): (geometry: Geometry) => number {
    const shape = this.read(footprint);
    return (geometry) => {
      const result = polygonOverlay(this.read(geometry), shape, this.model, "intersection");
      return result ? (GeometryPrecisionReducer.reduce(result, this.model) as Shape).getArea() : 0;
    };
  }
  difference(a: Geometry, b: Geometry): Geometry | null {
    const result = polygonOverlay(
      this.read(a),
      this.read(b),
      this.model,
      "difference"
    ) as Shape | null;
    return result ? this.write(result) : null;
  }
  /** Subtract one fixed mask from many features without rebuilding its spatial index. */
  differenceFrom(mask: Geometry): (geometry: Geometry) => Geometry | null {
    const shape = this.read(mask),
      locator = new IndexedPointInAreaLocator(shape),
      boundary = new STRtree(),
      coordinates = shape.getCoordinates();
    for (let i = 1; i < coordinates.length; i++) {
      const a = coordinates[i - 1],
        b = coordinates[i];
      boundary.insert(new Envelope(a.x, b.x, a.y, b.y), {});
    }
    return (geometry) => {
      const candidate = this.read(geometry);
      // With no mask edge in its envelope the entire candidate is on one side.
      // Include edges between rings as conservative false positives; exact GIS
      // subtraction handles every envelope which might cross a boundary.
      if (boundary.query(candidate.getEnvelopeInternal()).isEmpty()) {
        const p = candidate.getCoordinates()[0];
        return locator.locate(p) === Location.EXTERIOR ? geometry : null;
      }
      const result = polygonOverlay(candidate, shape, this.model, "difference") as Shape | null;
      return result ? this.write(result) : null;
    };
  }
  union(a: Geometry, b: Geometry): Geometry {
    return this.write(polygonOverlay(this.read(a), this.read(b), this.model, "union") as Shape)!;
  }
  unionAll(geometries: Geometry[]): Geometry {
    requireThat(geometries.length > 0, "invalid_geometry", "Union requires at least one geometry.");
    return this.write(
      UnaryUnionOp.union(this.read({ type: "GeometryCollection", geometries })) as Shape
    )!;
  }
  nodeLines(value: Geometry): Geometry {
    return this.write(UnaryUnionOp.union(this.read(value)) as Shape)!;
  }
  partition(footprint: Geometry, sections: LineString[]): Geometry[] {
    return partitionPolygon(
      this.read(footprint),
      sections.map((section) => this.read(section)),
      this.model
    ).map((face: Shape) => this.write(face)!);
  }
  buffer(value: Geometry, metres: number): Geometry | null {
    requireThat(Number.isFinite(metres), "invalid_distance", "Buffer distance must be finite.");
    return this.write(BufferOp.bufferOp(this.read(value), metres) as Shape);
  }
  variableBuffer(value: LineString, radii: number[]): Geometry | null {
    requireThat(
      radii.length === value.coordinates.length &&
        radii.every((radius) => Number.isFinite(radius) && radius >= 0),
      "invalid_distance",
      "Each line station requires a finite nonnegative radius."
    );
    const line = this.reader.read(geometrySchema.parse(value));
    // Keep duplicate vertices: each one owns its corresponding physical radius.
    // VariableBuffer handles coincident disks; normal geometry reduction would
    // remove coordinates without removing the matching radius entries.
    line.apply(new CoordinatePrecisionReducerFilter(this.model));
    return this.write(VariableBuffer.buffer(line, radii) as Shape);
  }
  bounds(value: Geometry): Bounds {
    const e = this.read(value).getEnvelopeInternal();
    return [e.getMinX(), e.getMinY(), e.getMaxX(), e.getMaxY()];
  }
  interiorPosition(value: Geometry): Position {
    const p = InteriorPointArea.getInteriorPoint(this.read(value));
    return { x: p.x, y: p.y, z: 0 };
  }
  crossings(value: Geometry, footprint: Geometry): Position[] {
    const result = OverlayOp.intersection(
      this.read(value),
      this.read(footprint).getBoundary()
    ) as Shape;
    const unique = new Map<string, Position>();
    for (const c of result.getCoordinates()) unique.set(`${c.x},${c.y}`, { x: c.x, y: c.y, z: 0 });
    return [...unique.values()];
  }
}

export const spatial = new Spatial();
/** Prepared index over immutable bounds, backed by the shared JSTS STRtree. */
export function boundsIndex<T>(entries: Iterable<{ bounds: Bounds; value: T }>) {
  const tree = new STRtree();
  for (const { bounds: b, value } of entries)
    tree.insert(new Envelope(b[0], b[2], b[1], b[3]), value);
  tree.build();
  return (b: Bounds): T[] => tree.query(new Envelope(b[0], b[2], b[1], b[3])).toArray();
}
export const point = (p: Position): Geometry => ({
  type: "Point",
  coordinates: [p.x, p.y],
});
export const rectangle = ([x0, y0, x1, y1]: Bounds): Geometry => ({
  type: "Polygon",
  coordinates: [
    [
      [x0, y0],
      [x1, y0],
      [x1, y1],
      [x0, y1],
      [x0, y0],
    ],
  ],
});

export function toWorld(frame: Frame, local: Position): Position {
  frameSchema.parse(frame);
  const a = (frame.rotation * Math.PI) / 180;
  return {
    x: frame.origin.x + frame.metresPerUnit * (local.x * Math.cos(a) - local.y * Math.sin(a)),
    y: frame.origin.y + frame.metresPerUnit * (local.x * Math.sin(a) + local.y * Math.cos(a)),
    z: frame.origin.z + local.z * frame.metresPerUnit,
  };
}

export function fromWorld(frame: Frame, world: Position): Position {
  frameSchema.parse(frame);
  const a = (frame.rotation * Math.PI) / 180;
  const x = (world.x - frame.origin.x) / frame.metresPerUnit;
  const y = (world.y - frame.origin.y) / frame.metresPerUnit;
  return {
    x: x * Math.cos(a) + y * Math.sin(a),
    y: -x * Math.sin(a) + y * Math.cos(a),
    z: (world.z - frame.origin.z) / frame.metresPerUnit,
  };
}

function mapCoordinates(value: unknown, convert: (c: Coordinate) => Coordinate): unknown {
  requireThat(Array.isArray(value), "invalid_coordinates", "Coordinate arrays are required.");
  return typeof value[0] === "number"
    ? convert(value as Coordinate)
    : value.map((v) => mapCoordinates(v, convert));
}

export function transformGeometry(geometry: Geometry, frame: Frame, inverse = false): Geometry {
  const convert = (coordinate: Coordinate): Coordinate => {
    const p = { x: coordinate[0], y: coordinate[1], z: coordinate[2] ?? 0 };
    const result = inverse ? fromWorld(frame, p) : toWorld(frame, p);
    return coordinate.length > 2 ? [result.x, result.y, result.z] : [result.x, result.y];
  };
  if (geometry.type === "GeometryCollection")
    return {
      type: geometry.type,
      geometries: geometry.geometries.map((g) => transformGeometry(g, frame, inverse)),
    };
  return spatial.canonical({
    ...geometry,
    coordinates: mapCoordinates(geometry.coordinates, convert),
  } as Geometry);
}
