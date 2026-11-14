import GeoJSON from "ol/format/GeoJSON.js";
import { DragBox, DragPan, Draw, Modify, Select, Snap, Translate } from "ol/interaction.js";
import { primaryAction, singleClick } from "ol/events/condition.js";
import { fromCircle } from "ol/geom/Polygon.js";
import Circle from "ol/geom/Circle.js";
import Feature from "ol/Feature.js";
import { unByKey } from "ol/Observable.js";
import type { Geometry } from "geojson";
import type { MapEngine } from "./mapEngine";
import type { AtlasFeature, Position, Tool } from "./types";
import { drawingTools } from "./cartography";
import { canonicalGeometry, canonicalPosition, spatial, translateGeometry } from "@atlas/domain";

export interface MapEvents {
  select: (feature: AtlasFeature | null) => void;
  draw: (geometry: Geometry) => void;
  extent: (geometry: Geometry) => void;
  modify: (feature: AtlasFeature, geometry: Geometry, role?: "footprint") => void;
  stroke: (points: Position[]) => void;
  cancel: () => void;
  enter: (id: string) => void;
  viewport: (extent: number[]) => void;
  pickRegion?: (position: Position) => void;
  inspectCell?: (position: Position) => void;
  enterRegion?: (id: string) => void;
}
const format = new GeoJSON();
export function installMapTools(
  engine: MapEngine,
  tool: Tool,
  selected: string | null,
  events: () => MapEvents,
  geometryRole: "primary" | "footprint" = "primary"
) {
  const originalEvents = events;
  events = () => canonicalEvents(engine, tool, originalEvents());
  const map = engine.map,
    active: (Draw | Modify | Select | Translate | DragBox | Snap)[] = [];
  const navigation = { space: false };
  const editing = installCanonicalEditing(engine, tool);
  active.push(...featureTools(engine, tool, selected, events, geometryRole));
  if (tool === "extentEdit" || tool === "regionEdit") {
    const modify = new Modify({
      source: engine.preview.getSource()!,
      wrapX: engine.reference.boundaryMode === "cylinder",
    });
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
    active.push(new Snap({ features: engine.snapFeatures, pixelTolerance: 8 }));
  const pan = new DragPan({
    condition: (event) =>
      primaryAction(event) &&
      (navigation.space ||
        tool === "pan" ||
        tool === "select" ||
        tool === "regionPick" ||
        tool === "inspectCell"),
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
  const unlisten = installMapNavigation(engine, tool, events, () => !navigation.space);
  return () => {
    editing();
    keyboard();
    unlisten();
    map.removeInteraction(pan);
    for (const interaction of active) map.removeInteraction(interaction);
  };
}
function canonicalEvents(engine: MapEngine, tool: Tool, original: MapEvents): MapEvents {
  const reference = engine.reference;
  return {
    ...original,
    draw: (shape) =>
      original.draw(tool.startsWith("label") ? shape : canonicalDrawing(engine, tool, shape)),
    extent: (shape) => original.extent(canonicalGeometry(reference, shape)),
    modify: (feature, shape, role) =>
      original.modify(feature, canonicalGeometry(reference, shape), role),
    stroke: (points) => original.stroke(points.map((p) => canonicalPosition(reference, p))),
    pickRegion: (p) => original.pickRegion?.(canonicalPosition(reference, p)),
    inspectCell: (p) => original.inspectCell?.(canonicalPosition(reference, p)),
  };
}
/** Recenter by whole worlds before native vertex hit-testing; the rendered view stays identical. */
function installCanonicalEditing(engine: MapEngine, tool: Tool) {
  if (
    !["reshape", "extentEdit", "regionEdit"].includes(tool) ||
    engine.reference.boundaryMode !== "cylinder"
  )
    return () => {};
  const map = engine.map;
  const recenter = ([x, y]: number[]) => {
    const p = canonicalPosition(engine.reference, { x, y, z: 0 });
    const shift = x - p.x;
    if (shift) {
      const view = map.getView(),
        center = view.getCenter()!;
      view.setCenter([center[0] - shift, center[1]]);
      map.renderSync();
    }
    return [p.x, y];
  };
  const keys = map.on("pointermove", (event) => {
    if (!event.dragging) event.coordinate = recenter(event.coordinate);
  });
  const down = (event: PointerEvent) =>
    recenter(map.getCoordinateFromPixel(map.getEventPixel(event)));
  const viewport = map.getViewport()!;
  viewport.addEventListener("pointerdown", down, true);
  return () => {
    unByKey(keys);
    viewport.removeEventListener("pointerdown", down, true);
  };
}
function canonicalDrawing(engine: MapEngine, tool: Tool, shape: Geometry) {
  if (tool !== "magic" && tool !== "hill") return canonicalGeometry(engine.reference, shape);
  const [west, , east] = spatial.bounds(shape),
    x = (west + east) / 2;
  const center = canonicalPosition(engine.reference, { x, y: 0, z: 0 });
  return translateGeometry(shape, center.x - x);
}
function installMapNavigation(
  engine: MapEngine,
  tool: Tool,
  events: () => MapEvents,
  canPick: () => boolean
) {
  const map = engine.map;
  const pick = map.on("singleclick", (event) => {
    if (tool === "regionPick" && canPick())
      events().pickRegion?.({ x: event.coordinate[0], y: event.coordinate[1], z: 0 });
    if (tool === "inspectCell" && canPick())
      events().inspectCell?.({ x: event.coordinate[0], y: event.coordinate[1], z: 0 });
  });
  const enter = map.on("dblclick", (event) => {
    if (tool !== "select") return;
    const p = canonicalPosition(engine.reference, {
        x: event.coordinate[0],
        y: event.coordinate[1],
        z: 0,
      }),
      coordinate = [p.x, p.y];
    // Each vector source answers from its own R-tree, then tests the candidates exactly.
    const region = engine.regions
      .getSource()!
      .getFeaturesAtCoordinate(coordinate)
      .find((f) => f.get("region").region.parentId === engine.regions.get("currentRegion"));
    if (region) {
      event.preventDefault();
      events().enterRegion?.(region.get("region").id);
      return;
    }
    const child = engine.areas
      .getSource()!
      .getFeaturesAtCoordinate(coordinate)
      .find((feature) => feature.get("area").parentId === engine.areas.get("currentArea"));
    if (child) {
      event.preventDefault();
      events().enter(child.get("area").id);
    }
  });
  return () => {
    map.un("dblclick", enter.listener);
    map.un("singleclick", pick.listener);
  };
}
function featureTools(
  engine: MapEngine,
  tool: Tool,
  selected: string | null,
  events: () => MapEvents,
  geometryRole: "primary" | "footprint"
) {
  const active: (Select | Modify | Translate)[] = [];
  if (!["select", "reshape", "move"].includes(tool)) return active;
  const select = new Select({
    condition: (event) => singleClick(event) && insideDrawnSubject(engine, event.coordinate),
    filter: (feature) => feature.get("typeVisible") !== false,
    layers: (layer) => engine.vectors.getLayers().getArray().includes(layer),
    hitTolerance: 8,
  });
  let feature = selected ? engine.features.getFeatureById(selected) : null;
  if (feature && geometryRole === "footprint") feature = footprintHandle(feature);
  if (feature) select.getFeatures().push(feature);
  select.on("select", (event) => {
    events().select(event.selected[0]?.get("domain") ?? null);
    if (tool !== "select") select.getFeatures().clear();
  });
  if (["select", "reshape", "move"].includes(tool)) active.push(select);
  if (tool === "reshape") {
    const modify = new Modify({
      features: select.getFeatures(),
      wrapX: engine.reference.boundaryMode === "cylinder",
    });
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
function insideDrawnSubject(engine: MapEngine, coordinate: number[]) {
  if (!engine.drawn.getVisible()) return true;
  const covers = engine.drawn.get("covers") as ((p: Position) => boolean) | null;
  const p = canonicalPosition(engine.reference, { x: coordinate[0], y: coordinate[1], z: 0 });
  return !covers || covers(p);
}
function footprintHandle(feature: Feature) {
  const domain = feature.get("domain") as AtlasFeature;
  if (!domain.footprint) return feature;
  return new Feature({
    domain,
    geometry: format.readGeometry(domain.footprint)!,
    editingFootprint: true,
    typeVisible: true,
  });
}
function commitGeometry(feature: import("ol/Feature.js").default, events: () => MapEvents) {
  const domain = feature.get("domain") as AtlasFeature,
    geometry = format.writeGeometryObject(feature.getGeometry()!) as Geometry;
  const footprint = feature.get("editingFootprint");
  feature.setGeometry(format.readGeometry(footprint ? domain.footprint! : domain.geometry));
  events().modify(domain, geometry, footprint ? "footprint" : undefined);
}
function installDrawing(tool: Tool, events: () => MapEvents, panning: () => boolean) {
  const special = {
    refinePolygon: "Polygon",
    regionOutline: "Polygon",
    sculpt: "LineString",
    regionCut: "LineString",
    labelPath: "LineString",
    labelPlace: "Point",
  } as const;
  const type = special[tool as keyof typeof special] ?? drawingTools[tool]?.geometry;
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
