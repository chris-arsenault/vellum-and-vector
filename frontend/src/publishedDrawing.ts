import Feature from "ol/Feature.js";
import GeoJSON from "ol/format/GeoJSON.js";
import View from "ol/View.js";
import Projection from "ol/proj/Projection.js";
import { Fill, Stroke, Style } from "ol/style.js";
import { asArray } from "ol/color.js";
import { typePresentation } from "./featureTypePresentation";
import type { DrawingGeometry } from "./drawingGeometry";
import type { LayerStyle } from "./types";
import type { PublishedFeature } from "./publishedAppearance";
import type { Geometry } from "geojson";
import type { PublishedMapEngine } from "./publishedMapEngine";
import { type PublishedDrawing, publishedDrawingContent } from "./publishedIllustrationData";
import type { TerrainMark } from "./terrainDepiction";
import type { FieldMark } from "./fieldDepiction";
import { illustratedTerrain } from "./illustratedTerrain";
import { illustratedFields } from "./illustratedFields";
import { atlasColour } from "./drawnSymbols";
import { polityIdentity } from "./drawnStyles";
import { sheetPadding } from "./drawnSheet";
import { bounds } from "./presentation";

export interface PublishedDrawingProducts extends DrawingGeometry {
  terrain: TerrainMark[];
  fields: FieldMark[];
}
export async function updatePublishedDrawing(
  engine: PublishedMapEngine,
  input: PublishedDrawing,
  products: PublishedDrawingProducts
) {
  const drawn = input.view.mode === "drawn",
    content = publishedDrawingContent(input, products);
  engine.furniture.set("sheet", content.sheet);
  configureDrawing(engine, input, drawn);
  const extent = drawn && input.view.clip ? bounds(input.footprint) : undefined;
  await engine.vectors.update(
    input.features,
    input.entities,
    input.styles,
    drawn
      ? {
          view: input.view,
          footprint: input.view.clip ? input.footprint : undefined,
          geography: content.geography,
          features: new Map(products.features.map((feature) => [feature.id, feature])),
        }
      : undefined,
    input.realScale
  );
  if (engine.drawing.get("input") !== input) return;
  for (const [id, layer] of engine.vectors.layers) {
    layer.setExtent(extent);
    layer.setZIndex(drawn ? drawingPriority(id) : 0);
  }
  const source = engine.drawing.getSource()!;
  source.clear();
  if (!drawn) return;
  engine.drawing.setExtent(extent);
  source.addFeature(painted(input.footprint, "#eee4c9", "#8b7c60", -100));
  source.addFeatures(
    products.oceans.map((ocean) =>
      painted(ocean, input.view.style === "ink" ? "#e1e1d2" : "#b4cfca", "#7b897b", -90)
    )
  );
  source.addFeatures(
    products.coastEchoes.map((shape) => painted(shape, "#00000000", "#6e938955", -80))
  );
  source.addFeatures(territoryWashes(content));
  source.addFeatures(illustratedTerrain(input, products.terrain));
  source.addFeatures(illustratedFields(input, products.fields));
  const mask = engine.mask.getSource()!;
  mask.clear();
  if (products.mask) mask.addFeature(painted(products.mask, "#eee4c9", "#c9b995", 0));
}
function configureDrawing(engine: PublishedMapEngine, input: PublishedDrawing, drawn: boolean) {
  engine.drawing.set("input", input);
  if (engine.drawing.getVisible() !== drawn) drawingViewport(engine, drawn, input.footprint);
  engine.rasters.base.setVisible(!drawn);
  engine.rasters.overlays.setVisible(!drawn);
  engine.drawing.setVisible(drawn);
  engine.drawing.setZIndex(-100);
  engine.furniture.setVisible(drawn);
  engine.mask.setVisible(drawn && input.view.clip);
}
function territoryWashes(content: ReturnType<typeof publishedDrawingContent>) {
  const layer = content.styles.find((style) => style.layerId === "sovereignty");
  if (!layer?.visible) return [];
  return content.features
    .filter((feature) => feature.layerId === "sovereignty" && feature.kind !== "politicalRegion")
    .flatMap((feature) => {
      const type = content.appearance.type(feature),
        shape = content.geography.get(feature.id);
      if (!shape || !territoryVisible(content, feature, layer)) return [];
      const style = layer.types?.[type.id] ?? {};
      const color =
        style.color ??
        (content.view.style === "ink" ? "#594b36" : atlasColour(polityIdentity(feature)));
      return [
        painted(
          shape,
          color + (content.view.style === "ink" ? "12" : "8c"),
          "#00000000",
          -70,
          layer.opacity * (style.opacity ?? 1)
        ),
      ];
    });
}
function territoryVisible(
  content: ReturnType<typeof publishedDrawingContent>,
  feature: PublishedFeature,
  layer: LayerStyle
) {
  const own = content.view.overrides[feature.id];
  return (
    typePresentation(content.appearance.type(feature), layer).visible &&
    !own?.hidden &&
    !own?.illustrationHidden
  );
}
function painted(geometry: Geometry, color: string, outline: string, zIndex: number, opacity = 1) {
  const feature = new Feature({ geometry: new GeoJSON().readGeometry(geometry)! }),
    rgba = [...asArray(color)];
  rgba[3] = (rgba[3] ?? 1) * opacity;
  feature.setStyle(
    new Style({
      fill: new Fill({ color: rgba }),
      stroke: new Stroke({ color: outline, width: 1 }),
      zIndex,
    })
  );
  return feature;
}
function drawingPriority(id: string) {
  const priorities: Record<string, number> = {
    ecology: -40,
    sovereignty: -30,
    control: -30,
    claims: -30,
    administration: -30,
    oceans: -25,
    lakes: -25,
    magic: -15,
    geology: -10,
    faults: -10,
    roads: -8,
    rivers: -8,
  };
  return priorities[id.replace(/^vector:/, "")] ?? -5;
}
function drawingViewport(engine: PublishedMapEngine, drawn: boolean, footprint: Geometry) {
  const previous = engine.map.getView(),
    wrap = engine.space.periodicWidth !== null,
    extent = engine.space.bounds;
  engine.map.setView(
    new View({
      projection: new Projection({
        code: engine.space.id,
        units: "m",
        metersPerUnit: engine.space.metresPerUnit,
        extent,
        global: !drawn && wrap,
      }),
      center: previous.getCenter(),
      resolution: previous.getResolution(),
      rotation: previous.getRotation(),
      multiWorld: wrap,
      ...(!drawn && wrap
        ? { extent: [-Infinity, extent[1], Infinity, extent[3]], constrainOnlyCenter: true }
        : {}),
    })
  );
  engine.map.getView().fit(bounds(footprint), {
    padding: drawn
      ? sheetPadding(engine.furniture.get("sheet"), engine.map.getSize()?.[0] ?? 1200)
      : [35, 35, 35, 35],
  });
}
