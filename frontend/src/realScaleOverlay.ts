import type { FeatureLike } from "ol/Feature.js";
import { Circle, Fill, RegularShape, Stroke, Style } from "ol/style.js";

/** The editing overlay: the selection, its rotate and scale handles, previews and guides. */
const selection = new Style({
  stroke: new Stroke({ color: "#f39c12", width: 3, lineDash: [6, 4] }),
  fill: new Fill({ color: "#f39c1222" }),
});
const preview = new Style({
  stroke: new Stroke({ color: "#2980b9", width: 2 }),
  fill: new Fill({ color: "#2980b933" }),
});
const guide = new Style({ stroke: new Stroke({ color: "#d63384", width: 1, lineDash: [4, 3] }) });
const rotate = new Style({
  image: new Circle({
    radius: 7,
    fill: new Fill({ color: "#ffffff" }),
    stroke: new Stroke({ color: "#f39c12", width: 2 }),
  }),
});
const scale = new Style({
  image: new RegularShape({
    points: 4,
    radius: 8,
    angle: Math.PI / 4,
    fill: new Fill({ color: "#ffffff" }),
    stroke: new Stroke({ color: "#f39c12", width: 2 }),
  }),
});
/** A line point's width handle, dragged across the line to widen or narrow it there. */
const width = new Style({
  image: new RegularShape({
    points: 3,
    radius: 6,
    fill: new Fill({ color: "#ffffff" }),
    stroke: new Stroke({ color: "#2980b9", width: 2 }),
  }),
});
const roles: Record<string, Style> = { preview, guide, rotate, scale, width };
export function overlayStyle(feature: FeatureLike) {
  const role = feature.get("editRole") as string | undefined;
  return (role && roles[role]) || selection;
}
