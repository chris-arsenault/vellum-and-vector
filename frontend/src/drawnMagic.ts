import { magicPlacePresentation } from "@atlas/domain";
import Point from "ol/geom/Point.js";
import { Fill, Stroke, Style } from "ol/style.js";
import type { AtlasFeature, LayerStyle, World } from "./types";
import { featureStyle } from "./vectorStyles";
import { placeAnchor } from "./drawnPlaces";

export function magicCartography(f: AtlasFeature, world: World) {
  const system = String(f.attributes.system ?? f.kind.split(":")[0]);
  const rule = String(f.attributes.rule ?? f.kind.split(":")[1]);
  return (
    world.magicSystems?.find((s) => s.id === system)?.features.find((r) => r.id === rule)
      ?.cartography ??
    (f.geometry.type.includes("Point")
      ? "site"
      : f.geometry.type.includes("Line")
        ? "course"
        : "area")
  );
}
/** Rule-defined sites stay visible; broad magical fields tint rather than obscure the atlas. */
export function drawnMagic(
  f: AtlasFeature,
  layer: LayerStyle,
  world: World,
  resolution: number,
  physical: boolean
) {
  const kind = magicCartography(f, world);
  // Older saved maps carry only a course's extent, not its directed path. Do not draw that rim as a route.
  if (kind === "area" || (kind === "course" && f.geometry.type.includes("Polygon"))) {
    const rule = String(f.attributes.rule ?? f.kind.split(":")[1]);
    const p = magicPlacePresentation(rule);
    const alpha = Math.round(255 * p.tint * (physical ? 0.18 : 0.06))
      .toString(16)
      .padStart(2, "0");
    return [
      new Style({
        fill: new Fill({ color: p.color + alpha }),
        stroke: physical
          ? new Stroke({ color: p.color + "40", width: 0.6, lineDash: [3, 5] })
          : undefined,
      }),
    ];
  }
  const source = featureStyle(f, { ...layer, labels: false }, resolution);
  const styles = Array.isArray(source) ? source : [source];
  if (kind === "site") for (const s of styles) s.setGeometry(new Point(placeAnchor(f)));
  return styles;
}
