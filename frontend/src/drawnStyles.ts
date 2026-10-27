import { Circle, Fill, Stroke, Style, Text } from "ol/style.js";
import GeoJSON from "ol/format/GeoJSON.js";
import Point from "ol/geom/Point.js";
import type { AtlasFeature, LayerStyle, World } from "./types";
import type { CartographicPresentation, CartographicOverride } from "@atlas/domain";
import { drawnIcon, atlasColour } from "./drawnSymbols";
import { settlementPriority } from "./settlementStyles";
import { featureStyle } from "./vectorStyles";
import { bounds, defaultStyles } from "./presentation";
import { drawnLabelGeometry, labelScope } from "./drawnLabels";
import type { Geometry } from "geojson";
import type { DrawingGeography } from "./drawnGeography";
import { biomeStyle } from "./drawnEcology";
import { drawnPlace, placeMark, placeAnchor } from "./drawnPlaces";
import { describeFeature } from "@atlas/domain";
import { drawnMagic } from "./drawnMagic";

export interface DrawnStyleContext {
  world: World;
  view: CartographicPresentation;
  footprint?: Geometry;
  geography?: DrawingGeography;
  features?: AtlasFeature[];
}
const ink = "#53452f",
  paper = "#eee4c9",
  water = "#a7c4c0";
export function defaultDrawnStyles(world: World, subject: CartographicPresentation["subject"]) {
  return defaultStyles(world, subject).map((layer) => ({
    ...layer,
    opacity: 1,
    ...(layer.layerId === "geology"
      ? {
          types: {
            [describeFeature(world, { kind: "fault", layerId: "geology", attributes: {} }).id]: {
              visible: false,
            },
          },
        }
      : {}),
    visible:
      (layer.visible ||
        [
          "roads",
          "pois",
          "magic",
          "ruins",
          "transportSites",
          "waterworks",
          "institutions",
          "magicPractices",
        ].includes(layer.layerId)) &&
      !["control", "claims", "administration"].includes(layer.layerId),
    labels: [
      "settlements",
      "sovereignty",
      "rivers",
      "lakes",
      "roads",
      "ecology",
      "pois",
      "ruins",
      "magic",
      "geology",
      "transportSites",
      "waterworks",
      "institutions",
      "magicPractices",
    ].includes(layer.layerId),
  }));
}
export function polityIdentity(feature: AtlasFeature) {
  return (
    feature.relations.find((r) =>
      ["sovereign", "controlledBy", "claimedBy", "administeredBy"].includes(r.kind)
    )?.targetId ?? feature.id
  );
}
export function cartographicFeatureStyle(
  feature: AtlasFeature,
  style: LayerStyle,
  resolution: number,
  context: DrawnStyleContext
): Style[] {
  if (!drawingVisible(feature, style, context)) return [];
  const shape = context.geography?.get(feature.id);
  if (shape === null) return [];
  const depicted = shape ? { ...feature, geometry: shape } : feature;
  const result = illustrationStyle(depicted, style, resolution, context);
  const name = cartographicName(feature, context.world);
  if (labelEnabled(feature, style, context) && name)
    result.push(labelStyle(depicted, name, context, resolution));
  if (shape && shape !== feature.geometry) applyDrawingShape(result, shape);
  return result;
}
function drawingVisible(f: AtlasFeature, style: LayerStyle, c: DrawnStyleContext) {
  return !c.view.overrides[f.id]?.hidden && !hiddenFault(f, style, c);
}
function labelEnabled(f: AtlasFeature, style: LayerStyle, c: DrawnStyleContext) {
  return style.labels && c.view.labels && !c.view.overrides[f.id]?.labelHidden;
}
const renderShapes = new WeakMap<Geometry, import("ol/geom/Geometry.js").default>();
function applyDrawingShape(styles: Style[], shape: Geometry) {
  let geometry = renderShapes.get(shape);
  if (!geometry) {
    geometry = new GeoJSON().readGeometry(shape)!;
    renderShapes.set(shape, geometry);
  }
  for (const style of styles) if (!style.getGeometry()) style.setGeometry(geometry);
}
function hiddenFault(f: AtlasFeature, style: LayerStyle, c: DrawnStyleContext) {
  // Older maps published the computational fault traces in geology, instead of the optional faults layer.
  return (
    f.kind === "fault" &&
    f.layerId === "geology" &&
    style.types?.[describeFeature(c.world, f).id]?.visible !== true
  );
}
function illustrationStyle(
  f: AtlasFeature,
  layer: LayerStyle,
  resolution: number,
  context: DrawnStyleContext
): Style[] {
  const own = context.view.overrides[f.id];
  if (own?.illustrationHidden) return [];
  if (f.geometry.type.includes("Point") && own?.symbol && own.symbol !== "auto")
    return [
      new Style({
        image: drawnIcon(own.symbol, 24, context.view.style === "ink"),
        zIndex: settlementPriority(f),
      }),
    ];
  return shapeStyle(f, layer, resolution, context);
}
export function cartographicName(feature: AtlasFeature, world: World) {
  const entity = world.entities[polityIdentity(feature)];
  return entity?.name ?? feature.name;
}
/** A magic landmark is a major place, drawn with the landmark marks rather than as a field. */
function magicStyle(
  f: AtlasFeature,
  layer: LayerStyle,
  resolution: number,
  c: DrawnStyleContext
): Style[] {
  const place = f.kind === "landmark" ? drawnPlace(f, c.view.style === "ink") : null;
  if (place) return [place];
  return drawnMagic(f, layer, c.world, resolution, c.view.subject === "physical");
}
function shapeStyle(
  f: AtlasFeature,
  layer: LayerStyle,
  resolution: number,
  c: DrawnStyleContext
): Style[] {
  const special = specialStyle(f, c);
  if (special) return [special];
  if (f.layerId === "magic") return magicStyle(f, layer, resolution, c);
  if (["sovereignty", "control", "claims", "administration"].includes(f.layerId))
    return [territory(f, c)];
  if (f.kind === "river") return river(f, layer, resolution, c);
  if (f.kind === "road")
    return [
      new Style({
        stroke: new Stroke({
          color: ink,
          width: c.view.subject === "infrastructure" ? 2 : 1,
          lineDash: [3, 3],
        }),
      }),
    ];
  if (["ocean", "lake"].includes(f.kind))
    return [
      new Style({
        fill: new Fill({ color: c.view.style === "ink" ? "#e2e2d4" : water }),
        stroke: new Stroke({ color: ink, width: 1.2 }),
      }),
    ];
  return [landmark(f, c)];
}
function specialStyle(f: AtlasFeature, c: DrawnStyleContext) {
  if (f.kind === "settlement") return settlement(f, c);
  if (f.kind === "fault")
    return new Style({ stroke: new Stroke({ color: "#8d8170", width: 0.7, lineDash: [2, 5] }) });
  if (f.kind === "ocean") return new Style({ fill: new Fill({ color: "#00000000" }) });
  return biomeStyle(f, c.view.style === "ink") ?? drawnPlace(f, c.view.style === "ink");
}
function river(
  f: AtlasFeature,
  layer: LayerStyle,
  resolution: number,
  c: DrawnStyleContext
): Style[] {
  const result = featureStyle(
    f,
    { ...layer, color: c.view.style === "ink" ? ink : "#557e83", labels: false },
    resolution
  );
  return Array.isArray(result) ? result : [result];
}
function territory(f: AtlasFeature, c: DrawnStyleContext) {
  const colour = c.view.style === "ink" ? ink : atlasColour(polityIdentity(f));
  const sovereignty = f.layerId === "sovereignty";
  return new Style({
    fill: new Fill({ color: "#00000000" }),
    stroke: new Stroke({
      color: sovereignty ? "#69563f" : colour,
      width: f.layerId === "control" ? 3 : 1.2,
      lineDash: sovereignty ? undefined : [6, 4],
    }),
    zIndex: sovereignty ? -10 : -5,
  });
}
function settlement(f: AtlasFeature, c: DrawnStyleContext) {
  const own = c.view.overrides[f.id];
  const capital = f.attributes.settlementRole === "capital";
  const ruined = ["ruined", "abandoned"].includes(String(f.attributes.status));
  const automatic = ruined ? "ruin" : capital ? "castle" : "town";
  const symbol = own?.symbol && own.symbol !== "auto" ? own.symbol : automatic;
  return new Style({
    image: drawnIcon(symbol, capital ? 32 : 22, c.view.style === "ink"),
    zIndex: settlementPriority(f),
  });
}
function landmark(f: AtlasFeature, c: DrawnStyleContext) {
  const own = c.view.overrides[f.id];
  if (own?.symbol && own.symbol !== "auto")
    return new Style({ image: drawnIcon(own.symbol, 24, c.view.style === "ink") });
  if (["peak", "hill", "ruin"].includes(f.kind)) {
    const symbol = f.kind === "ruin" ? "ruin" : "mountain";
    return new Style({
      image: c.view.terrain ? drawnIcon(symbol, 24, c.view.style === "ink") : undefined,
    });
  }
  const polygon = f.geometry.type.includes("Polygon");
  return new Style({
    fill: polygon ? new Fill({ color: "#8c98651c" }) : undefined,
    stroke: polygon
      ? new Stroke({ color: "#7d825b55", width: 0.6 })
      : new Stroke({ color: ink, width: 1 }),
    image: new Circle({
      radius: 3,
      fill: new Fill({ color: ink }),
      stroke: new Stroke({ color: paper, width: 1 }),
    }),
  });
}
function labelStyle(f: AtlasFeature, name: string, c: DrawnStyleContext, resolution: number) {
  const own = c.view.overrides[f.id] ?? {};
  const polity = f.layerId === "sovereignty";
  const width = labelPixelWidth(f, c, resolution);
  return new Style({
    geometry: labelGeometry(f, c, own),
    zIndex: polity ? 1e9 : settlementPriority(f),
    text: labelVisible(f, name, own, width)
      ? new Text({
          text: polity ? name.toUpperCase() : name,
          font: labelFont(f, own, width, name.length),
          placement: labelPlacement(f, own),
          overflow: false,
          maxAngle: Math.PI / 5,
          padding: [3, 4, 3, 4],
          ...labelOffsets(f, own),
          textBaseline: f.kind === "settlement" ? "top" : "middle",
          rotation: own.rotation ?? 0,
          fill: new Fill({ color: ink }),
          stroke: new Stroke({ color: "#eee4c9dd", width: 2.5 }),
        })
      : undefined,
  });
}
function labelGeometry(f: AtlasFeature, c: DrawnStyleContext, own: CartographicOverride) {
  return !own.path && !own.anchor && placeMark(f)
    ? new Point(placeAnchor(f))
    : drawnLabelGeometry(f, c, own);
}
function labelPlacement(f: AtlasFeature, own: CartographicOverride) {
  return own.path || (f.geometry.type.includes("Line") && !placeMark(f)) ? "line" : "point";
}
function labelFont(f: AtlasFeature, own: CartographicOverride, width: number, length: number) {
  const polity = f.layerId === "sovereignty",
    capital = f.attributes.settlementRole === "capital";
  const size =
    own.size ??
    (polity ? Math.min(23, Math.max(14, width / Math.max(1, length * 0.7))) : capital ? 15 : 12);
  return `${polity || capital ? "600" : "italic"} ${size}px Georgia, serif`;
}
function labelOffsets(f: AtlasFeature, own: CartographicOverride) {
  return {
    offsetX: own.offsetX ?? 0,
    offsetY: own.offsetY ?? automaticLabelOffset(f, own),
  };
}
function automaticLabelOffset(f: AtlasFeature, own: CartographicOverride) {
  if (own.anchor) return 0;
  if (placeMark(f)) return 16;
  return f.kind === "settlement" ? 12 : 0;
}
function labelVisible(f: AtlasFeature, name: string, own: CartographicOverride, width: number) {
  if (own.anchor || own.path || f.layerId !== "sovereignty") return true;
  return width > Math.max(1, name.length * 9);
}
function labelPixelWidth(f: AtlasFeature, c: DrawnStyleContext, resolution: number) {
  if (f.layerId !== "sovereignty") return Infinity;
  const shape = labelScope(f.geometry, c.footprint);
  if (!shape || !shape.type.includes("Polygon")) return 0;
  const box = bounds(shape);
  return (box[2] - box[0]) / resolution;
}
