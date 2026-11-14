import Feature from "ol/Feature.js";
import Point from "ol/geom/Point.js";
import { Style } from "ol/style.js";
import type { CartographicPresentation } from "./types";
import type { TerrainMark } from "./terrainDepiction";
import { drawnIcon } from "./drawnSymbols";

export function illustratedTerrain(
  input: { view: CartographicPresentation },
  marks: TerrainMark[]
) {
  return marks.map((mark) => {
    const feature = new Feature({ geometry: new Point(mark.coordinate) });
    feature.setStyle(
      new Style({
        image: drawnIcon(mark.kind, mark.size, input.view.style === "ink"),
        zIndex: mark.kind === "mountain" ? -20 : -30,
      })
    );
    return feature;
  });
}
