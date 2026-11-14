import type { MapReader, Geometry, GeometryQuery, Position, ReadOptions } from "@atlas/map";
import type { FeatureCollection } from "geojson";
import type { PublishedDrawing } from "./publishedIllustrationData";
import { bounds, rectangle } from "./presentation";
import { terrainSymbolsAcrossSubject } from "./terrainDepiction";
import { placeLabels } from "./drawingLabelPlacement";

/** Composition state belongs to the view, not the saved GIS schema or generator. */
export interface DrawingFeature {
  id: string;
  geometry: Geometry | null;
  labelGeometry: Geometry | null;
  labelWidth: number;
  placeAnchor: Position;
  intersectsSubject: boolean;
}
export interface DrawingGeometry {
  features: DrawingFeature[];
  oceans: Geometry[];
  coastEchoes: Geometry[];
  mask: Geometry | null;
}

export async function prepareDrawingGeometry(
  reader: MapReader,
  input: PublishedDrawing,
  options?: ReadOptions
): Promise<DrawingGeometry> {
  const illustration = await readIllustration(reader, input, options);
  const queries: GeometryQuery[] = [];
  const features = input.features.map((feature) => {
    const shape = illustration.shapes.has(feature.id)
      ? illustration.shapes.get(feature.id)!
      : feature.geometry;
    queries.push({
      operation: "intersects",
      geometry: feature.geometry,
      other: input.footprint as Geometry,
    });
    return {
      id: feature.id,
      geometry: shape,
      labelGeometry: null,
      labelWidth: 0,
      placeAnchor: [0, 0] as Position,
      intersectsSubject: false,
    };
  });
  const intersections = await reader.geometries(
    input.map.reference,
    input.map.primarySpaceId,
    queries,
    options
  );
  intersections.forEach((result, i) => {
    if (result.kind !== "boolean") throw new Error("Expected a GIS intersection result.");
    features[i].intersectsSubject = result.value;
  });
  const frame = await drawingFrame(reader, input, illustration.oceans, options);
  await placeLabels(reader, input, features, options);
  return { features, oceans: illustration.oceans, ...frame };
}

async function readIllustration(reader: MapReader, input: PublishedDrawing, options?: ReadOptions) {
  const shapes = new Map<string, Geometry | null>(),
    oceans: Geometry[] = [];
  for (const asset of await reader.illustration(input.map.reference, options)) {
    const collection = JSON.parse(new TextDecoder().decode(asset.bytes)) as FeatureCollection<
      Geometry | null,
      { featureId: string | null }
    >;
    for (const feature of collection.features) {
      if (feature.properties.featureId !== null)
        shapes.set(feature.properties.featureId, feature.geometry);
      else if (feature.geometry) oceans.push(feature.geometry);
    }
  }
  return { shapes, oceans };
}

async function drawingFrame(
  reader: MapReader,
  input: PublishedDrawing,
  oceans: Geometry[],
  options?: ReadOptions
) {
  const box = bounds(input.footprint),
    step = (box[2] - box[0]) / terrainSymbolsAcrossSubject;
  const queries: GeometryQuery[] = oceans.flatMap((geometry) =>
    [0.1, 0.23].map((fraction) => ({
      operation: "buffer" as const,
      geometry,
      distance: -step * fraction,
    }))
  );
  if (input.view.clip) {
    const [w, s, e, n] = input.map.spaces.find(
      (space) => space.id === input.map.primarySpaceId
    )!.bounds;
    queries.push({
      operation: "difference",
      geometry: rectangle(w, s, e - w, n - s) as Geometry,
      mask: input.footprint as Geometry,
    });
  }
  const results = await reader.geometries(
    input.map.reference,
    input.map.primarySpaceId,
    queries,
    options
  );
  const shapes = results.map((result) => {
    if (result.kind !== "geometry") throw new Error("Expected GIS geometry.");
    return result.value;
  });
  const mask = input.view.clip ? (shapes.pop() ?? null) : null;
  return { mask, coastEchoes: shapes.filter((shape): shape is Geometry => shape !== null) };
}
