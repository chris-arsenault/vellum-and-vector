import { spatial, translateGeometry } from "@atlas/domain";
import type { Geometry, Polygon } from "geojson";
import type { GenerationState } from "../process";
import { generatedFeature, putGenerated } from "../mapFeatures";

function polygons(shape: Geometry): Polygon[] {
  if (shape.type === "Polygon") return [shape];
  if (shape.type === "MultiPolygon")
    return shape.coordinates.map((coordinates) => ({ type: "Polygon", coordinates }));
  if (shape.type === "GeometryCollection") return shape.geometries.flatMap(polygons);
  return [];
}
/** The chart cut does not name the two sides of the same sea as different oceans. */
function oceanRegions(state: GenerationState, ocean: Geometry) {
  const shapes: Geometry[] = polygons(ocean);
  const width = state.physical?.map.mesh.periodic?.width;
  if (!width) return shapes;
  const groups: Geometry[] = [];
  while (shapes.length) {
    let shape = shapes.pop()!,
      merged = true;
    while (merged) {
      merged = false;
      for (let i = shapes.length - 1; i >= 0; i--) {
        const other = shapes[i];
        if (![-width, width].some((dx) => spatial.intersects(shape, translateGeometry(other, dx))))
          continue;
        shape = spatial.union(shape, other);
        shapes.splice(i, 1);
        merged = true;
      }
    }
    groups.push(shape);
  }
  return groups;
}
/** Name the existing connected sea outlines; no second ocean geometry is calculated. */
export function extractOceans(state: GenerationState) {
  const ocean = state.surface.ocean;
  if (!ocean) return;
  for (const shape of oceanRegions(state, ocean)) {
    const key = spatial
      .bounds(shape)
      .map((v) => v.toFixed(3))
      .join(":");
    putGenerated(
      state,
      generatedFeature(state, `ocean:${key}`, "Ocean", "ocean", "oceans", shape, {
        sourceAlgorithm: "canonry-0f62584c",
        area: spatial.area(shape),
      })
    );
  }
}
