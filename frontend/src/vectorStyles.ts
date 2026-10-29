import LineString from "ol/geom/LineString.js";
import { Circle, Fill, RegularShape, Stroke, Style, Text } from "ol/style.js";
import type { AtlasFeature, LayerStyle } from "./types";
import type { Style as SymbolStyle, Symbolizer, WellKnownName } from "geostyler-style";
import {
  biomeFamilies,
  magicPlacePresentation,
  magicPlacePresentations,
  type MagicPlaceSymbol,
} from "@atlas/domain";
import { settlementStyle } from "./settlementStyles";

const wellKnownMarks: Record<MagicPlaceSymbol, WellKnownName> = {
  circle: "circle",
  square: "square",
  diamond: "square",
  triangle: "triangle",
  star: "star",
  cross: "cross",
};
/** Magic places keep their rule colour and mark so a spring never looks like a crush zone. */
function magicSymbolRules(symbolizers: Symbolizer[]) {
  return [
    ...Object.entries(magicPlacePresentations).map(([rule, presentation]) => ({
      name: rule.replace(/^./, (c) => c.toUpperCase()),
      filter: ["==", "rule", rule] as ["==", string, string],
      symbolizers: symbolizers.map((symbol) => ({
        ...symbol,
        color: presentation.color,
        ...(symbol.kind === "Fill" ? { outlineColor: presentation.color } : {}),
        ...(symbol.kind === "Mark" ? { wellKnownName: wellKnownMarks[presentation.symbol] } : {}),
      })),
    })),
    { name: "Other magical places", elseRule: true, symbolizers },
  ];
}

export function defaultSymbolStyle(
  name: string,
  style: LayerStyle,
  geometries: string[]
): SymbolStyle {
  const kinds = new Set(geometries);
  if (["ecology", "magic"].includes(style.layerId)) kinds.add("Polygon");
  const symbolizers: Symbolizer[] = [];
  if ([...kinds].some((kind) => kind.includes("Polygon")))
    symbolizers.push({
      kind: "Fill",
      color: style.color,
      fillOpacity: 0.3,
      outlineColor: style.color,
      outlineWidth: 2,
    });
  if ([...kinds].some((kind) => kind.includes("Line")))
    symbolizers.push({ kind: "Line", color: style.color, width: 2 });
  if (!symbolizers.length || [...kinds].some((kind) => kind.includes("Point")))
    symbolizers.push({ kind: "Mark", wellKnownName: "circle", color: style.color, radius: 5 });
  if (style.labels)
    symbolizers.push({ kind: "Text", label: "{{name}}", color: style.color, size: 12 });
  if (style.layerId === "magic") return { name, rules: magicSymbolRules(symbolizers) };
  if (style.layerId !== "ecology") return { name, rules: [{ name: "Default", symbolizers }] };
  return {
    name,
    rules: [
      ...biomeFamilies.map((biome) => ({
        name: biome.name,
        filter: ["==", "kind", biome.kind] as ["==", string, string],
        symbolizers: symbolizers.map((symbol) => ({
          ...symbol,
          color: biome.color,
          ...(symbol.kind === "Fill" ? { outlineColor: biome.color } : {}),
        })),
      })),
      { name: "Other ecological features", elseRule: true, symbolizers },
    ],
  };
}

export function featureStyle(feature: AtlasFeature, style: LayerStyle, resolution: number) {
  if (
    style.filter &&
    !JSON.stringify([feature.name, feature.attributes])
      .toLowerCase()
      .includes(style.filter.toLowerCase())
  )
    return [];
  if (feature.kind === "settlement") return settlementStyle(feature, style);
  if (feature.kind === "politicalRegion")
    return new Style({
      stroke: new Stroke({ color: style.color, width: 0.7, lineDash: [6, 4] }),
      text: style.labels
        ? new Text({
            text: feature.name,
            font: "11px system-ui",
            fill: new Fill({ color: style.color }),
          })
        : undefined,
    });
  if (style.layerId === "magic" && typeof feature.attributes.rule === "string")
    return magicPlaceStyle(feature, style);
  return geographicStyle(feature, style, resolution);
}
function magicMark(symbol: MagicPlaceSymbol, color: string) {
  const base = {
    radius: 6,
    fill: new Fill({ color }),
    stroke: new Stroke({ color: "#233638", width: 1.5 }),
  };
  switch (symbol) {
    case "square":
      return new RegularShape({ ...base, points: 4, angle: Math.PI / 4 });
    case "diamond":
      return new RegularShape({ ...base, points: 4, angle: 0 });
    case "triangle":
      return new RegularShape({ ...base, points: 3 });
    case "star":
      return new RegularShape({ ...base, radius: 7, radius2: 3, points: 5 });
    case "cross":
      return new RegularShape({ ...base, points: 4, radius2: 0, angle: 0 });
    default:
      return new Circle({ ...base, radius: 5 });
  }
}
/** Generated magic places: colour and mark follow the classification rule, not the layer. */
function magicPlaceStyle(feature: AtlasFeature, style: LayerStyle) {
  const { color, symbol } = magicPlacePresentation(String(feature.attributes.rule));
  return new Style({
    text: style.labels
      ? new Text({
          text: feature.name,
          font: "12px system-ui",
          fill: new Fill({ color }),
          stroke: new Stroke({ color: "#203739", width: 3 }),
        })
      : undefined,
    stroke: new Stroke({ color, width: 1.5 }),
    fill: new Fill({ color: color + "66" }),
    image: magicMark(symbol, color),
  });
}
function geographicStyle(feature: AtlasFeature, style: LayerStyle, resolution: number) {
  const color = ecologicalColor(feature) ?? style.color;
  const result = new Style({
    text: style.labels
      ? new Text({
          text: feature.name,
          font: "12px system-ui",
          fill: new Fill({ color }),
          stroke: new Stroke({ color: "#203739", width: 3 }),
        })
      : undefined,
    stroke: new Stroke({
      color,
      width: featureStrokeWidth(feature, resolution),
      lineDash:
        feature.kind === "fault"
          ? [6, 4]
          : feature.layerId === "claims"
            ? [7, 5]
            : routeLineDash(feature),
    }),
    fill: new Fill({ color: color + (feature.layerId === "geology" ? "18" : "64") }),
    image: new Circle({
      radius: pointRadius(feature),
      fill: new Fill({ color }),
      stroke: new Stroke({ color: "#233638", width: 1.5 }),
    }),
  });
  return profiledLineStyles(feature, result, color, resolution);
}
/** A landmark stands out from the detected landforms around it. */
function pointRadius(feature: AtlasFeature) {
  if (feature.kind === "landmark") return 6;
  if (feature.layerId === "geology") return 2;
  return feature.kind === "settlement" ? 4 : 5;
}
function featureStrokeWidth(feature: AtlasFeature, resolution: number) {
  if (feature.kind === "landmark") return 2.5;
  return feature.layerId === "geology"
    ? Math.min(1, 0.4 + 600 / resolution)
    : physicalStrokeWidth(feature, resolution);
}
function ecologicalColor(feature: AtlasFeature) {
  if (feature.layerId !== "ecology") return null;
  return biomeFamilies.find((biome) => biome.kind === feature.kind)?.color;
}
function profiledLineStyles(feature: AtlasFeature, base: Style, color: string, resolution: number) {
  const widths = feature.attributes.widths;
  if (
    feature.geometry.type !== "LineString" ||
    !Array.isArray(widths) ||
    widths.length !== feature.geometry.coordinates.length ||
    (feature.kind === "river" && riverWidth(feature) / resolution <= 1)
  )
    return base;
  base.setStroke(null);
  const coordinates = feature.geometry.coordinates;
  return [
    base,
    ...coordinates.slice(1).map(
      (coordinate, i) =>
        new Style({
          geometry: new LineString([coordinates[i], coordinate]),
          stroke: new Stroke({
            color,
            width: segmentWidth(
              feature,
              (Number(widths[i]) + Number(widths[i + 1])) / 2,
              resolution
            ),
          }),
        })
    ),
  ];
}
function physicalStrokeWidth(feature: AtlasFeature, resolution: number) {
  if (feature.kind === "fault") return 1;
  if (feature.layerId === "roads") return routeStrokeWidth(feature);
  if (feature.kind !== "river") return 2;
  return channelStrokeWidth(riverWidth(feature), resolution);
}
/** Routes read by class: a track is thin, a road fuller, a highway bold, a lane light. */
const routeWidths: Record<string, number> = { track: 0.9, road: 1.8, highway: 2.8, lane: 1.2 };
function routeStrokeWidth(feature: AtlasFeature) {
  if (feature.kind === "lane") return routeWidths.lane;
  return routeWidths[String(feature.attributes.roadClass ?? "road")] ?? routeWidths.road;
}
/** Tracks and sea lanes are broken lines; roads and highways are solid. */
function routeLineDash(feature: AtlasFeature) {
  if (feature.layerId !== "roads") return undefined;
  if (feature.kind === "lane") return [6, 6];
  return feature.attributes.roadClass === "track" ? [3, 3] : undefined;
}
function riverWidth(feature: AtlasFeature) {
  const samples = feature.attributes.widths;
  const width = Array.isArray(samples)
    ? samples.reduce<number>(
        (maximum, value) =>
          typeof value === "number" && Number.isFinite(value) ? Math.max(maximum, value) : maximum,
        0
      )
    : Number(feature.attributes.width ?? 0);
  return Number.isFinite(width) && width > 0 ? width : 10;
}
function channelStrokeWidth(width: number, resolution: number) {
  // Unresolved rivers retain a width hierarchy. At close zoom the measured
  // channel width, in metres per pixel, becomes the visible bank-to-bank width.
  const symbol = 0.35 + 0.35 * Math.log2(1 + width / 10);
  return Math.max(symbol, width / resolution);
}
function segmentWidth(feature: AtlasFeature, width: number, resolution: number) {
  return feature.kind === "river"
    ? channelStrokeWidth(width, resolution)
    : Math.max(1.7, width / resolution);
}
