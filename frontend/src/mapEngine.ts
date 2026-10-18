import Map from "ol/Map.js";
import View from "ol/View.js";
import Projection from "ol/proj/Projection.js";
import VectorLayer from "ol/layer/Vector.js";
import ImageLayer from "ol/layer/Image.js";
import LayerGroup from "ol/layer/Group.js";
import VectorSource from "ol/source/Vector.js";
import ImageStatic from "ol/source/ImageStatic.js";
import GeoJSON from "ol/format/GeoJSON.js";
import { Circle, Fill, Stroke, Style, Text } from "ol/style.js";
import { ScaleLine } from "ol/control.js";
import { defaults as defaultInteractions } from "ol/interaction/defaults.js";
import { bounds, rasterImage } from "./presentation";
import type { Area, AtlasFeature, LayerStyle, Raster, World } from "./types";

const format = new GeoJSON();
export function createMap(target: HTMLElement, reference: World["reference"]) {
  target.tabIndex = 0;
  const extent = bounds(reference.domain);
  const projection = new Projection({ code: reference.id, units: "m", extent });
  const image = new LayerGroup();
  const overlay = new LayerGroup();
  const features = new VectorLayer({ source: new VectorSource({ wrapX: false }) });
  const areas = new VectorLayer({ source: new VectorSource({ wrapX: false }) });
  const preview = new VectorLayer({
    source: new VectorSource({ wrapX: false }),
    style: new Style({
      stroke: new Stroke({ color: "#f8d589", width: 3, lineDash: [8, 5] }),
      fill: new Fill({ color: "#f8d58933" }),
    }),
  });
  const map = new Map({
    target,
    interactions: defaultInteractions({ dragPan: false, doubleClickZoom: false }),
    layers: [image, overlay, features, areas, preview],
    view: new View({
      projection,
      center: [(extent[0] + extent[2]) / 2, (extent[1] + extent[3]) / 2],
      resolution: (extent[2] - extent[0]) / 800,
    }),
  });
  map.addControl(new ScaleLine({ units: "metric" }));
  return { map, image, overlay, features, areas, preview };
}
export type MapEngine = ReturnType<typeof createMap>;

export function updateFeatures(
  engine: MapEngine,
  world: World,
  area: Area,
  styles: LayerStyle[],
  scene: AtlasFeature[]
) {
  const source = engine.features.getSource()!;
  const wanted = new Set(scene.map((feature) => feature.id));
  for (const feature of source.getFeatures())
    if (!wanted.has(String(feature.getId()))) source.removeFeature(feature);
  scene.forEach((feature) => {
    const presented = feature;
    let ol = source.getFeatureById(feature.id);
    if (!ol) {
      ol = format.readFeatures({
        type: "Feature",
        id: feature.id,
        geometry: presented.geometry,
        properties: { domain: presented },
      })[0];
      source.addFeature(ol);
    } else {
      const geometry = format.writeGeometryObject(ol.getGeometry()!);
      if (JSON.stringify(geometry) !== JSON.stringify(presented.geometry))
        ol.setGeometry(format.readGeometry(presented.geometry)!);
      ol.set("domain", presented);
    }
    ol.setStyle((_feature, resolution) =>
      featureStyle(
        presented,
        styles.find((s) => s.layerId === feature.layerId),
        resolution,
        styles.length - styles.findIndex((s) => s.layerId === feature.layerId)
      )
    );
  });
  const areas = engine.areas.getSource()!;
  engine.areas.set("currentArea", area.id);
  areas.clear();
  for (const child of Object.values(world.areas).filter(
    (a) => a.parentId === area.id || a.id === area.id
  )) {
    const ol = format.readFeatures({
      type: "Feature",
      geometry: child.footprint,
      properties: { area: child },
    })[0];
    ol.setStyle(
      new Style({
        stroke: new Stroke({
          color: child.id === area.id ? "#ebdfba" : "#f3dab0",
          width: 1.5,
          lineDash: [7, 5],
        }),
        text: new Text({
          text: child.id === area.id ? "" : child.name,
          fill: new Fill({ color: "#faf1cf" }),
          stroke: new Stroke({ color: "#203739", width: 3 }),
          font: "13px system-ui",
        }),
      })
    );
    areas.addFeature(ol);
  }
}

function featureStyle(
  feature: AtlasFeature,
  style: LayerStyle | undefined,
  resolution: number,
  order: number
) {
  if (!style?.visible || resolution < style.minScale) return new Style({});
  if (
    style.filter &&
    !JSON.stringify([feature.name, feature.attributes])
      .toLowerCase()
      .includes(style.filter.toLowerCase())
  )
    return new Style({});
  const color = style.color;
  const opacity = Math.round(style.opacity * 255)
    .toString(16)
    .padStart(2, "0");
  return new Style({
    zIndex: order,
    text: style.labels
      ? new Text({
          text: feature.name,
          font: "12px system-ui",
          fill: new Fill({ color }),
          stroke: new Stroke({ color: "#203739", width: 3 }),
        })
      : undefined,
    stroke: new Stroke({
      color: color + opacity,
      width: feature.kind === "river" ? 1.7 : 2,
      lineDash: feature.layerId === "claims" ? [7, 5] : undefined,
    }),
    fill: new Fill({
      color:
        color +
        Math.round(style.opacity * 100)
          .toString(16)
          .padStart(2, "0"),
    }),
    image: new Circle({
      radius: feature.kind === "settlement" ? 4 : 5,
      fill: new Fill({ color }),
      stroke: new Stroke({ color: "#233638", width: 1.5 }),
    }),
  });
}

export function updateRaster(
  engine: MapEngine,
  raster: Raster[] | undefined,
  base: Raster[] | undefined,
  styles: LayerStyle[]
) {
  const apply = (group: LayerGroup, data: Raster[]) => {
    const layers = group.getLayers();
    const wanted = new Set(data.map((raster) => `${raster.id}:${raster.channel}`));
    for (const layer of layers.getArray().slice())
      if (!wanted.has(String(layer.get("rasterKey")))) layers.remove(layer);
    const limits = rasterLimits(data);
    for (const [index, raster] of data.entries()) {
      const key = raster.channel.split(":")[0];
      const id = rasterLayer(key);
      const style = styles.find((item) => item.layerId === id);
      const rasterKey = `${raster.id}:${raster.channel}`;
      let layer = layers.getArray().find((layer) => layer.get("rasterKey") === rasterKey) as
        ImageLayer<ImageStatic> | undefined;
      if (!layer) {
        layer = new ImageLayer<ImageStatic>();
        layer.set("rasterKey", rasterKey);
        layers.insertAt(index, layer);
      }
      if (layer.get("raster") !== raster || layer.get("limits") !== limits.join(",")) {
        layer.setSource(
          new ImageStatic({
            url: rasterImage(raster, limits),
            projection: engine.map.getView().getProjection(),
            imageExtent: raster.bounds,
          })
        );
        layer.set("raster", raster);
        layer.set("limits", limits.join(","));
      }
      applyRasterStyle(layer, style);
      if (layers.item(index) !== layer) {
        layers.remove(layer);
        layers.insertAt(index, layer);
      }
    }
  };
  apply(engine.image, base ?? []);
  apply(
    engine.overlay,
    (raster ?? []).filter((r) => r.channel !== "elevation")
  );
}
export function fitArea(engine: MapEngine, area: Area) {
  engine.map.getView().fit(bounds(area.footprint), { padding: [35, 35, 35, 35] });
}
function rasterLimits(data: Raster[]) {
  const limits = [0, 1];
  for (const raster of data)
    for (const value of raster.values) {
      if (!Number.isFinite(value)) continue;
      limits[0] = Math.min(limits[0], value);
      limits[1] = Math.max(limits[1], value);
    }
  return limits;
}
function applyRasterStyle(layer: ImageLayer<ImageStatic>, style: LayerStyle | undefined) {
  layer.setVisible(style?.visible ?? true);
  layer.setOpacity(style?.opacity ?? 1);
}

function rasterLayer(channel: string) {
  const layers: Record<string, string> = {
    culture: "cultures",
    language: "languages",
    religion: "religions",
    magic: "magic",
    people: "cultures",
    population: "cultures",
    speakers: "languages",
    faith: "religions",
    temperature: "climate",
    moisture: "climate",
    rainfall: "climate",
    snowfall: "climate",
    ice: "climate",
    rock: "geology",
    fracture: "geology",
    bedrock: "geology",
    sediment: "geology",
    geothermal: "geology",
    naturalSurface: "geology",
    finalSurface: "geology",
    physicalMaterial: "geology",
    reach: "sovereignty",
    sovereignty: "sovereignty",
    claim: "claims",
    control: "control",
  };
  return layers[channel] ?? channel;
}
