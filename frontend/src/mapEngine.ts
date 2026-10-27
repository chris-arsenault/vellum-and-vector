import OLMap from "ol/Map.js";
import Collection from "ol/Collection.js";
import type Feature from "ol/Feature.js";
import View from "ol/View.js";
import Projection from "ol/proj/Projection.js";
import VectorLayer from "ol/layer/Vector.js";
import LayerGroup from "ol/layer/Group.js";
import VectorSource from "ol/source/Vector.js";
import GeoJSON from "ol/format/GeoJSON.js";
import { Fill, Stroke, Style, Text } from "ol/style.js";
import type { StyleLike } from "ol/style/Style.js";
import { ScaleLine } from "ol/control.js";
import { defaults as defaultInteractions } from "ol/interaction/defaults.js";
import { bounds } from "./presentation";
import { typeStyle } from "./typeStyles";
import { presentedFeatureStyle } from "@atlas/domain";
import { settlementPriority } from "./settlementStyles";
import type { Area, AtlasFeature, LayerStyle, World } from "./types";
import { RasterSources } from "./RasterSources";
import type { CartographicPresentation } from "@atlas/domain";
import { drawSheet, sheetPadding } from "./drawnSheet";
import type { DrawnMapInput } from "./drawnMap";
import type { Geometry } from "geojson";
import type { DrawingGeography } from "./drawnGeography";

const format = new GeoJSON();
export function createMap(
  target: HTMLElement,
  reference: World["reference"],
  pixelRatio = globalThis.devicePixelRatio ?? 1
) {
  target.tabIndex = 0;
  const extent = bounds(reference.domain);
  const wrapX = reference.boundaryMode === "cylinder";
  const projection = new Projection({ code: reference.id, units: "m", extent, global: wrapX });
  const rasters = new RasterSources(projection);
  const image = new LayerGroup({ properties: { title: "Base map" } });
  const overlay = new LayerGroup({
    properties: { title: "Field overlays" },
  });
  const vectors = new LayerGroup({ properties: { title: "Features" } });
  const features = new VectorSource({ wrapX });
  const snapFeatures = new Collection<Feature>();
  const featureLayers = new Map<string, VectorLayer>();
  const areas = new VectorLayer({
    source: new VectorSource({ wrapX }),
    properties: { title: "Area boundaries" },
  });
  const preview = previewLayer(wrapX);
  const regions = new VectorLayer({ source: new VectorSource({ wrapX }) });
  const drawn = new VectorLayer({
    source: new VectorSource({ wrapX }),
    visible: false,
    declutter: true,
  });
  const drawnMask = new VectorLayer({ source: new VectorSource({ wrapX }), visible: false });
  const furniture = sheetLayer(drawn);
  const map = new OLMap({
    target,
    pixelRatio,
    interactions: defaultInteractions({ dragPan: false, doubleClickZoom: false }),
    layers: [image, drawn, overlay, vectors, drawnMask, areas, regions, preview, furniture],
    view: new View({
      projection,
      multiWorld: wrapX,
      // Keep the centre between the poles only; constraining the whole viewport snaps a small
      // world's fit and pan, so screen positions no longer follow the pointer.
      ...(wrapX
        ? { extent: [-Infinity, extent[1], Infinity, extent[3]], constrainOnlyCenter: true }
        : {}),
      center: [(extent[0] + extent[2]) / 2, (extent[1] + extent[3]) / 2],
      resolution: (extent[2] - extent[0]) / 800,
    }),
  });
  map.addControl(new ScaleLine({ units: "metric" }));
  map.on("change:target", () => {
    if (!map.getTarget()) rasters.dispose();
  });
  const engine = {
    reference,
    map,
    rasters,
    image,
    overlay,
    vectors,
    features,
    snapFeatures,
    featureLayers,
    areas,
    preview,
    regions,
    drawn,
    drawnMask,
    furniture,
    sync: { applying: false },
  };
  map.on("moveend", () => syncSnapping(engine));
  return engine;
}
function previewLayer(wrapX: boolean) {
  return new VectorLayer({
    source: new VectorSource({ wrapX }),
    style: new Style({
      stroke: new Stroke({ color: "#f8d589", width: 3, lineDash: [8, 5] }),
      fill: new Fill({ color: "#f8d58933" }),
    }),
  });
}
function sheetLayer(drawn: VectorLayer) {
  const layer = new VectorLayer({
    source: new VectorSource({ wrapX: false }),
    visible: false,
    className: "cartographic-sheet",
  });
  layer.on("postrender", (event) => {
    const input = drawn.get("input") as DrawnMapInput | undefined;
    if (input) drawSheet(event, input);
  });
  return layer;
}
export type MapEngine = ReturnType<typeof createMap>;
export function applyMapUpdate(engine: MapEngine, update: () => void) {
  engine.sync.applying = true;
  try {
    update();
  } finally {
    engine.sync.applying = false;
  }
}

function syncVectorLayers(engine: MapEngine, world: World, styles: LayerStyle[]) {
  for (const [id, layer] of engine.featureLayers) {
    if (world.layers[id]) continue;
    engine.vectors.getLayers().remove(layer);
    engine.featureLayers.delete(id);
  }
  for (const style of styles) {
    let layer = engine.featureLayers.get(style.layerId);
    if (!layer) {
      layer = new VectorLayer({
        source: new VectorSource({ wrapX: world.reference.boundaryMode === "cylinder" }),
        declutter: true,
        renderOrder: (a, b) =>
          settlementPriority(b.get("domain")) - settlementPriority(a.get("domain")),
        properties: { title: world.layers[style.layerId].name, layerId: style.layerId },
      });
      engine.featureLayers.set(style.layerId, layer);
      engine.vectors.getLayers().push(layer);
    }
    layer.setVisible(style.visible);
    layer.setOpacity(style.opacity);
    layer.setMinResolution(style.minScale);
    applyVectorStyle(
      layer,
      style,
      world,
      engine.vectors.get("cartography"),
      engine.vectors.get("displayFootprint"),
      engine.vectors.get("drawingGeography"),
      engine.vectors.get("scene")
    );
  }
  const collection = engine.vectors.getLayers();
  styles
    .slice()
    .reverse()
    .forEach((style, position) => {
      const layer = engine.featureLayers.get(style.layerId)!;
      if (collection.item(position) !== layer) {
        collection.remove(layer);
        collection.insertAt(position, layer);
      }
    });
}
function applyVectorStyle(
  layer: VectorLayer,
  style: LayerStyle,
  world: World,
  cartography?: CartographicPresentation,
  footprint?: Geometry,
  geography?: DrawingGeography,
  features?: AtlasFeature[]
) {
  if (
    sameVectorStyle(layer, style, world, cartography, footprint, geography) &&
    layer.get("scene") === features
  )
    return;
  layer.set("scene", features);
  layer.set("presentation", style);
  layer.set("styleSystems", world.magicSystems);
  layer.set("styleWorld", world);
  layer.set("cartography", cartography);
  layer.set("displayFootprint", footprint);
  layer.set("drawingGeography", geography);
  if (!style.symbols || cartography?.mode === "drawn") {
    layer.set("symbols", null);
    layer.setStyle(typeStyle(world, style, undefined, cartography, footprint, geography, features));
    return;
  }
  if (layer.get("symbols") === style.symbols && layer.get("parsedStyle")) {
    layer.setStyle(typeStyle(world, style, layer.get("parsedStyle")));
    return;
  }
  layer.set("symbols", style.symbols);
  void import("geostyler-openlayers-parser")
    .then(async ({ default: Parser }) => {
      const result = await new Parser().writeStyle(style.symbols!);
      if (layer.get("symbols") !== style.symbols) return;
      if (result.errors?.length) throw result.errors[0];
      layer.set("parsedStyle", result.output);
      layer.setStyle(
        typeStyle(layer.get("styleWorld"), layer.get("presentation"), result.output as StyleLike)
      );
    })
    .catch((error: unknown) => {
      layer.set("styleError", error instanceof Error ? error.message : String(error));
    });
}
function sameVectorStyle(
  layer: VectorLayer,
  style: LayerStyle,
  world: World,
  cartography?: CartographicPresentation,
  footprint?: Geometry,
  geography?: DrawingGeography
) {
  return (
    layer.get("presentation") === style &&
    layer.get("styleWorld") === world &&
    layer.get("styleSystems") === world.magicSystems &&
    layer.get("cartography") === cartography &&
    layer.get("displayFootprint") === footprint &&
    layer.get("drawingGeography") === geography
  );
}

export function updateFeatures(
  engine: MapEngine,
  world: World,
  area: Area,
  styles: LayerStyle[],
  scene: AtlasFeature[],
  cartography?: CartographicPresentation,
  footprint?: Geometry,
  geography?: DrawingGeography
) {
  engine.vectors.set("cartography", cartography);
  engine.vectors.set("displayFootprint", cartography?.clip ? footprint : undefined);
  engine.vectors.set("world", world);
  engine.vectors.set("drawingGeography", geography);
  engine.vectors.set("scene", scene);
  syncVectorLayers(engine, world, styles);
  const wanted = new Set(scene.map((feature) => feature.id));
  for (const feature of engine.features.getFeatures()) {
    if (wanted.has(String(feature.getId()))) continue;
    engine.featureLayers.get(feature.get("domain").layerId)?.getSource()!.removeFeature(feature);
    engine.features.removeFeature(feature);
  }
  for (const feature of scene) syncFeature(engine, feature);
  syncSnapping(engine);
  updateAreas(engine, world, area);
}
function syncSnapping(engine: MapEngine) {
  const visible = engine.features
    .getFeatures()
    .filter(
      (feature) =>
        engine.featureLayers.get(feature.get("domain").layerId)?.isVisible(engine.map.getView()) &&
        feature.get("typeVisible")
    );
  const wanted = new Set(visible);
  for (const feature of engine.snapFeatures.getArray().slice())
    if (!wanted.has(feature)) engine.snapFeatures.remove(feature);
  const existing = new Set(engine.snapFeatures.getArray());
  for (const feature of visible) if (!existing.has(feature)) engine.snapFeatures.push(feature);
}
function syncFeature(engine: MapEngine, feature: AtlasFeature) {
  const source = engine.featureLayers.get(feature.layerId)?.getSource();
  if (!source) return;
  let ol = engine.features.getFeatureById(feature.id);
  if (!ol) {
    ol = format.readFeatures({
      type: "Feature",
      id: feature.id,
      geometry: feature.geometry,
      properties: {
        ...feature.attributes,
        name: feature.name,
        kind: feature.kind,
        domain: feature,
      },
    })[0];
    engine.features.addFeature(ol);
  } else {
    const previous = ol.get("domain") as AtlasFeature;
    if (previous === feature) {
      const world = engine.vectors.get("world") as World;
      const layer = engine.featureLayers.get(feature.layerId)!;
      ol.set(
        "typeVisible",
        presentedFeatureStyle(world, feature, layer.get("presentation")).visible
      );
      return;
    }
    if (previous.layerId !== feature.layerId)
      engine.featureLayers.get(previous.layerId)?.getSource()!.removeFeature(ol);
    if (
      JSON.stringify(format.writeGeometryObject(ol.getGeometry()!)) !==
      JSON.stringify(feature.geometry)
    )
      ol.setGeometry(format.readGeometry(feature.geometry)!);
    removeOldAttributes(ol, previous, feature);
    ol.setProperties({
      ...feature.attributes,
      name: feature.name,
      kind: feature.kind,
      domain: feature,
    });
  }
  if (!source.hasFeature(ol)) source.addFeature(ol);
  const world = engine.vectors.get("world") as World;
  const layer = engine.featureLayers.get(feature.layerId)!;
  ol.set("typeVisible", presentedFeatureStyle(world, feature, layer.get("presentation")).visible);
}
function removeOldAttributes(ol: Feature, previous: AtlasFeature, feature: AtlasFeature) {
  for (const key of Object.keys(previous.attributes))
    if (!(key in feature.attributes)) ol.unset(key);
}
function updateAreas(engine: MapEngine, world: World, area: Area) {
  const source = engine.areas.getSource()!;
  const signature = JSON.stringify([
    area.id,
    Object.values(world.areas)
      .filter((a) => a.parentId === area.id || a.id === area.id)
      .map((a) => [a.id, a.name, a.footprint]),
  ]);
  if (source.get("signature") === signature) return;
  source.set("signature", signature);
  engine.areas.set("currentArea", area.id);
  source.clear();
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
    source.addFeature(ol);
  }
}
export function fitArea(engine: MapEngine, area: Pick<Area, "footprint">) {
  engine.map.getView().fit(bounds(area.footprint), {
    padding: engine.drawn.getVisible()
      ? sheetPadding(engine.drawn.get("input"), engine.map.getSize()?.[0] ?? 1200)
      : [35, 35, 35, 35],
  });
}
