import type Feature from "ol/Feature.js";
import type { StyleLike } from "ol/style/Style.js";
import { Style, RegularShape, Text, Stroke, Fill } from "ol/style.js";
import GeoJSON from "ol/format/GeoJSON.js";
import type OLGeometry from "ol/geom/Geometry.js";
import type { Geometry } from "geojson";
import { asArray } from "ol/color.js";
import type { LayerStyle } from "./types";
import type { FeatureAppearance, RenderFeature } from "./renderFeature";
import type { CartographicPresentation, FeatureTypeStyle } from "./types";
import { typePresentation } from "./featureTypePresentation";
import { featureStyle, matchesTextFilter } from "./vectorStyles";
import { cartographicFeatureStyle } from "./drawnStyles";
import type { DrawingGeography } from "./publishedAppearance";
import type { DrawingFeature } from "./drawingGeometry";
const footprints = new WeakMap<Geometry, OLGeometry>();

/** Apply type visibility outside both the default and the GeoStyler renderers. */
export function typeStyle<F extends RenderFeature>(
  appearance: FeatureAppearance<F>,
  base: LayerStyle,
  parsed?: StyleLike,
  cartography?: CartographicPresentation,
  footprint?: Geometry,
  geography?: DrawingGeography,
  drawing?: Map<string, DrawingFeature>
): StyleLike {
  return (feature, resolution) => {
    const domain = feature.get("domain") as F;
    const type = appearance.type(domain),
      effective = typePresentation(type, base);
    if (!effective.visible || !matchesTextFilter(domain, base)) return [];
    const output = styledFeature(
      appearance,
      domain,
      effective,
      feature as Feature,
      resolution,
      parsed,
      cartography,
      footprint,
      geography,
      drawing?.get(domain.id)
    );
    if (!output) return [];
    const styles = Array.isArray(output) ? output : [output];
    const own = base.types?.[type.id] ?? {};
    const rendered = styles.map((style) => overrideStyle(style, own, domain.name));
    if (effective.footprints && domain.footprint)
      rendered.unshift(
        overrideStyle(
          footprintStyle(domain.footprint, effective.color),
          { ...own, labels: false },
          domain.name
        )
      );
    return rendered;
  };
}
function styledFeature<F extends RenderFeature>(
  appearance: FeatureAppearance<F>,
  domain: F,
  effective: LayerStyle,
  feature: Feature,
  resolution: number,
  parsed?: StyleLike,
  cartography?: CartographicPresentation,
  footprint?: Geometry,
  geography?: DrawingGeography,
  drawing?: DrawingFeature
) {
  if (cartography?.mode === "drawn") {
    if (!drawing) throw new Error(`Drawing geometry for ${domain.id} was not prepared.`);
    return cartographicFeatureStyle(domain, effective, resolution, {
      typeId: appearance.type(domain).id,
      name: appearance.name(domain),
      magic: appearance.magic(domain),
      view: cartography,
      footprint,
      geography,
      drawing,
    });
  }
  return parsed
    ? parsedOutput(parsed, feature, resolution)
    : featureStyle(domain, effective, resolution, appearance.realScale);
}
function footprintStyle(geometry: Geometry, color: string) {
  let shape = footprints.get(geometry);
  if (!shape) {
    shape = new GeoJSON().readGeometry(geometry)!;
    footprints.set(geometry, shape);
  }
  return new Style({
    geometry: shape,
    stroke: new Stroke({ color, width: 1, lineDash: [4, 4] }),
    fill: new Fill({ color: color + "18" }),
    zIndex: -1,
  });
}
function parsedOutput(style: StyleLike, feature: Feature, resolution: number) {
  return typeof style === "function" ? style(feature, resolution) : style;
}
function overrideStyle(style: Style, own: FeatureTypeStyle, name: string) {
  if (!Object.keys(own).some((key) => key !== "visible")) return style;
  const result = style.clone(),
    opacity = own.opacity ?? 1;
  if (own.labels === false) result.setText(null);
  if (own.labels && !result.getText()) result.setText(new Text({ text: name }));
  tintPaints(result, own, opacity);
  tintImage(result, own, opacity);
  return result;
}
function tintPaints(result: Style, own: FeatureTypeStyle, opacity: number) {
  const paints = [result.getStroke(), result.getFill(), result.getText()?.getFill()];
  for (const paint of paints)
    if (paint) paint.setColor(tint(own.color ?? paint.getColor(), opacity));
}
function tintImage(result: Style, own: FeatureTypeStyle, opacity: number) {
  const image = result.getImage();
  if (image) image.setOpacity(image.getOpacity() * opacity);
  if (image instanceof RegularShape && own.color) {
    image.getFill()?.setColor(own.color);
    image.getStroke()?.setColor(own.color);
  }
}
function tint(color: unknown, opacity: number): string | number[] {
  if (typeof color !== "string" && !Array.isArray(color)) return "#000000";
  const [r, g, b, a] = asArray(color as string | number[]);
  return [r, g, b, (a ?? 1) * opacity];
}
