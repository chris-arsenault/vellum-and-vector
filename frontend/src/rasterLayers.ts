import LayerGroup from "ol/layer/Group.js";
import WebGLTile from "ol/layer/WebGLTile.js";
import type { MapEngine } from "./mapEngine";
import type { Raster, RasterPresentation, World } from "./types";
import { numericTileSource } from "./numericTiles";
import { defaultFieldStyle, fieldLabel, fieldRange } from "./rasterPresentation";
import { overlayStyle, overlayVariables, terrainStyle, terrainVariables } from "./rasterStyles";

function groupFor(parent: LayerGroup, key: string, title: string) {
  let group = parent
    .getLayers()
    .getArray()
    .find((layer) => layer.get("key") === key) as LayerGroup | undefined;
  if (!group) {
    group = new LayerGroup({ properties: { key, title, openInLayerSwitcher: false } });
    parent.getLayers().push(group);
  }
  return group;
}
function updateParts(
  engine: MapEngine,
  group: LayerGroup,
  data: Raster[],
  style: ReturnType<typeof terrainStyle>,
  signature: string
) {
  const layers = group.getLayers();
  const wanted = new Set(data.map((raster) => raster.id));
  for (const layer of layers.getArray().slice())
    if (!wanted.has(layer.get("fieldId"))) {
      layers.remove(layer);
      layer.dispose();
    }
  for (const [index, raster] of data.entries()) {
    let layer = layers.getArray().find((layer) => layer.get("fieldId") === raster.id) as
      WebGLTile | undefined;
    if (!layer) {
      layer = new WebGLTile({
        style,
        properties: { fieldId: raster.id, displayInLayerSwitcher: false },
      });
      layers.push(layer);
      layer.set("signature", signature);
    }
    if (layer.get("raster") !== raster) {
      layer.setSource(numericTileSource(raster, engine.map.getView().getProjection()));
      layer.set("raster", raster);
    }
    if (layer.get("signature") !== signature) {
      layer.setStyle(style);
      layer.set("signature", signature);
    } else layer.updateStyleVariables(style.variables as Record<string, number>);
    if (layers.item(index) !== layer) {
      layers.remove(layer);
      layers.insertAt(index, layer);
    }
  }
}

export function updateRaster(
  engine: MapEngine,
  world: World,
  data: Raster[],
  base: Raster[],
  view: RasterPresentation
) {
  for (const name of ["relief", "topographic"] as const) {
    const group = groupFor(engine.image, name, name === "topographic" ? "Topographic" : "Relief");
    group.set("baseLayer", true);
    group.setVisible(view.base === name);
    group.setOpacity(1);
    updateParts(
      engine,
      group,
      base,
      { ...terrainStyle(view), variables: terrainVariables({ ...view, base: name }) },
      "terrain"
    );
  }
  const channels = new Set(data.map((raster) => raster.channel));
  for (const layer of engine.overlay.getLayers().getArray().slice()) {
    if (channels.has(layer.get("channel"))) continue;
    engine.overlay.getLayers().remove(layer);
    layer.dispose();
  }
  const order = [...view.fields.map((field) => field.channel), ...channels].filter(
    (channel, index, all) => channels.has(channel) && all.indexOf(channel) === index
  );
  for (const channel of order.slice().reverse()) {
    const parts = data.filter((raster) => raster.channel === channel);
    const field = view.fields.find((field) => field.channel === channel) ?? {
      ...defaultFieldStyle(channel),
      visible: false,
    };
    const group = groupFor(engine.overlay, channel, fieldLabel(world, channel));
    group.set("channel", channel);
    group.setVisible(field.visible);
    group.setOpacity(field.opacity);
    const range = fieldRange(parts, field);
    updateParts(
      engine,
      group,
      parts,
      { ...overlayStyle(field, range), variables: overlayVariables(field, range) },
      `${field.palette}:${field.scale}`
    );
  }
  reorderFields(engine, order);
}
function reorderFields(engine: MapEngine, order: string[]) {
  const layers = engine.overlay.getLayers();
  order
    .slice()
    .reverse()
    .forEach((channel, index) => {
      const layer = layers.getArray().find((layer) => layer.get("channel") === channel)!;
      if (layers.item(index) === layer) return;
      layers.remove(layer);
      layers.insertAt(index, layer);
    });
}
