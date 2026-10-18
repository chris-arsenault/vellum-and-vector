import GeoJSON from "ol/format/GeoJSON.js";
import { DragBox, DragPan, Draw, Modify, Select, Snap, Translate } from "ol/interaction.js";
import { primaryAction } from "ol/events/condition.js";
import { fromCircle } from "ol/geom/Polygon.js";
import Circle from "ol/geom/Circle.js";
import type { Geometry } from "geojson";
import type { MapEngine } from "./mapEngine";
import type { AtlasFeature, Position, Tool } from "./types";
import { drawingTools } from "./cartography";

export interface MapEvents {
  select: (feature: AtlasFeature | null) => void;
  draw: (geometry: Geometry) => void;
  extent: (geometry: Geometry) => void;
  modify: (feature: AtlasFeature, geometry: Geometry) => void;
  stroke: (points: Position[]) => void;
  cancel: () => void;
  enter: (id: string) => void;
  viewport: (extent: number[]) => void;
}
const format = new GeoJSON();
export function installMapTools(
  engine: MapEngine,
  tool: Tool,
  selected: string | null,
  events: () => MapEvents
) {
  const map = engine.map,
    active: (Draw | Modify | Select | Translate | DragBox | Snap)[] = [];
  const navigation = { space: false };
  active.push(...featureTools(engine, tool, selected, events));
  if (tool === "extentEdit") {
    const modify = new Modify({ source: engine.preview.getSource()! });
    modify.on("modifyend", (event) => {
      const feature = event.features.item(0),
        geometry = format.writeGeometryObject(feature.getGeometry()!) as Geometry;
      const original = JSON.parse(engine.preview.getSource()!.get("signature"))[0];
      feature.setGeometry(format.readGeometry(original));
      events().extent(geometry);
    });
    active.push(modify);
  }
  if (tool === "refine") {
    const box = new DragBox({ condition: (event) => !navigation.space && primaryAction(event) });
    box.on("boxend", () =>
      events().draw(format.writeGeometryObject(box.getGeometry()) as Geometry)
    );
    active.push(box);
  }
  const draw = installDrawing(tool, events, () => navigation.space);
  if (draw) active.push(draw);
  if (draw && tool !== "sculpt")
    active.push(new Snap({ source: engine.features.getSource()!, pixelTolerance: 8 }));
  const pan = new DragPan({
    condition: (event) =>
      primaryAction(event) && (navigation.space || tool === "pan" || tool === "select"),
  });
  map.addInteraction(pan);
  for (const interaction of active) map.addInteraction(interaction);
  const keyboard = mapKeyboard(
    engine,
    active.filter((item) => item !== draw),
    draw,
    events,
    (held) => {
      navigation.space = held;
    }
  );
  map.getTargetElement()?.focus({ preventScroll: true });
  const enter = map.on("dblclick", (event) => {
    if (tool !== "select") return;
    const child = engine.areas
      .getSource()!
      .getFeatures()
      .find(
        (feature) =>
          feature.get("area").parentId === engine.areas.get("currentArea") &&
          feature.getGeometry()!.intersectsCoordinate(event.coordinate)
      );
    if (child) {
      event.preventDefault();
      events().enter(child.get("area").id);
    }
  });
  return () => {
    keyboard();
    map.un("dblclick", enter.listener);
    map.removeInteraction(pan);
    for (const interaction of active) map.removeInteraction(interaction);
  };
}
function featureTools(
  engine: MapEngine,
  tool: Tool,
  selected: string | null,
  events: () => MapEvents
) {
  const active: (Select | Modify | Translate)[] = [];
  if (!["select", "reshape", "move"].includes(tool)) return active;
  const select = new Select({ layers: [engine.features], hitTolerance: 8 });
  const feature = selected ? engine.features.getSource()!.getFeatureById(selected) : null;
  if (feature) select.getFeatures().push(feature);
  select.on("select", (event) => events().select(event.selected[0]?.get("domain") ?? null));
  if (["select", "reshape", "move"].includes(tool)) active.push(select);
  if (tool === "reshape") {
    const modify = new Modify({ features: select.getFeatures() });
    modify.on("modifyend", (event) =>
      event.features.forEach((item) => commitGeometry(item, events))
    );
    active.push(modify);
  }
  if (tool === "move") {
    const move = new Translate({ features: select.getFeatures(), hitTolerance: 8 });
    move.on("translateend", (event) =>
      event.features.forEach((item) => commitGeometry(item, events))
    );
    active.push(move);
  }
  return active;
}
function commitGeometry(feature: import("ol/Feature.js").default, events: () => MapEvents) {
  const domain = feature.get("domain") as AtlasFeature,
    geometry = format.writeGeometryObject(feature.getGeometry()!) as Geometry;
  feature.setGeometry(format.readGeometry(domain.geometry));
  events().modify(domain, geometry);
}
function installDrawing(tool: Tool, events: () => MapEvents, panning: () => boolean) {
  const type =
    tool === "refinePolygon"
      ? "Polygon"
      : tool === "sculpt"
        ? "LineString"
        : drawingTools[tool]?.geometry;
  if (!type) return null;
  const draw = new Draw({
    type,
    stopClick: true,
    condition: (event) => !panning() && primaryAction(event),
    freehandCondition: (event) => tool === "sculpt" && !panning() && primaryAction(event),
    minPoints: tool === "sculpt" ? 1 : undefined,
  });
  draw.on("drawend", (event) => {
    let geometry = event.feature.getGeometry()!;
    if (geometry instanceof Circle) geometry = fromCircle(geometry, 64);
    const shape = format.writeGeometryObject(geometry) as Geometry;
    if (tool === "sculpt" && shape.type === "LineString")
      events().stroke(shape.coordinates.map(([x, y]) => ({ x, y, z: 0 })));
    else events().draw(shape);
  });
  return draw;
}
function mapKeyboard(
  engine: MapEngine,
  active: { setActive: (value: boolean) => void }[],
  draw: Draw | null,
  events: () => MapEvents,
  panning: (held: boolean) => void
) {
  const target = engine.map.getTargetElement()!;
  const keydown = (event: KeyboardEvent) => {
    if (
      event.target instanceof HTMLElement &&
      /INPUT|TEXTAREA|SELECT|BUTTON/.test(event.target.tagName)
    )
      return;
    if (event.code === "Space") {
      event.preventDefault();
      panning(true);
      active.forEach((interaction) => interaction.setActive(false));
    }
    drawingKey(event, draw, events);
  };
  const release = () => {
    panning(false);
    active.forEach((interaction) => interaction.setActive(true));
  };
  const keyup = (event: KeyboardEvent) => {
    if (event.code === "Space") release();
  };
  target.addEventListener("keydown", keydown);
  window.addEventListener("keyup", keyup);
  window.addEventListener("blur", release);
  return () => {
    target.removeEventListener("keydown", keydown);
    window.removeEventListener("keyup", keyup);
    window.removeEventListener("blur", release);
  };
}
function drawingKey(event: KeyboardEvent, draw: Draw | null, events: () => MapEvents) {
  if (event.key === "Escape") {
    draw?.abortDrawing();
    events().cancel();
  }
  if (["Backspace", "Delete"].includes(event.key)) {
    event.preventDefault();
    draw?.removeLastPoint();
  }
  if (event.key === "Enter" && draw) finishSketch(draw);
}
function finishSketch(draw: Draw) {
  const sketch = draw
    .getOverlay()
    .getSource()!
    .getFeatures()
    .find((feature) => ["LineString", "Polygon"].includes(feature.getGeometry()!.getType()));
  if (!sketch) return;
  const geometry = format.writeGeometryObject(sketch.getGeometry()!) as Geometry;
  const coordinates =
    geometry.type === "Polygon"
      ? geometry.coordinates[0]
      : geometry.type === "LineString"
        ? geometry.coordinates
        : [];
  const count = new Set(coordinates.map((point) => point.join(","))).size;
  if (count >= (geometry.type === "Polygon" ? 3 : 2)) draw.finishDrawing();
}
