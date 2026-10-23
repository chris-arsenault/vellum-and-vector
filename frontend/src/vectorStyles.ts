import LineString from "ol/geom/LineString.js";
import { Circle, Fill, Stroke, Style, Text } from "ol/style.js";
import type { AtlasFeature, LayerStyle } from "./types";
import type { Style as SymbolStyle, Symbolizer } from "geostyler-style";
import { biomeFamilies } from "@atlas/domain";
import { settlementStyle } from "./settlementStyles";

export function defaultSymbolStyle(
  name: string,
  style: LayerStyle,
  geometries: string[]
): SymbolStyle {
  const kinds = new Set(geometries);
  if (style.layerId === "ecology") kinds.add("Polygon");
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
  return geographicStyle(feature, style, resolution);
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
        feature.kind === "fault" ? [6, 4] : feature.layerId === "claims" ? [7, 5] : undefined,
    }),
    fill: new Fill({ color: color + (feature.layerId === "geology" ? "18" : "64") }),
    image: new Circle({
      radius: feature.layerId === "geology" ? 2 : feature.kind === "settlement" ? 4 : 5,
      fill: new Fill({ color }),
      stroke: new Stroke({ color: "#233638", width: 1.5 }),
    }),
  });
  return profiledLineStyles(feature, result, color, resolution);
}
function featureStrokeWidth(feature: AtlasFeature, resolution: number) {
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
  if (feature.kind !== "river") return 2;
  return channelStrokeWidth(riverWidth(feature), resolution);
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
