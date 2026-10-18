import type { Geometry, Position as Coordinate } from "geojson";
import GeoJSONReader from "jsts/org/locationtech/jts/io/GeoJSONReader.js";
import GeoJSONWriter from "jsts/org/locationtech/jts/io/GeoJSONWriter.js";
import GeometryFactory from "jsts/org/locationtech/jts/geom/GeometryFactory.js";
import PrecisionModel from "jsts/org/locationtech/jts/geom/PrecisionModel.js";
import IsValidOp from "jsts/org/locationtech/jts/operation/valid/IsValidOp.js";
import RelateOp from "jsts/org/locationtech/jts/operation/relate/RelateOp.js";
import OverlayOp from "jsts/org/locationtech/jts/operation/overlay/OverlayOp.js";
import DistanceOp from "jsts/org/locationtech/jts/operation/distance/DistanceOp.js";
import BufferOp from "jsts/org/locationtech/jts/operation/buffer/BufferOp.js";
import GeometryPrecisionReducer from "jsts/org/locationtech/jts/precision/GeometryPrecisionReducer.js";
import UnaryUnionOp from "jsts/org/locationtech/jts/operation/union/UnaryUnionOp.js";
import IndexedPointInAreaLocator from "jsts/org/locationtech/jts/algorithm/locate/IndexedPointInAreaLocator.js";
import Location from "jsts/org/locationtech/jts/geom/Location.js";
import type { Frame, Position } from "./model";
import { frameSchema, geometrySchema } from "./schemas";
import { requireThat } from "./errors";

interface Shape {
  isRectangle(): boolean;
  isEmpty(): boolean;
  normalize(): void;
  getGeometryType(): string;
  getBoundary(): Shape;
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
    this.reader = new GeoJSONReader(new GeometryFactory(this.model, 0));
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
    if (shape.isEmpty()) return null;
    if (["Polygon", "MultiPolygon"].includes(shape.getGeometryType())) shape.normalize();
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
      const probe = this.read(point(position));
      return locator
        ? locator.locate(probe.getCoordinates()[0]) !== Location.EXTERIOR
        : Boolean(RelateOp.covers(shape, probe));
    };
  }
  intersects(a: Geometry, b: Geometry): boolean {
    return Boolean(RelateOp.intersects(this.read(a), this.read(b)));
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
    return this.write(OverlayOp.intersection(this.read(a), this.read(b)) as Shape);
  }
  difference(a: Geometry, b: Geometry): Geometry | null {
    return this.write(OverlayOp.difference(this.read(a), this.read(b)) as Shape);
  }
  union(a: Geometry, b: Geometry): Geometry {
    return this.write(OverlayOp.union(this.read(a), this.read(b)) as Shape)!;
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
  buffer(value: Geometry, metres: number): Geometry | null {
    requireThat(Number.isFinite(metres), "invalid_distance", "Buffer distance must be finite.");
    return this.write(BufferOp.bufferOp(this.read(value), metres) as Shape);
  }
  bounds(value: Geometry): Bounds {
    const e = this.read(value).getEnvelopeInternal();
    return [e.getMinX(), e.getMinY(), e.getMaxX(), e.getMaxY()];
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
