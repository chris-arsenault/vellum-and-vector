import Feature from "ol/Feature.js";
import Point from "ol/geom/Point.js";
import LineString from "ol/geom/LineString.js";
import { Circle, Fill, Stroke, Style } from "ol/style.js";
import type { CartographicPresentation } from "./types";
import { atlasColour } from "./drawnSymbols";
import type { FieldMark } from "./fieldDepiction";

export function illustratedFields(input: { view: CartographicPresentation }, marks: FieldMark[]) {
  return marks.map((mark) => {
    const feature = new Feature({ geometry: fieldGeometry(mark) });
    const color = input.view.style === "ink" ? "#594b36" : atlasColour(mark.channel);
    const stipple = mark.channel.startsWith("population");
    feature.setStyle(
      new Style({
        image: stipple
          ? new Circle({
              radius: 1 + Math.sqrt(mark.weight) * 3,
              fill: new Fill({ color: color + "bb" }),
            })
          : undefined,
        stroke: stipple
          ? undefined
          : new Stroke({ color: color + "b0", width: 0.5 + mark.weight * 1.4 }),
        zIndex: -40,
      })
    );
    return feature;
  });
}
function fieldGeometry(mark: FieldMark) {
  if (mark.channel.startsWith("population")) return new Point(mark.point);
  const angle = ((mark.index % 4) * Math.PI) / 4 + Math.PI / 6;
  const length = mark.spacing * 0.75 * Math.sqrt(mark.weight);
  const dx = (Math.cos(angle) * length) / 2,
    dy = (Math.sin(angle) * length) / 2;
  return new LineString([
    [mark.point[0] - dx, mark.point[1] - dy],
    [mark.point[0] + dx, mark.point[1] + dy],
  ]);
}
