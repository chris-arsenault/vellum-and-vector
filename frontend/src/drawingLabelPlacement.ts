import type { MapReader, Geometry, GeometryQuery, Position, ReadOptions } from "@atlas/map";
import type { PublishedDrawing } from "./publishedIllustrationData";
import type { DrawingFeature } from "./drawingGeometry";
import { bounds } from "./presentation";

function placeAnchor(shape: Geometry, attributes: Record<string, unknown>): Position | null {
  if (shape.type === "Point") return shape.coordinates;
  const p = attributes.representative as { x?: number; y?: number } | undefined;
  if (p && Number.isFinite(p.x) && Number.isFinite(p.y)) return [p.x!, p.y!];
  if (shape.type.includes("Polygon")) return null;
  const line =
    shape.type === "LineString"
      ? shape.coordinates
      : shape.type === "MultiLineString"
        ? shape.coordinates[0]
        : [];
  return line?.[Math.floor(line.length / 2)] ?? [0, 0];
}

/** Label policy uses GIS intersections and interior points; storage knows nothing about labels. */
export async function placeLabels(
  reader: MapReader,
  input: PublishedDrawing,
  features: DrawingFeature[],
  options?: ReadOptions
) {
  const shapes = features.filter((f) => f.geometry !== null);
  const clipped = input.view.clip
    ? await reader.geometries(
        input.map.reference,
        input.map.primarySpaceId,
        shapes.map((f) => ({
          operation: "intersection",
          geometry: f.geometry!,
          mask: input.footprint as Geometry,
        })),
        options
      )
    : shapes.map((f) => ({ kind: "geometry" as const, value: f.geometry }));
  const queries: GeometryQuery[] = [];
  const anchors: { feature: DrawingFeature; label: boolean; shape: Geometry }[] = [];
  shapes.forEach((feature, i) => {
    const result = clipped[i];
    if (result.kind !== "geometry") throw new Error("Expected clipped GIS geometry.");
    const shape = result.value;
    const record = input.features.find((f) => f.id === feature.id)!;
    const anchor = placeAnchor(feature.geometry!, record.attributes);
    if (anchor) feature.placeAnchor = anchor;
    else {
      queries.push({ operation: "interior", geometry: feature.geometry! });
      anchors.push({ feature, label: false, shape: feature.geometry! });
    }
    if (!shape) return;
    if (shape.type.includes("Line")) feature.labelGeometry = shape;
    if (!shape.type.includes("Polygon")) return;
    const box = bounds(shape);
    feature.labelWidth = box[2] - box[0];
    if (record.layerId === "vector:sovereignty") {
      queries.push({ operation: "interior", geometry: shape });
      anchors.push({ feature, label: true, shape });
    }
  });
  const centers = await reader.geometries(
    input.map.reference,
    input.map.primarySpaceId,
    queries,
    options
  );
  const labels: { feature: DrawingFeature; shape: Geometry; center: Position }[] = [];
  centers.forEach((result, i) => {
    if (result.kind !== "position") throw new Error("Expected a GIS interior point.");
    const anchor = anchors[i];
    if (anchor.label) labels.push({ ...anchor, center: result.value });
    else anchor.feature.placeAnchor = result.value;
  });
  await positionAreaLabels(reader, input, labels, options);
}

async function positionAreaLabels(
  reader: MapReader,
  input: PublishedDrawing,
  labels: { feature: DrawingFeature; shape: Geometry; center: Position }[],
  options?: ReadOptions
) {
  const candidates = labels.map(({ shape, center: [x, y] }) => {
    const box = bounds(shape);
    return [0, 0.18, -0.18, 0.3, -0.3].map((offset): Position => [
      x,
      y + offset * (box[3] - box[1]),
    ]);
  });
  const coverage = await reader.geometries(
    input.map.reference,
    input.map.primarySpaceId,
    labels.map(({ shape }, i) => ({ operation: "covers", geometry: shape, points: candidates[i] })),
    options
  );
  const cities = input.features.flatMap((f) =>
    f.kind === "settlement" && f.geometry.type === "Point" ? [f.geometry.coordinates] : []
  );
  labels.forEach(({ feature, center }, i) => {
    const result = coverage[i];
    if (result.kind !== "coverage") throw new Error("Expected GIS point coverage.");
    const score = ([x, y]: Position) =>
      Math.min(...cities.map(([cx, cy]) => Math.hypot(x - cx, y - cy))) -
      Math.hypot(x - center[0], y - center[1]) * 0.2;
    const inside = candidates[i].filter((_, n) => result.value[n]);
    const best = cities.length ? (inside.sort((a, b) => score(b) - score(a))[0] ?? center) : center;
    feature.labelGeometry = { type: "Point", coordinates: best };
  });
}
