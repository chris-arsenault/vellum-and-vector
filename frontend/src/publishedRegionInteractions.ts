import Draw from "ol/interaction/Draw.js";
import Modify from "ol/interaction/Modify.js";
import GeoJSON from "ol/format/GeoJSON.js";
import { unByKey } from "ol/Observable.js";
import { primaryAction, shiftKeyOnly } from "ol/events/condition.js";
import type { Bounds, Geometry, Position } from "@atlas/map";
import type { PublishedMapEngine } from "./publishedMapEngine";
import type { PublishedTool } from "./publishedInteractions";

export interface PublishedRegionEvents {
  pick(position: Position, viewport: Bounds): void;
  draw(geometry: Geometry, viewport: Bounds, tolerance: number): void;
  cancel(): void;
}
/**
 * Boundary picking also cuts: a click picks, Shift+drag draws a dividing line across the
 * boundary, and the next click picks the part on the wanted side.
 */
function regionDrawing(tool: PublishedTool) {
  if (tool === "region-pick")
    return new Draw({
      type: "LineString",
      condition: () => false,
      freehandCondition: shiftKeyOnly,
    });
  if (tool !== "region-outline" && tool !== "region-lasso") return null;
  return new Draw({
    type: "Polygon",
    condition: primaryAction,
    freehandCondition: (event) =>
      tool === "region-lasso" &&
      "button" in event.originalEvent &&
      event.originalEvent.button !== 2,
  });
}
export function installPublishedRegions(
  engine: PublishedMapEngine,
  tool: PublishedTool,
  events: () => PublishedRegionEvents
) {
  const extent = () => engine.map.getView().calculateExtent(engine.map.getSize()) as Bounds;
  const submit = (geometry: import("ol/geom/Geometry.js").default) =>
    events().draw(
      new GeoJSON().writeGeometryObject(geometry) as Geometry,
      extent(),
      (engine.map.getView().getResolution() ?? 1) * 12
    );
  const click = engine.map.on("singleclick", (event) => {
    if (tool === "region-pick") events().pick(event.coordinate as Position, extent());
  });
  const drawing = regionDrawing(tool);
  const modify =
    tool === "region-edit" ? new Modify({ source: engine.selection.getSource()! }) : null;
  if (drawing) {
    engine.map.addInteraction(drawing);
    drawing.on("drawend", (event) => submit(event.feature.getGeometry()!));
  }
  if (modify) {
    engine.map.addInteraction(modify);
    modify.on("modifyend", (event) => {
      const geometry = event.features.item(0)?.getGeometry();
      if (geometry) submit(geometry);
    });
  }
  const key = (event: KeyboardEvent) => {
    if (event.key === "Escape") {
      drawing?.abortDrawing();
      events().cancel();
    }
    if (event.key === "Enter" && drawing?.getOverlay().getSource()?.getFeatures().length)
      drawing.finishDrawing();
  };
  engine.target.addEventListener("keydown", key);
  return () => {
    unByKey(click);
    engine.target.removeEventListener("keydown", key);
    if (drawing) engine.map.removeInteraction(drawing);
    if (modify) engine.map.removeInteraction(modify);
  };
}
