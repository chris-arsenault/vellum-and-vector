import GeoJSON from "ol/format/GeoJSON.js";
import { Fill, Stroke, Style, Text } from "ol/style.js";
import type { Geometry } from "geojson";
import type { RegionView } from "@atlas/domain";
import type { MapEngine } from "./mapEngine";

/** The cartographic subject references source geography; it does not change its detail. */
export interface RegionPresentation {
  id: string | null;
  sourceAreaId: string;
  name: string;
  footprint: Geometry;
  regions: RegionView[];
}
export function updateRegionMap(engine: MapEngine, presentation: RegionPresentation) {
  const source = engine.regions.getSource()!;
  const shown = presentation.regions.filter(
    (r) => r.id === presentation.id || r.region.parentId === presentation.id
  );
  const signature = JSON.stringify([presentation.id, shown]);
  if (source.get("signature") === signature) return;
  source.set("signature", signature);
  engine.regions.set("currentRegion", presentation.id);
  source.clear();
  for (const region of shown) {
    const feature = new GeoJSON().readFeatures({
      type: "Feature",
      geometry: region.region.footprint,
      properties: { region },
    })[0];
    const current = region.id === presentation.id;
    feature.setStyle(
      new Style({
        stroke: new Stroke({
          color: current ? "#ffdb86" : "#d9cba5",
          width: current ? 2.5 : 1.5,
          lineDash: current ? undefined : [7, 5],
        }),
        fill: new Fill({ color: current ? "#ffdb8608" : "#e8d6a412" }),
        text: new Text({
          text: current ? "" : region.name,
          font: "13px system-ui",
          fill: new Fill({ color: "#fff2cd" }),
          stroke: new Stroke({ color: "#203739", width: 3 }),
        }),
      })
    );
    source.addFeature(feature);
  }
}
