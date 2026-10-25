import type Feature from "ol/Feature.js";
import type { StyleLike } from "ol/style/Style.js";
import { Style, RegularShape, Text, Stroke, Fill } from "ol/style.js";
import GeoJSON from "ol/format/GeoJSON.js";
import type OLGeometry from "ol/geom/Geometry.js";
import type { Geometry } from "geojson";
import { asArray } from "ol/color.js";
import type { AtlasFeature, LayerStyle, World } from "./types";
import type { CartographicPresentation, FeatureTypeStyle } from "@atlas/domain";
import { describeFeature, typePresentation } from "@atlas/domain";
import { featureStyle } from "./vectorStyles";
import { cartographicFeatureStyle } from "./drawnStyles";
const footprints = new WeakMap<Geometry, OLGeometry>();

/** Apply type visibility outside both the default and the GeoStyler renderers. */
export function typeStyle(
  world: World,
  base: LayerStyle,
  parsed?: StyleLike,
  cartography?: CartographicPresentation,
  footprint?: Geometry
): StyleLike {
  return (feature, resolution) => {
    const domain = feature.get("domain") as AtlasFeature;
    const type = describeFeature(world, domain),
      effective = typePresentation(type, base);
    if (!effective.visible || !matchesTextFilter(domain, base)) return [];
    const output = styledFeature(
      world,
      domain,
      effective,
      feature as Feature,
      resolution,
      parsed,
      cartography,
      footprint
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
function styledFeature(
  world: World,
  domain: AtlasFeature,
  effective: LayerStyle,
  feature: Feature,
  resolution: number,
  parsed?: StyleLike,
  cartography?: CartographicPresentation,
  footprint?: Geometry
) {
  if (cartography?.mode === "drawn")
    return cartographicFeatureStyle(domain, effective, resolution, {
      world,
      view: cartography,
      footprint,
    });
  return parsed
    ? parsedOutput(parsed, feature, resolution)
    : featureStyle(domain, effective, resolution);
}
function matchesTextFilter(domain: AtlasFeature, base: LayerStyle) {
  return (
    !base.filter ||
    JSON.stringify([domain.name, domain.attributes])
      .toLowerCase()
      .includes(base.filter.toLowerCase())
  );
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
