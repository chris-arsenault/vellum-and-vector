import Collection from "ol/Collection.js";
import type Feature from "ol/Feature.js";
import OLFeature from "ol/Feature.js";
import Point from "ol/geom/Point.js";
import { getCenter } from "ol/extent.js";
import GeoJSON from "ol/format/GeoJSON.js";
import type OLGeometry from "ol/geom/Geometry.js";
import Draw from "ol/interaction/Draw.js";
import Modify from "ol/interaction/Modify.js";
import Snap from "ol/interaction/Snap.js";
import VectorLayer from "ol/layer/Vector.js";
import VectorSource from "ol/source/Vector.js";
import { unByKey } from "ol/Observable.js";
import type { Pixel } from "ol/pixel.js";
import type { EditCommand, EditOutcome, Geometry } from "@atlas/map";
import type { PublishedMapEngine } from "./publishedMapEngine";
import type { PublishedFeature } from "./publishedAppearance";
import { vectorFamily } from "./publishedAppearance";
import {
  drawShape,
  isAuthored,
  type DrawChoice,
  type AuthoringState,
  type EditTool,
} from "./useRealScaleAuthoring";
import { authoredInteractions, type AuthoredEvents } from "./authoredEditing";
import { drawCommand } from "./drawCommand";
import { installSelectionDrag } from "./realScaleDrag";
import { overlayStyle } from "./realScaleOverlay";
import { installBuilding, installStreet } from "./realScaleTown";
import {
  findHex,
  followSpace,
  installHexes,
  installPlace,
  installScatter,
  installWidthHandles,
} from "./realScaleLandEditing";

/** What the canvas asks of the edit session; every change runs as a Rust edit command. */
export interface EditingEvents extends AuthoredEvents {
  state(): AuthoringState;
  select(ids: string[]): void;
  command(command: EditCommand): Promise<EditOutcome | undefined>;
  drawn(): void;
  showSpace(spaceId: string): void;
}
const format = new GeoJSON();
export const toGeometry = (geometry: OLGeometry) =>
  format.writeGeometryObject(geometry) as unknown as Geometry;

/** Published layers a creator edits; hexes are derived from them and never edited directly. */
export function editableLayers(engine: PublishedMapEngine) {
  const authored = isAuthored(engine.descriptor);
  return [...engine.vectors.layers.entries()]
    .filter(([id]) => drawShape(id, undefined, authored) !== null)
    .map(([, layer]) => layer);
}
export function findFeature(engine: PublishedMapEngine, id: string): Feature | undefined {
  for (const layer of editableLayers(engine)) {
    const feature = layer.getSource()?.getFeatureById(id);
    if (feature) return feature as Feature;
  }
  return findHex(engine, id);
}
/** Editable features under a pixel, top first. */
export function hits(engine: PublishedMapEngine, pixel: Pixel) {
  const layers = new Set<unknown>(editableLayers(engine));
  const ids = engine.map
    .getFeaturesAtPixel(pixel, { hitTolerance: 6, layerFilter: (layer) => layers.has(layer) })
    .flatMap((feature) => {
      const record = feature.get("domain") as PublishedFeature | undefined;
      return record ? [record.id] : [];
    });
  return [...new Set(ids)];
}

export function installRealScaleEditing(engine: PublishedMapEngine, events: EditingEvents) {
  const state = events.state();
  const selected = state.selected.flatMap((id) => findFeature(engine, id) ?? []);
  const overlay = new VectorLayer({
    source: new VectorSource({ features: selected }),
    style: overlayStyle,
    zIndex: 900,
  });
  engine.map.addLayer(overlay);
  const cleanups = [installKeys(engine, events)];
  for (const install of toolInteractions[state.tool])
    cleanups.push(install({ engine, overlay, selected, events }));
  return () => {
    for (const cleanup of cleanups) cleanup();
    engine.map.removeLayer(overlay);
    overlay.getSource()?.clear(true);
  };
}
interface ToolScope {
  engine: PublishedMapEngine;
  overlay: VectorLayer;
  selected: Feature[];
  events: EditingEvents;
}
type Install = (scope: ToolScope) => () => void;
const select: Install = ({ engine, events }) => installSelect(engine, events);
/** The canvas interactions each tool installs. */
const toolInteractions: Record<EditTool, Install[]> = {
  select: [select, ({ engine, overlay, events }) => installSelectionDrag(engine, overlay, events)],
  points: [
    select,
    ({ engine, selected, events }) => installPoints(engine, selected, events),
    ({ engine, overlay, selected, events }) =>
      installWidthHandles(engine, overlay, selected[0], events),
  ],
  draw: [({ engine, events }) => installDraw(engine, events)],
  place: [({ engine, events }) => installPlace(engine, events)],
  scatter: [({ engine, events }) => installScatter(engine, events)],
  hexes: [({ engine, events }) => installHexes(engine, events)],
  street: [({ engine, events }) => installStreet(engine, events)],
  building: [({ engine, events }) => installBuilding(engine, events)],
  ...authoredInteractions,
};
function installKeys(engine: PublishedMapEngine, events: EditingEvents) {
  const key = (event: KeyboardEvent) => {
    if (event.key === "Escape") events.select([]);
  };
  engine.target.addEventListener("keydown", key);
  return () => engine.target.removeEventListener("keydown", key);
}
/** Click selects the top shape; Shift adds or removes; Alt steps down through stacked shapes. */
function installSelect(engine: PublishedMapEngine, events: EditingEvents) {
  const installed = performance.now();
  const click = engine.map.on("singleclick", (event) => {
    const pointer = event.originalEvent as PointerEvent;
    // A click of the drawing that just ended reports late; it is not a selection.
    if (pointer.timeStamp < installed) return;
    const found = hits(engine, event.pixel);
    const { selected } = events.state();
    if (!found.length) return events.select([]);
    if (pointer.altKey) {
      const index = found.indexOf(selected[0] ?? "");
      return events.select([found[(index + 1) % found.length]]);
    }
    if (pointer.shiftKey)
      return events.select(
        selected.includes(found[0])
          ? selected.filter((id) => id !== found[0])
          : [...selected, found[0]]
      );
    events.select([found[0]]);
  });
  return () => unByKey(click);
}
/** Snap new and moved points to water, ways and, when chosen, the hex grid. */
export function installSnaps(engine: PublishedMapEngine, hexes: boolean) {
  const sources = [...engine.vectors.layers.entries()]
    .filter(([id]) => drawShape(id) === "line")
    .flatMap(([, layer]) => layer.getSource() ?? []);
  if (hexes) sources.push(hexCentres(engine));
  const snaps = sources.map((source) => new Snap({ source, pixelTolerance: 8 }));
  for (const snap of snaps) engine.map.addInteraction(snap);
  return () => snaps.forEach((snap) => engine.map.removeInteraction(snap));
}
/** The centres of the published hexes in view, as points to snap to. */
function hexCentres(engine: PublishedMapEngine) {
  const extent = engine.map.getView().calculateExtent(engine.map.getSize());
  const hexes = [...engine.vectors.layers.entries()].find(([id]) => vectorFamily(id) === "hexes");
  const centres = (hexes?.[1].getSource()?.getFeaturesInExtent(extent) ?? []).flatMap((hex) => {
    const geometry = hex.getGeometry();
    return geometry ? [new OLFeature(new Point(getCenter(geometry.getExtent())))] : [];
  });
  return new VectorSource({ features: centres });
}
/** Drag a selected shape's vertices; the feature keeps its identity and attributes. */
function installPoints(engine: PublishedMapEngine, selected: Feature[], events: EditingEvents) {
  const target = selected.length === 1 ? selected[0] : undefined;
  if (!target) return () => {};
  const modify = new Modify({ features: new Collection([target]), pixelTolerance: 10 });
  let original: OLGeometry | undefined;
  modify.on("modifystart", () => {
    original = target.getGeometry()?.clone();
  });
  modify.on("modifyend", () => {
    const geometry = target.getGeometry();
    const record = target.get("domain") as PublishedFeature;
    if (!geometry) return;
    void events
      .command({ command: "reshape", id: record.id, geometry: toGeometry(geometry) })
      .then((done) => {
        if (!done && original) target.setGeometry(original);
      });
  });
  engine.map.addInteraction(modify);
  const snaps = installSnaps(engine, events.state().snapHexes);
  return () => {
    snaps();
    engine.map.removeInteraction(modify);
  };
}
function drawType(choice: DrawChoice) {
  if (choice.geometry) return choice.geometry;
  const shape = drawShape(choice.layerId, choice.kind);
  return shape === "line" ? "LineString" : shape === "area" ? "Polygon" : null;
}
/** Draw a new shape of the chosen layer and kind into the chosen creator layer. */
function installDraw(engine: PublishedMapEngine, events: EditingEvents) {
  const { draw: choice, target, snapHexes } = events.state();
  const type = choice && drawType(choice);
  if (!choice || !type) return () => {};
  const draw = new Draw({ type });
  draw.on("drawend", (event) => {
    const geometry = toGeometry(event.feature.getGeometry()!);
    void events.command(drawCommand(choice, geometry, target)).then((outcome) => {
      if (outcome) events.select(outcome.changed);
      followSpace(engine, events, choice.layerId)(outcome);
    });
    events.drawn();
  });
  engine.map.addInteraction(draw);
  const snaps = installSnaps(engine, snapHexes);
  const key = (event: KeyboardEvent) => {
    if (event.key === "Escape") draw.abortDrawing();
  };
  engine.target.addEventListener("keydown", key);
  return () => {
    engine.target.removeEventListener("keydown", key);
    snaps();
    engine.map.removeInteraction(draw);
  };
}
