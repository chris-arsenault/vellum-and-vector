import LayerGroup from "ol/layer/Group.js";
import WebGLTile from "ol/layer/WebGLTile.js";
import type { MapEngine } from "./mapEngine";
import type { Raster, RasterPresentation, World } from "./types";
import {
  categoryPalette,
  defaultFieldStyle,
  fieldLabel,
  fieldRange,
  surfacePalette,
} from "./rasterPresentation";
import { overlayStyle, overlayVariables, terrainStyle, terrainVariables } from "./rasterStyles";
import type { SurfaceCategory } from "@atlas/domain";
import { configureTerrainContours } from "./terrainContours";

const classSignature = (classes: SurfaceCategory[] | null) =>
  classes ? classes.map((c) => `${c.code}${c.color}`).join("") : "";

function groupFor(parent: LayerGroup, key: string, title: string) {
  let group = parent
    .getLayers()
    .getArray()
    .find((layer) => layer.get("key") === key) as LayerGroup | undefined;
  if (!group) {
    group = new LayerGroup({ properties: { key, title } });
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
  // A layer owns the WebGL renderer, not a particular map's numerical resource.
  // Keep it through navigation and hide unused slots while references are loading.
  for (const [index, layer] of layers.getArray().entries()) layer.setVisible(index < data.length);
  for (const [index, raster] of data.entries()) {
    let layer = layers.item(index) as WebGLTile | undefined;
    if (!layer) {
      layer = new WebGLTile({
        style,
        properties: { fieldId: raster.id },
      });
      layers.push(layer);
      layer.set("signature", signature);
    }
    layer.set("fieldId", raster.id);
    layer.setVisible(true);
    const source = engine.rasters.source(raster);
    if (layer.getSource() !== source) layer.setSource(source);
    if (layer.get("signature") !== signature) {
      layer.setStyle(style);
      layer.set("signature", signature);
    } else layer.updateStyleVariables(style.variables as Record<string, number>);
    if (group === engine.image) configureTerrainContours(layer, Number(style.variables!.interval));
  }
}

export function updateRaster(
  engine: MapEngine,
  world: World,
  data: Raster[],
  base: Raster[],
  view: RasterPresentation
) {
  engine.rasters.begin();
  const surfaces = surfacePalette(world);
  updateParts(
    engine,
    engine.image,
    base,
    { ...terrainStyle(view, surfaces), variables: terrainVariables(view) },
    `terrain:${classSignature(surfaces)}`
  );
  const channels = new Set(
    view.fields.filter((field) => field.visible).map((field) => field.channel)
  );
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
    const range = fieldRange(parts, field),
      classes = categoryPalette(world, channel);
    updateParts(
      engine,
      group,
      parts,
      { ...overlayStyle(field, range, classes), variables: overlayVariables(field, range) },
      `${field.palette}:${field.scale}:${classSignature(classes)}`
    );
  }
  reorderFields(engine, order);
  engine.rasters.end();
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
