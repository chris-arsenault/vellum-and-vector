import Draw from "ol/interaction/Draw.js";
import VectorLayer from "ol/layer/Vector.js";
import VectorSource from "ol/source/Vector.js";
import LineString from "ol/geom/LineString.js";
import type { FeatureLike } from "ol/Feature.js";
import { Fill, Stroke, Style, Text } from "ol/style.js";
import type { PublishedMapEngine } from "./publishedMapEngine";
import { formatDistance, type RealScalePresentation } from "./realScale";

type Units = RealScalePresentation["units"];
/** A temporary distance between clicked points; nothing is written to the map. */
export function installMeasure(
  engine: PublishedMapEngine,
  units: () => Units,
  measured: (text: string) => void
) {
  const metres = (feature: FeatureLike) => {
    const geometry = feature.getGeometry();
    return geometry instanceof LineString
      ? geometry.getLength() * engine.space.metresPerUnit
      : undefined;
  };
  const style = (feature: FeatureLike) => {
    const length = metres(feature);
    if (length === undefined) return [];
    return new Style({
      stroke: new Stroke({ color: "#c0392b", width: 2, lineDash: [6, 4] }),
      text: new Text({
        text: formatDistance(length, units()),
        placement: "line",
        font: "bold 12px sans-serif",
        fill: new Fill({ color: "#c0392b" }),
        stroke: new Stroke({ color: "#ffffff", width: 3 }),
      }),
    });
  };
  const source = new VectorSource();
  const layer = new VectorLayer({ source, style, zIndex: 1000 });
  const draw = new Draw({ source, type: "LineString", style });
  draw.on("drawstart", (event) => {
    source.clear();
    event.feature.getGeometry()?.on("change", () => {
      const length = metres(event.feature);
      if (length !== undefined) measured(formatDistance(length, units()));
    });
  });
  engine.map.addLayer(layer);
  engine.map.addInteraction(draw);
  const key = (event: KeyboardEvent) => {
    if (event.key !== "Escape") return;
    draw.abortDrawing();
    source.clear();
    measured("");
  };
  engine.target.addEventListener("keydown", key);
  return () => {
    engine.target.removeEventListener("keydown", key);
    engine.map.removeInteraction(draw);
    engine.map.removeLayer(layer);
    measured("");
  };
}
