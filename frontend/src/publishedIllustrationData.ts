import {
  mapSpace,
  type Bounds,
  type MapDescriptor,
  type MapEntity,
  type MapFeature,
  type MapReader,
  type ReadOptions,
} from "@atlas/map";
import type { DrawingGeometry } from "./drawingGeometry";
import type { CartographicPresentation, LayerStyle } from "./types";
import type { Geometry } from "geojson";
import { publishedAppearance, publishedFeature, vectorFamily } from "./publishedAppearance";
import { PublishedSamples } from "./PublishedSamples";
import { depictTerrain, terrainSymbolsAcrossSubject } from "./terrainDepiction";
import { depictFields, fieldMarksAcrossSubject, socialFieldChannel } from "./fieldDepiction";
import { bounds } from "./presentation";
import { cartographicLegend } from "./cartographicLegend";
import type { SheetPresentation } from "./sheetPresentation";

export interface PublishedDrawing {
  map: MapDescriptor;
  features: MapFeature[];
  entities: MapEntity[];
  view: CartographicPresentation;
  styles: LayerStyle[];
  footprint: Geometry;
  ancestry: string[];
}
/** Legend and terrain marks share precisely the same published feature classifications. */
export function publishedDrawingContent(input: PublishedDrawing, drawing: DrawingGeometry) {
  const features = input.features.map(publishedFeature);
  const geography = new Map<string, Geometry | null>(
    features.map((feature) => [feature.id, feature.geometry])
  );
  for (const feature of drawing.features) geography.set(feature.id, feature.geometry);
  const appearance = publishedAppearance(input.map, input.entities);
  const styles = input.styles.map((style) => ({ ...style, layerId: vectorFamily(style.layerId) }));
  const content = {
    features,
    geography,
    appearance,
    styles,
    view: input.view,
    visibleFeatures: new Set(drawing.features.filter((f) => f.intersectsSubject).map((f) => f.id)),
  };
  const sheet: SheetPresentation = {
    name: input.map.name,
    ancestry: input.ancestry,
    view: input.view,
    metresPerUnit: mapSpace(input.map, input.map.primarySpaceId).metresPerUnit,
    legend: cartographicLegend({
      ...content,
      footprint: input.footprint,
      fields: input.view.fields.map((id) => ({
        id: channel(id),
        name: input.map.layers.find((layer) => layer.id === id)?.name ?? id,
      })),
    }),
  };
  return { ...content, sheet };
}
const samplesAcrossSymbol = 4;
const channel = (id: string) => (id.startsWith("raster:") ? id.slice(7) : id);
export async function publishedDrawingMarks(
  input: PublishedDrawing,
  content: ReturnType<typeof publishedDrawingContent>,
  samples: PublishedSamples,
  reader: MapReader,
  options?: ReadOptions
) {
  const coverage = drawingCoverage(reader, input, options);
  const box = bounds(input.footprint) as Bounds;
  const span = Math.max(box[2] - box[0], box[3] - box[1]);
  const step = span / terrainSymbolsAcrossSubject / input.view.density;
  const extent: Bounds = [box[0] - step, box[1] - step, box[2] + step, box[3] + step];
  const terrain = input.map.layers.find((layer) => layer.id === "terrain");
  const tree = input.map.layers.find((layer) => layer.id === "raster:TreeCover");
  const trees =
    input.view.terrain && tree
      ? await samples.read(tree, ["value"], extent, step / samplesAcrossSymbol, options)
      : [];
  const ground =
    input.view.terrain && terrain
      ? await samples.read(terrain, ["value", "water"], extent, step / samplesAcrossSymbol, options)
      : [];
  const height =
    terrain?.source.kind === "raster"
      ? terrain.source.data.bands.find((band) => band.id === "value")
      : undefined;
  const terrainMarks = await depictTerrain(
    {
      ...content,
      coverage,
      samples: ground.map((sample) => ({
        covers: sample.covers,
        height: (point) => sample.at("value", point) * (height?.display.factor ?? 1),
        water: (point) => sample.at("water", point, true),
        tree: trees.length
          ? (point) => trees.find((entry) => entry.covers(point))?.at("value", point) ?? 0
          : null,
      })),
    },
    input.footprint
  );
  const fields = await Promise.all(
    input.view.fields.map(async (id) => {
      const layer = input.map.layers.find((layer) => layer.id === id);
      if (!layer || layer.source.kind !== "raster")
        throw new Error(`Map overlay ${id} was not published.`);
      const name = channel(id),
        value = layer.source.data.bands.find((band) => band.id === "value")!;
      return {
        channel: name,
        maximum:
          socialFieldChannel.test(name) && name.includes(":")
            ? 1
            : Math.max(1, value.range?.[1] ?? 1),
        samplers: (
          await samples.read(
            layer,
            ["value"],
            box,
            span / fieldMarksAcrossSubject / samplesAcrossSymbol,
            options
          )
        ).map((sample) => ({
          covers: sample.covers,
          at: (point: { x: number; y: number }) => sample.at("value", point),
        })),
      };
    })
  );
  return { terrain: terrainMarks, fields: await depictFields(fields, input.footprint, coverage) };
}
function drawingCoverage(reader: MapReader, input: PublishedDrawing, options?: ReadOptions) {
  return (polygons: Geometry[], points: { x: number; y: number }[]) =>
    reader.coverage(
      input.map.reference,
      {
        spaceId: input.map.primarySpaceId,
        polygons: polygons as import("@atlas/map").Geometry[],
        points: points.map((point) => [point.x, point.y]),
      },
      options
    );
}
