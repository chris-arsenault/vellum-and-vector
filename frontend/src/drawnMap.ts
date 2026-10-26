import Feature from "ol/Feature.js";
import GeoJSON from "ol/format/GeoJSON.js";
import { Fill, Stroke, Style } from "ol/style.js";
import {
  spatial,
  presentedFeatureStyle,
  describeFeature,
  type CartographicPresentation,
} from "@atlas/domain";
import type { Geometry } from "geojson";
import type { MapEngine } from "./mapEngine";
import type { RegionPresentation } from "./regionMap";
import type { Area, AtlasFeature, LayerStyle, Raster, World } from "./types";
import { illustratedTerrain, coastEchoes, terrainSymbolsAcrossSubject } from "./drawnTerrain";
import { bounds } from "./presentation";
import { illustratedFields } from "./drawnFields";
import { atlasColour } from "./drawnSymbols";
import { polityIdentity } from "./drawnStyles";
import { asArray } from "ol/color.js";
import { setDrawingViewport } from "./drawnViewport";
import { drawingGeography, drawingOceans } from "./drawnGeography";

export interface DrawnMapInput {
  world: World;
  region?: RegionPresentation;
  area: Area;
  view: CartographicPresentation;
  features: AtlasFeature[];
  styles: LayerStyle[];
  base: Raster[];
  rasters: Raster[];
}
export function updateDrawnMap(engine: MapEngine, input: DrawnMapInput) {
  if (unchangedDrawing(engine, input)) return;
  engine.drawn.set("revision", input.world.version);
  const footprint = input.region?.footprint ?? input.area.footprint;
  configureDrawnLayers(engine, input, footprint);
  if (input.view.mode !== "drawn") return;
  const source = engine.drawn.getSource()!;
  source.clear();
  updateMask(engine, footprint, input.view.clip);
  source.addFeature(painted(footprint, "#eee4c9", "#8b7c60", -100));
  addOcean(engine, input, footprint);
  source.addFeatures(territoryWashes(input));
  source.addFeatures(illustratedTerrain(input, footprint));
  source.addFeatures(illustratedFields(input, footprint));
}
function unchangedDrawing(engine: MapEngine, input: DrawnMapInput) {
  const previous = engine.drawn.get("input") as DrawnMapInput | undefined;
  if (!previous || engine.drawn.get("revision") !== input.world.version) return false;
  return (
    ["world", "view", "features", "styles", "base", "rasters"].every(
      (key) => previous[key as keyof DrawnMapInput] === input[key as keyof DrawnMapInput]
    ) &&
    (previous.region?.footprint ?? previous.area.footprint) ===
      (input.region?.footprint ?? input.area.footprint)
  );
}
function configureDrawnLayers(engine: MapEngine, input: DrawnMapInput, footprint: Geometry) {
  const drawn = input.view.mode === "drawn";
  engine.drawn.set("input", input);
  if (drawn !== engine.drawn.getVisible()) setDrawingViewport(engine, drawn, footprint);
  engine.image.setVisible(!drawn);
  engine.overlay.setVisible(!drawn);
  engine.drawn.setVisible(drawn);
  engine.drawn.setZIndex(-100);
  engine.furniture.setVisible(drawn);
  engine.drawnMask.setVisible(drawn && input.view.clip);
  engine.areas.setVisible(!drawn);
  engine.regions.setVisible(!drawn);
  const extent = drawn ? bounds(input.view.clip ? footprint : input.area.footprint) : undefined;
  engine.drawn.setExtent(extent);
  engine.drawnMask.setExtent(drawn ? bounds(input.world.reference.domain) : undefined);
  for (const [id, layer] of engine.featureLayers) {
    layer.setExtent(extent);
    layer.setZIndex(drawn ? drawingLayerPriority(id) : 0);
  }
}
// Land cover and territories sit below routes and located sites, for drawing and native picking.
const drawingLayerPriorities: Record<string, number> = {
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
function drawingLayerPriority(id: string) {
  return drawingLayerPriorities[id] ?? -5;
}
function addOcean(engine: MapEngine, input: DrawnMapInput, footprint: Geometry) {
  const source = engine.drawn.getSource()!;
  for (const ocean of drawingOceans(input.features, input.base)) {
    source.addFeature(
      painted(ocean, input.view.style === "ink" ? "#e1e1d2" : "#b4cfca", "#7b897b", -90)
    );
    const box = bounds(footprint);
    source.addFeatures(coastEchoes(ocean, (box[2] - box[0]) / terrainSymbolsAcrossSubject));
  }
}
export function territoryWashes(input: DrawnMapInput) {
  const layer = input.styles.find((s) => s.layerId === "sovereignty");
  if (!layer?.visible) return [];
  const geography = drawingGeography(input.features, input.base);
  return input.features
    .filter((f) => f.layerId === "sovereignty")
    .flatMap((f) => {
      if (!territoryShown(input, f, layer)) return [];
      const shape = geography.get(f.id);
      if (!shape) return [];
      const type = describeFeature(input.world, f);
      const own = layer.types?.[type.id] ?? {};
      const color =
        own.color ?? (input.view.style === "ink" ? "#594b36" : atlasColour(polityIdentity(f)));
      const result = painted(
        shape,
        color + (input.view.style === "ink" ? "12" : "8c"),
        "#00000000",
        -70,
        layer.opacity * (own.opacity ?? 1)
      );
      return [result];
    });
}
function territoryShown(input: DrawnMapInput, feature: AtlasFeature, layer: LayerStyle) {
  const override = input.view.overrides[feature.id];
  return (
    presentedFeatureStyle(input.world, feature, layer).visible &&
    !override?.hidden &&
    !override?.illustrationHidden
  );
}
function updateMask(engine: MapEngine, footprint: Geometry, clip: boolean) {
  engine.drawn.set("covers", clip ? spatial.pointCoverage(footprint) : null);
  const source = engine.drawnMask.getSource()!;
  source.clear();
  if (!clip) return;
  const outside = spatial.difference(engine.reference.domain, footprint);
  if (outside) source.addFeature(painted(outside, "#eee4c9", "#c9b995", 0));
}
function painted(geometry: Geometry, color: string, outline: string, zIndex: number, opacity = 1) {
  const feature = new Feature({ geometry: new GeoJSON().readGeometry(geometry)! });
  const rgba = [...asArray(color)];
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
