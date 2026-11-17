import type Feature from "ol/Feature.js";
import OLFeature from "ol/Feature.js";
import Point from "ol/geom/Point.js";
import type LineString from "ol/geom/LineString.js";
import Draw from "ol/interaction/Draw.js";
import DragBox from "ol/interaction/DragBox.js";
import PointerInteraction from "ol/interaction/Pointer.js";
import type VectorLayer from "ol/layer/Vector.js";
import { containsCoordinate, getCenter } from "ol/extent.js";
import { unByKey } from "ol/Observable.js";
import type { Coordinate } from "ol/coordinate.js";
import type { EditOutcome } from "@atlas/map";
import type { PublishedMapEngine } from "./publishedMapEngine";
import type { PublishedFeature } from "./publishedAppearance";
import { vectorFamily } from "./publishedAppearance";
import { toGeometry, type EditingEvents } from "./realScaleEditing";
import { layerSpace } from "./realScaleLandTools";

const domainId = (feature: { get(key: string): unknown }) =>
  (feature.get("domain") as PublishedFeature | undefined)?.id;

/** After a shape lands in a layer of another located space, that space is shown. */
export function followSpace(engine: PublishedMapEngine, events: EditingEvents, layerId: string) {
  return (outcome: EditOutcome | undefined) => {
    if (!outcome) return;
    const space = layerSpace(outcome.map, layerId);
    if (space && space !== engine.space.id) events.showSpace(space);
  };
}
/** Click to set down one object of the chosen kind, turned and sized as chosen. */
export function installPlace(engine: PublishedMapEngine, events: EditingEvents) {
  const { draw: choice, land, target } = events.state();
  if (!choice) return () => {};
  const click = engine.map.on("singleclick", (event) => {
    const [x, y] = event.coordinate;
    void events
      .command({
        command: "place",
        layerId: choice.layerId,
        kind: choice.kind,
        name: choice.name.trim() || null,
        at: [x, y],
        rotation: land.rotation,
        scale: land.scale,
        creatorLayer: target || null,
      })
      .then((outcome) => {
        if (outcome) events.select(outcome.changed);
      });
    events.drawn();
  });
  return () => unByKey(click);
}
/** Draw an outline to fill with objects of the chosen kind; the scatter is one undo step. */
export function installScatter(engine: PublishedMapEngine, events: EditingEvents) {
  const { draw: choice, land, target } = events.state();
  if (!choice) return () => {};
  const draw = new Draw({ type: "Polygon" });
  draw.on("drawend", (event) => {
    void events
      .command({
        command: "scatter",
        layerId: choice.layerId,
        kind: choice.kind,
        outline: toGeometry(event.feature.getGeometry()!),
        spacing: land.spacing,
        seed: land.seed,
        creatorLayer: target || null,
      })
      .then((outcome) => {
        if (outcome) events.select(outcome.changed);
      });
    events.drawn();
  });
  engine.map.addInteraction(draw);
  return () => engine.map.removeInteraction(draw);
}
/** The hex grids drawn now: the surface's, or the caves' on the Caves level. */
function hexLayers(engine: PublishedMapEngine) {
  return [...engine.vectors.layers.entries()]
    .filter(([id]) => ["hexes", "caveHexes"].includes(vectorFamily(id)))
    .map(([, layer]) => layer);
}
export function findHex(engine: PublishedMapEngine, id: string): Feature | undefined {
  for (const layer of hexLayers(engine)) {
    const feature = layer.getSource()?.getFeatureById(id);
    if (feature) return feature as Feature;
  }
  return undefined;
}
/** Click picks a hex, Shift-click adds or removes one, dragging a box picks every hex whose
 * centre lies in it (Shift adds them). */
export function installHexes(engine: PublishedMapEngine, events: EditingEvents) {
  const click = engine.map.on("singleclick", (event) => {
    // A hex in the grid view draws only its outline, so it is found by where it lies.
    const hit = hexLayers(engine)
      .flatMap((layer) => layer.getSource()?.getFeaturesAtCoordinate(event.coordinate) ?? [])
      .at(0);
    const id = hit && domainId(hit);
    const { selected } = events.state();
    if (!id) return events.select([]);
    if (!(event.originalEvent as PointerEvent).shiftKey) return events.select([id]);
    events.select(selected.includes(id) ? selected.filter((s) => s !== id) : [...selected, id]);
  });
  const box = new DragBox({ condition: () => true });
  box.on("boxend", (event) => {
    const extent = box.getGeometry().getExtent();
    const ids = hexLayers(engine)
      .flatMap((layer) => layer.getSource()?.getFeaturesInExtent(extent) ?? [])
      .filter((hex) => {
        const geometry = hex.getGeometry();
        return geometry && containsCoordinate(extent, getCenter(geometry.getExtent()));
      })
      .flatMap((hex) => domainId(hex) ?? []);
    const shift = !!(event.mapBrowserEvent?.originalEvent as PointerEvent | undefined)?.shiftKey;
    const kept = shift ? events.state().selected : [];
    events.select([...new Set([...kept, ...ids])]);
  });
  engine.map.addInteraction(box);
  return () => {
    unByKey(click);
    engine.map.removeInteraction(box);
  };
}

const handleGap = 14;
/** The unit normal at each vertex, averaged over the segments that meet there. */
function normals(points: Coordinate[]): Coordinate[] {
  return points.map((_, i) => {
    const a = points[Math.max(i - 1, 0)],
      b = points[Math.min(i + 1, points.length - 1)];
    const [dx, dy] = [b[0] - a[0], b[1] - a[1]];
    const length = Math.hypot(dx, dy) || 1;
    return [-dy / length, dx / length];
  });
}
/** Width handles beside each point of a selected line: dragging one sets that point's width. */
export function installWidthHandles(
  engine: PublishedMapEngine,
  overlay: VectorLayer,
  target: Feature | undefined,
  events: EditingEvents
) {
  const record = target?.get("domain") as PublishedFeature | undefined;
  const widths = record?.attributes.widths;
  const geometry = target?.getGeometry() as LineString | undefined;
  if (!record || !Array.isArray(widths) || geometry?.getType() !== "LineString") return () => {};
  const points = geometry.getCoordinates();
  const across = normals(points);
  const source = overlay.getSource()!;
  const gap = () => handleGap * (engine.map.getView().getResolution() ?? 1);
  const handles = points.map((_, index) => new OLFeature({ editRole: "width", index }));
  const place = (index: number, width: number) => {
    const [x, y] = points[index];
    const reach = width / 2 + gap();
    handles[index].setGeometry(
      new Point([x + across[index][0] * reach, y + across[index][1] * reach])
    );
  };
  const current = (widths as number[]).slice();
  current.forEach((width, index) => place(index, width));
  source.addFeatures(handles);
  const view = engine.map
    .getView()
    .on("change:resolution", () => current.forEach((width, index) => place(index, width)));
  let dragging: number | null = null;
  const widthAt = (index: number, [x, y]: Coordinate) => {
    const [px, py] = points[index];
    const reach = (x - px) * across[index][0] + (y - py) * across[index][1];
    return Math.max(Math.round((Math.abs(reach) - gap()) * 2 * 100) / 100, 0.05);
  };
  const interaction = new PointerInteraction({
    handleDownEvent(event) {
      const index = handles.findIndex((handle) => {
        const at = engine.map.getPixelFromCoordinate(
          (handle.getGeometry() as Point).getCoordinates()
        );
        return Math.hypot(at[0] - event.pixel[0], at[1] - event.pixel[1]) <= 8;
      });
      dragging = index >= 0 ? index : null;
      return dragging !== null;
    },
    handleDragEvent(event) {
      if (dragging === null) return;
      current[dragging] = widthAt(dragging, event.coordinate);
      place(dragging, current[dragging]);
    },
    handleUpEvent() {
      if (dragging === null) return false;
      dragging = null;
      void events.command({
        command: "setAttributes",
        ids: [record.id],
        name: null,
        attributes: { widths: current.slice() },
      });
      return false;
    },
  });
  engine.map.addInteraction(interaction);
  return () => {
    unByKey(view);
    engine.map.removeInteraction(interaction);
    for (const handle of handles) source.removeFeature(handle);
  };
}
