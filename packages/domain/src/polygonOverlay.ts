import OverlayOp from "jsts/org/locationtech/jts/operation/overlay/OverlayOp.js";
import TopologyException from "jsts/org/locationtech/jts/geom/TopologyException.js";
import GeometryNoder from "jsts/org/locationtech/jts/noding/snapround/GeometryNoder.js";
import FastNodingValidator from "jsts/org/locationtech/jts/noding/FastNodingValidator.js";
import NodingValidator from "jsts/org/locationtech/jts/noding/NodingValidator.js";
import Polygonizer from "jsts/org/locationtech/jts/operation/polygonize/Polygonizer.js";
import IndexedPointInAreaLocator from "jsts/org/locationtech/jts/algorithm/locate/IndexedPointInAreaLocator.js";
import InteriorPointArea from "jsts/org/locationtech/jts/algorithm/InteriorPointArea.js";
import Location from "jsts/org/locationtech/jts/geom/Location.js";
import UnaryUnionOp from "jsts/org/locationtech/jts/operation/union/UnaryUnionOp.js";
import ArrayList from "jsts/java/util/ArrayList.js";
import type PrecisionModel from "jsts/org/locationtech/jts/geom/PrecisionModel.js";

interface AreaShape {
  getGeometryType(): string;
}
const isArea = (shape: AreaShape) => ["Polygon", "MultiPolygon"].includes(shape.getGeometryType());

function validatedLines(inputs: ArrayList, precision: PrecisionModel) {
  const noder = new GeometryNoder(precision),
    lines = noder.node(inputs),
    segments = noder.toSegmentStrings(lines);
  // GeometryNoder's optional validator compares every pair. The standard indexed
  // validator checks crossings and interior vertices; collapse checks stay linear.
  new FastNodingValidator(segments).checkValid();
  new NodingValidator(segments).checkCollapses();
  return lines;
}

/** Legacy overlay can fail to node nearly coincident polygon edges. Node both
 * boundaries together at the declared precision before selecting result faces.
 * Lower-dimensional operations retain JSTS's ordinary overlay semantics.
 */
export function polygonOverlay(
  a: AreaShape,
  b: AreaShape,
  precision: PrecisionModel,
  operation: "difference" | "union" | "intersection"
) {
  if (!isArea(a) || !isArea(b)) return OverlayOp[operation](a, b);
  try {
    return OverlayOp.overlayOp(
      a,
      b,
      {
        difference: OverlayOp.DIFFERENCE,
        union: OverlayOp.UNION,
        intersection: OverlayOp.INTERSECTION,
      }[operation]
    );
  } catch (error) {
    if (!(error instanceof TopologyException)) throw error;
  }
  return nodedPolygonOverlay(a, b, precision, operation);
}

export function nodedPolygonOverlay(
  a: AreaShape,
  b: AreaShape,
  precision: PrecisionModel,
  operation: "difference" | "union" | "intersection"
) {
  const inputs = new ArrayList([]);
  inputs.add(a);
  inputs.add(b);
  const polygonizer = new Polygonizer();
  polygonizer.add(UnaryUnionOp.union(validatedLines(inputs, precision)));
  const first = new IndexedPointInAreaLocator(a),
    second = new IndexedPointInAreaLocator(b),
    selected = new ArrayList([]);
  for (const face of polygonizer.getPolygons().toArray()) {
    const point = InteriorPointArea.getInteriorPoint(face);
    const insideFirst = first.locate(point) !== Location.EXTERIOR,
      insideSecond = second.locate(point) !== Location.EXTERIOR;
    const included = {
      difference: insideFirst && !insideSecond,
      union: insideFirst || insideSecond,
      intersection: insideFirst && insideSecond,
    }[operation];
    if (included) selected.add(face);
  }
  return selected.isEmpty() ? null : UnaryUnionOp.union(selected);
}

/** Node zero-width sections into an area without removing land or joining faces. */
export function partitionPolygon(
  area: AreaShape,
  sections: AreaShape[],
  precision: PrecisionModel
) {
  const inputs = new ArrayList([]),
    polygonizer = new Polygonizer(),
    locator = new IndexedPointInAreaLocator(area);
  inputs.add(area);
  for (const section of sections) inputs.add(section);
  polygonizer.add(UnaryUnionOp.union(validatedLines(inputs, precision)));
  return polygonizer
    .getPolygons()
    .toArray()
    .filter(
      (face: AreaShape) =>
        locator.locate(InteriorPointArea.getInteriorPoint(face)) !== Location.EXTERIOR
    );
}
