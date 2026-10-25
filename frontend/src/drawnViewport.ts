import View from "ol/View.js";
import Projection from "ol/proj/Projection.js";
import type { Geometry } from "geojson";
import type { MapEngine } from "./mapEngine";
import { bounds } from "./presentation";

export const drawnMapPadding = [100, 55, 110, 55];
/** Paper margins need space outside the geographic chart; raster views retain their constraints. */
export function setDrawingViewport(engine: MapEngine, drawn: boolean, footprint: Geometry) {
  const previous = engine.map.getView();
  const wrap = engine.reference.boundaryMode === "cylinder";
  const extent = bounds(engine.reference.domain);
  engine.map.setView(
    new View({
      projection: new Projection({
        code: engine.reference.id,
        units: "m",
        extent,
        global: !drawn && wrap,
      }),
      center: previous.getCenter(),
      resolution: previous.getResolution(),
      rotation: previous.getRotation(),
      multiWorld: wrap,
      ...(!drawn && wrap
        ? { extent: [-Infinity, extent[1], Infinity, extent[3]], constrainOnlyCenter: true }
        : {}),
    })
  );
  engine.map
    .getView()
    .fit(bounds(footprint), { padding: drawn ? drawnMapPadding : [35, 35, 35, 35] });
}
