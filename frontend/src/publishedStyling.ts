import type { MapDescriptor, MapReader, MapLayer } from "@atlas/map";
import type { CartographicPresentation } from "./types";
import type { PublishedPresentation } from "./PublishedMapView";
import type { RasterDescription } from "./RasterAppearanceControls";
import type { OverlayChoice } from "./OverlayCatalogue";
import type { ThemeType } from "./FeatureThemeControls";
import { defaultCartographicPresentation } from "./cartographicPresentation";
import { defaultRasterPresentation } from "./rasterDefaults";
import { publishedStyles, publishedDrawnStyles } from "./publishedAppearance";
import { socialFieldChannel } from "./fieldDepiction";
import { defaultRealScalePresentation, realScaleStyles } from "./realScale";

export interface PublishedStyleContext {
  map: MapDescriptor;
  reader: MapReader;
  value: PublishedPresentation;
  change(value: PublishedPresentation): void;
}
export function initialPublishedPresentation(map: MapDescriptor): PublishedPresentation {
  const styles = publishedStyles(map);
  return {
    styles: map.realScale ? realScaleStyles(styles) : styles,
    rasterStyles: null,
    raster: defaultRasterPresentation(),
    drawing: defaultCartographicPresentation(),
    footprint: map.footprint,
    ancestry: [],
    ...(map.realScale ? { realScale: defaultRealScalePresentation() } : {}),
  };
}
export function publishedRasterDescription(layer: MapLayer): RasterDescription {
  if (layer.source.kind !== "raster") throw new Error("Expected a map raster.");
  const band = layer.source.data.bands[0];
  const range = band.range ?? [0, 1];
  return {
    channel: layer.id,
    name: layer.name,
    display: band.display,
    categories: band.categories,
    range: [range[0], range[1] > range[0] ? range[1] : range[0] + 1],
  };
}
export const publishedOverlayChoices = (map: MapDescriptor): OverlayChoice[] =>
  map.layers
    .filter((layer) => layer.source.kind === "raster")
    .map((layer) => ({
      id: layer.id,
      name: layer.name,
      common: layer.catalog.common,
      theme: layer.catalog.path[0] ?? "Other",
      branch: layer.catalog.path.slice(1).join(" · "),
      unit: publishedRasterDescription(layer).display.unit,
    }));
export const publishedThemeTypes = (map: MapDescriptor): ThemeType[] =>
  map.layers.flatMap((layer) =>
    layer.catalog.featureTypes.map((type) => ({ ...type, layerId: layer.id }))
  );
export const publishedSocialLayers = (map: MapDescriptor) =>
  map.layers.filter(
    (layer) =>
      layer.source.kind === "raster" && socialFieldChannel.test(layer.id.replace(/^raster:/, ""))
  );

/** Subject and mode changes retain the editor's current preset transition rules. */
export function changePublishedDrawing(
  context: PublishedStyleContext,
  changes: Partial<CartographicPresentation>
) {
  const { map, value } = context;
  const drawing = initialSubjectFields(map, { ...value.drawing, ...changes }, value.drawing);
  let styles = value.styles;
  let rasterStyles = value.rasterStyles;
  if (
    drawing.mode === "drawn" &&
    (value.drawing.mode !== "drawn" || drawing.subject !== value.drawing.subject)
  ) {
    if (value.drawing.mode !== "drawn") rasterStyles = styles;
    styles = publishedDrawnStyles(map, drawing.subject);
    if (map.realScale) styles = realScaleStyles(styles);
  } else if (drawing.mode === "raster" && value.drawing.mode !== "raster") {
    styles = rasterStyles ?? publishedStyles(map);
    rasterStyles = null;
  }
  context.change({ ...value, styles, drawing, rasterStyles });
}
function initialSubjectFields(
  map: MapDescriptor,
  drawing: CartographicPresentation,
  previous: CartographicPresentation
) {
  if (
    drawing.subject === previous.subject ||
    drawing.subject !== "cultural" ||
    drawing.fields.length
  )
    return drawing;
  const first = ["culture:", "languageUse:", "religion:"].flatMap((prefix) =>
    map.layers.filter((layer) => layer.id.startsWith(`raster:${prefix}`))
  )[0];
  return first ? { ...drawing, fields: [first.id] } : drawing;
}
