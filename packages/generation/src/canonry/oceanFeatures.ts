import { spatial } from "@atlas/domain";
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
/** Name the existing connected sea outlines; no second ocean geometry is calculated. */
export function extractOceans(state: GenerationState) {
  const ocean = state.surface.ocean;
  if (!ocean) return;
  for (const shape of polygons(ocean)) {
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
