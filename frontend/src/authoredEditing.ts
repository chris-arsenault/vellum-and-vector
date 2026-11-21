import Feature from "ol/Feature.js";
import Circle from "ol/geom/Circle.js";
import LineString from "ol/geom/LineString.js";
import Draw from "ol/interaction/Draw.js";
import PointerInteraction from "ol/interaction/Pointer.js";
import VectorLayer from "ol/layer/Vector.js";
import VectorSource from "ol/source/Vector.js";
import { unByKey } from "ol/Observable.js";
import { Fill, Stroke, Style } from "ol/style.js";
import type { TerrainEdit, TerrainOutcome } from "@atlas/map";
import type { PublishedMapEngine } from "./publishedMapEngine";
import type { AuthoringState, EditTool } from "./useRealScaleAuthoring";
import {
  buildHeightArea,
  buildHeightLine,
  buildPeak,
  buildStroke,
  isBrush,
  ringPixels,
  terrainEdit,
} from "./authoredState";

/** What the canvas asks of an authored map's terrain; one call per finished gesture. */
export interface AuthoredEvents {
  terrain?(edit: TerrainEdit): Promise<TerrainOutcome | undefined>;
}
interface Scope {
  engine: PublishedMapEngine;
  events: AuthoredEvents & { state(): AuthoringState };
}
type Install = (scope: Scope) => () => void;
type Point = [number, number];
const gold = "#ddbe83";
const ringStyle = new Style({
  stroke: new Stroke({ color: gold, width: 2 }),
  fill: new Fill({ color: "rgba(221, 190, 131, 0.14)" }),
});
const sketchStyle = new Style({ stroke: new Stroke({ color: gold, width: 3, lineDash: [2, 6] }) });

function overlayLayer(engine: PublishedMapEngine, style: Style) {
  const source = new VectorSource();
  const layer = new VectorLayer({ source, style, zIndex: 950 });
  engine.map.addLayer(layer);
  return { source, remove: () => engine.map.removeLayer(layer) };
}
/** A ring that follows the pointer at the brush's size, never smaller than a few pixels. */
function installRing(engine: PublishedMapEngine, radius: () => number) {
  const layer = overlayLayer(engine, ringStyle);
  const ring = new Feature();
  layer.source.addFeature(ring);
  const move = engine.map.on("pointermove", (event) => {
    const resolution = engine.map.getView().getResolution() ?? 1;
    ring.setGeometry(new Circle(event.coordinate, ringPixels(radius(), resolution) * resolution));
  });
  const element = engine.map.getTargetElement() as HTMLElement | null;
  const leave = () => ring.setGeometry(undefined);
  element?.addEventListener("pointerleave", leave);
  return () => {
    unByKey(move);
    element?.removeEventListener("pointerleave", leave);
    layer.remove();
  };
}
/** Hold Space to pan instead of painting. */
function trackSpace(engine: PublishedMapEngine) {
  const held = { value: false };
  const set = (value: boolean) => (event: KeyboardEvent) => {
    if (event.key === " ") held.value = value;
  };
  const [down, up] = [set(true), set(false)];
  engine.target.addEventListener("keydown", down);
  engine.target.addEventListener("keyup", up);
  return {
    held,
    stop: () => {
      engine.target.removeEventListener("keydown", down);
      engine.target.removeEventListener("keyup", up);
    },
  };
}
/** Brush strokes: points collect on pointer-down and drag, then one terrain edit on release. */
const installBrush: Install = ({ engine, events }) => {
  const stopRing = installRing(engine, () => events.state().authored.brush.radius);
  const sketch = overlayLayer(engine, sketchStyle);
  const space = trackSpace(engine);
  const path = new Feature<LineString>();
  let points: Point[] = [];
  const show = () => path.setGeometry(points.length > 1 ? new LineString(points) : undefined);
  sketch.source.addFeature(path);
  const interaction = new PointerInteraction({
    handleDownEvent(event) {
      const pointer = event.originalEvent as PointerEvent;
      if (pointer.button !== 0 || space.held.value) return false;
      points = [event.coordinate as Point];
      return true;
    },
    handleDragEvent(event) {
      points.push(event.coordinate as Point);
      show();
    },
    handleUpEvent() {
      const { tool, brush } = events.state().authored;
      const stroke = isBrush(tool) ? buildStroke(points, tool, brush) : null;
      points = [];
      show();
      if (stroke) void events.terrain?.(terrainEdit.stroke(stroke));
      return false;
    },
  });
  engine.map.addInteraction(interaction);
  return () => {
    engine.map.removeInteraction(interaction);
    space.stop();
    sketch.remove();
    stopRing();
  };
};
function drawKeys(engine: PublishedMapEngine, draw: Draw) {
  const key = (event: KeyboardEvent) => {
    if (event.key === "Escape") draw.abortDrawing();
  };
  engine.target.addEventListener("keydown", key);
  return () => engine.target.removeEventListener("keydown", key);
}
/** Height line: click vertices; each takes the height field as it stands when clicked. */
const installHeightLine: Install = ({ engine, events }) => {
  const draw = new Draw({ type: "LineString", style: sketchStyle });
  let heights: number[] = [];
  const height = () => events.state().authored.shape.height;
  draw.on("drawstart", (event) => {
    heights = [height()];
    const line = event.feature.getGeometry() as LineString;
    // The line holds its placed vertices and one following the pointer.
    line.on("change", () => {
      while (heights.length < line.getCoordinates().length - 1) heights.push(height());
    });
  });
  draw.on("drawend", (event) => {
    const points = (event.feature.getGeometry() as LineString).getCoordinates() as Point[];
    const line = buildHeightLine(points, events.state().authored.shape, heights);
    void events.terrain?.(terrainEdit.line(line));
  });
  engine.map.addInteraction(draw);
  const keys = drawKeys(engine, draw);
  return () => {
    keys();
    engine.map.removeInteraction(draw);
  };
};
/** Height area: a polygon at one height with a feathered edge. */
const installHeightArea: Install = ({ engine, events }) => {
  const draw = new Draw({ type: "Polygon", style: sketchStyle });
  draw.on("drawend", (event) => {
    const geometry = event.feature.getGeometry() as unknown as { getCoordinates(): Point[][] };
    const area = buildHeightArea(geometry.getCoordinates()[0], events.state().authored.shape);
    void events.terrain?.(terrainEdit.area(area));
  });
  engine.map.addInteraction(draw);
  const keys = drawKeys(engine, draw);
  return () => {
    keys();
    engine.map.removeInteraction(draw);
  };
};
/** Peak: one click raises a summit of the chosen height and radius. */
const installPeak: Install = ({ engine, events }) => {
  const stopRing = installRing(engine, () => events.state().authored.shape.peakRadius);
  const click = engine.map.on("singleclick", (event) => {
    const peak = buildPeak(event.coordinate as Point, events.state().authored.shape);
    void events.terrain?.(terrainEdit.peak(peak));
  });
  return () => {
    unByKey(click);
    stopRing();
  };
};
export const authoredInteractions: Pick<
  Record<EditTool, Install[]>,
  "brush" | "heightLine" | "heightArea" | "peak"
> = {
  brush: [installBrush],
  heightLine: [installHeightLine],
  heightArea: [installHeightArea],
  peak: [installPeak],
};
