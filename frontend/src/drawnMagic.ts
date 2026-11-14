import { magicPlacePresentation } from "./geographySurfaces";
import Point from "ol/geom/Point.js";
import { Fill, Stroke, Style } from "ol/style.js";
import type { LayerStyle } from "./types";
import type { MagicDepiction, RenderFeature } from "./renderFeature";
import { featureStyle } from "./vectorStyles";

/** Rule-defined sites stay visible; broad magical fields tint rather than obscure the atlas. */
export function drawnMagic(
  f: RenderFeature,
  layer: LayerStyle,
  kind: MagicDepiction,
  resolution: number,
  physical: boolean,
  anchor: number[]
) {
  // A course's extent is an area, not a directed path; its rim must not become a route.
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
  if (kind === "site") for (const s of styles) s.setGeometry(new Point(anchor));
  return styles;
}
