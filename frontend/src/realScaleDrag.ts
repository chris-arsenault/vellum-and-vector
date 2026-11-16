import Feature from "ol/Feature.js";
import type OLGeometry from "ol/geom/Geometry.js";
import LineString from "ol/geom/LineString.js";
import Point from "ol/geom/Point.js";
import PointerInteraction from "ol/interaction/Pointer.js";
import type VectorLayer from "ol/layer/Vector.js";
import type MapBrowserEvent from "ol/MapBrowserEvent.js";
import { createEmpty, extend } from "ol/extent.js";
import { unByKey } from "ol/Observable.js";
import type { Coordinate } from "ol/coordinate.js";
import type { Transform } from "@atlas/map";
import type { PublishedMapEngine } from "./publishedMapEngine";
import type { PublishedFeature } from "./publishedAppearance";
import { editableLayers, hits, type EditingEvents } from "./realScaleEditing";
import { snapToGuides, type Box, type Guide } from "./realScaleGuides";

type Mode = "move" | "rotate" | "scale";
interface Drag {
  mode: Mode;
  start: Coordinate;
  originals: OLGeometry[];
  previews: Feature[];
}
const handleGap = 18;
const ids = (features: Feature[]) => features.map((f) => (f.get("domain") as PublishedFeature).id);
function extentOf(features: Feature[]): Box {
  const box = createEmpty();
  for (const feature of features) {
    const geometry = feature.getGeometry();
    if (geometry) extend(box, geometry.getExtent());
  }
  return box as Box;
}

/** Drag the selection to move it with guides; its handles turn and size it about its centre. */
export function installSelectionDrag(
  engine: PublishedMapEngine,
  overlay: VectorLayer,
  events: EditingEvents
) {
  const source = overlay.getSource()!;
  const selected = source.getFeatures() as Feature[];
  if (!selected.length) return () => {};
  const box = extentOf(selected);
  const centre: Coordinate = [(box[0] + box[2]) / 2, (box[1] + box[3]) / 2];
  const rotateHandle = new Feature({ editRole: "rotate" });
  const scaleHandle = new Feature({ editRole: "scale", geometry: new Point([box[2], box[3]]) });
  const resolution = () => engine.map.getView().getResolution() ?? 1;
  const placeHandles = () =>
    rotateHandle.setGeometry(new Point([centre[0], box[3] + handleGap * resolution()]));
  placeHandles();
  source.addFeatures([rotateHandle, scaleHandle]);
  const view = engine.map.getView().on("change:resolution", placeHandles);
  let drag: Drag | null = null;
  const handleAt = (pixel: number[]): Mode | null => {
    for (const [handle, mode] of [
      [rotateHandle, "rotate"],
      [scaleHandle, "scale"],
    ] as const) {
      const at = engine.map.getPixelFromCoordinate(
        (handle.getGeometry() as Point).getCoordinates()
      );
      if (Math.hypot(at[0] - pixel[0], at[1] - pixel[1]) <= 9) return mode;
    }
    const chosen = new Set(ids(selected));
    return hits(engine, pixel).some((id) => chosen.has(id)) ? "move" : null;
  };
  const transformAt = (event: MapBrowserEvent, current: Drag) =>
    transformFor(current, event, centre, others(engine, selected), resolution());
  const interaction = new PointerInteraction({
    handleDownEvent(event) {
      const mode = handleAt(event.pixel);
      if (!mode) return false;
      const originals = selected.map((feature) => feature.getGeometry()!.clone());
      const previews = originals.map(
        (g) => new Feature({ geometry: g.clone(), editRole: "preview" })
      );
      source.addFeatures(previews);
      drag = { mode, start: event.coordinate, originals, previews };
      return true;
    },
    handleDragEvent(event) {
      if (!drag) return;
      const { transform, guides } = transformAt(event, drag);
      preview(drag, transform);
      showGuides(source, guides);
    },
    handleUpEvent(event) {
      const current = drag;
      drag = null;
      if (!current) return false;
      const { transform } = transformAt(event, current);
      for (const feature of current.previews) source.removeFeature(feature);
      showGuides(source, []);
      if (!unchanged(transform))
        void events.command({ command: "transform", ids: ids(selected), transform });
      return false;
    },
  });
  engine.map.addInteraction(interaction);
  return () => {
    unByKey(view);
    engine.map.removeInteraction(interaction);
  };
}
/** Boxes of the other editable shapes in view, for guides. */
function others(engine: PublishedMapEngine, selected: Feature[]): Box[] {
  const extent = engine.map.getView().calculateExtent(engine.map.getSize());
  return editableLayers(engine)
    .flatMap((layer) => layer.getSource()?.getFeaturesInExtent(extent) ?? [])
    .filter((feature) => !selected.includes(feature as Feature))
    .flatMap((feature) => {
      const geometry = feature.getGeometry();
      return geometry ? [geometry.getExtent() as Box] : [];
    });
}
function transformFor(
  drag: Drag,
  event: MapBrowserEvent,
  centre: Coordinate,
  around: Box[],
  resolution: number
): { transform: Transform; guides: Guide[] } {
  const [sx, sy] = drag.start;
  const [x, y] = event.coordinate;
  const about: [number, number] = [centre[0], centre[1]];
  const still: Transform = { translate: [0, 0], rotate: 0, scale: 1, about };
  if (drag.mode === "rotate") {
    let degrees =
      ((Math.atan2(y - centre[1], x - centre[0]) - Math.atan2(sy - centre[1], sx - centre[0])) *
        180) /
      Math.PI;
    if ((event.originalEvent as PointerEvent).shiftKey) degrees = Math.round(degrees / 15) * 15;
    return { transform: { ...still, rotate: degrees }, guides: [] };
  }
  if (drag.mode === "scale") {
    const from = Math.hypot(sx - centre[0], sy - centre[1]);
    const ratio = from > 0 ? Math.hypot(x - centre[0], y - centre[1]) / from : 1;
    return { transform: { ...still, scale: Math.max(ratio, 0.01) }, guides: [] };
  }
  const [dx, dy] = [x - sx, y - sy];
  const box = drag.originals.reduce((all, g) => extend(all, g.getExtent()), createEmpty()) as Box;
  const shifted: Box = [box[0] + dx, box[1] + dy, box[2] + dx, box[3] + dy];
  const snapped = snapToGuides(shifted, around, 8 * resolution);
  return {
    transform: { ...still, translate: [dx + snapped.dx, dy + snapped.dy] },
    guides: snapped.guides,
  };
}
function preview(drag: Drag, transform: Transform) {
  drag.previews.forEach((feature, index) => {
    const geometry = drag.originals[index].clone();
    geometry.rotate((transform.rotate * Math.PI) / 180, transform.about);
    geometry.scale(transform.scale, transform.scale, transform.about);
    geometry.translate(transform.translate[0], transform.translate[1]);
    feature.setGeometry(geometry);
  });
}
function showGuides(source: NonNullable<ReturnType<VectorLayer["getSource"]>>, guides: Guide[]) {
  for (const feature of source.getFeatures())
    if (feature.get("editRole") === "guide") source.removeFeature(feature);
  source.addFeatures(
    guides.map(
      (guide) =>
        new Feature({
          editRole: "guide",
          geometry: new LineString(
            guide.axis === "x"
              ? [
                  [guide.at, guide.from],
                  [guide.at, guide.to],
                ]
              : [
                  [guide.from, guide.at],
                  [guide.to, guide.at],
                ]
          ),
        })
    )
  );
}
const unchanged = (t: Transform) =>
  t.rotate === 0 && t.scale === 1 && Math.hypot(t.translate[0], t.translate[1]) === 0;
