import { useCallback, useEffect, useRef, useState } from "react";
import Feature from "ol/Feature.js";
import GeoJSON from "ol/format/GeoJSON.js";
import type { Geometry, Inspection, MapDescriptor, MapReader, RegionSelection } from "@atlas/map";
import { createPublishedMap, type PublishedMapEngine } from "./publishedMapEngine";
import { PublishedMapView, type PublishedPresentation } from "./PublishedMapView";
import { installPublishedInteractions, type PublishedTool } from "./publishedInteractions";
import { ErrorMessage } from "./ErrorMessage";
import { sheetPadding } from "./drawnSheet";
import { bounds } from "./presentation";
import { installPublishedRegions, type PublishedRegionEvents } from "./publishedRegionInteractions";
import { installMeasure } from "./realScaleMeasure";
import type { AuthoringSession } from "./useRealScaleAuthoring";
import { CanvasEditing } from "./CanvasEditing";

interface Props {
  map: MapDescriptor;
  reader: MapReader;
  spaceId: string;
  presentation: PublishedPresentation;
  tool: PublishedTool;
  selection: RegionSelection | null;
  highlight?: Geometry;
  onInspection(value: Inspection, at: { x: number; y: number }): void;
  regionEvents: PublishedRegionEvents;
  onEngine(value: PublishedMapEngine | null): void;
  /** The edit session of a real-scale map; world and regional maps have none. */
  authoring?: AuthoringSession;
}
export function PublishedMapCanvas(props: Props) {
  return (
    // An edit that opens a located space (a cave level) gives the canvas a new space to show.
    <MapCanvas
      key={`${props.map.reference.mapId}:${props.map.reference.revision}:${props.map.spaces.map((space) => space.id).join(",")}`}
      {...props}
    />
  );
}
function MapCanvas(props: Props) {
  const [descriptor] = useState(() => ({ ...props.map }));
  const [viewer, setViewer] = useState<PublishedMapView | null>(null);
  const [busy, setBusy] = useState(true),
    [error, setError] = useState<Error | null>(null);
  const callbacks = useRef(props);
  const coordinates = useRef<HTMLOutputElement>(null);
  useEffect(() => {
    callbacks.current = props;
  }, [props]);
  const { map, reader, spaceId, tool, presentation, selection } = props;
  const mount = useCallback(
    (element: HTMLDivElement | null) => {
      if (!element) return;
      const engine = createPublishedMap(element, descriptor, reader, spaceId);
      const next = new PublishedMapView(engine, reader, {
        busy: (busy) => {
          setBusy(busy);
          if (busy) setError(null);
        },
        error: setError,
      });
      setViewer(next);
      callbacks.current.onEngine(engine);
      engine.map.getView().fit(descriptor.bounds, { padding: [35, 35, 35, 35] });
      return () => {
        callbacks.current.onEngine(null);
        void next.close();
      };
    },
    [descriptor, reader, spaceId]
  );
  useEffect(() => {
    if (viewer) {
      viewer.receive(map);
      void viewer.update(presentation);
    }
  }, [viewer, presentation, map]);
  useEffect(() => {
    if (!viewer) return;
    return installPublishedInteractions(viewer.engine, reader, tool, () => ({
      inspected: callbacks.current.onInspection,
      error: setError,
      position: (position) => showCoordinates(coordinates.current, viewer, position),
    }));
  }, [viewer, reader, tool]);
  useEffect(() => {
    if (viewer)
      return installPublishedRegions(viewer.engine, tool, () => callbacks.current.regionEvents);
  }, [viewer, tool]);
  useHighlight(viewer, selection, props.highlight);
  const measured = useMeasure(viewer, tool, callbacks);
  return (
    <div className={`map-frame${presentation.drawing.mode === "drawn" ? " drawn-map" : ""}`}>
      <div
        className="map"
        ref={mount}
        role="application"
        aria-label="World map canvas"
        aria-busy={busy}
        onPointerDown={(event) => event.currentTarget.focus()}
      />
      <button className="fit-map" onClick={() => fit(viewer, presentation)}>
        Fit map
      </button>
      <output className="coordinates" ref={coordinates}>
        Map coordinates · metres
      </output>
      <CanvasEditing viewer={viewer} tool={tool} map={map} authoring={props.authoring} />
      {measured}
      <div className="map-instruction">{instructions[tool]} · Esc: cancel</div>
      <ErrorMessage error={error} />
    </div>
  );
}
function showCoordinates(
  output: HTMLOutputElement | null,
  viewer: PublishedMapView,
  [x, y]: number[]
) {
  const metres = viewer.engine.space.metresPerUnit;
  if (output) output.textContent = `${(x * metres).toFixed(2)}, ${(y * metres).toFixed(2)} m`;
}
/** The temporary measuring tool on real-scale maps and its read-out. */
function useMeasure(
  viewer: PublishedMapView | null,
  tool: PublishedTool,
  callbacks: { current: Props }
) {
  const [measured, setMeasured] = useState("");
  useEffect(() => {
    if (viewer && tool === "measure")
      return installMeasure(
        viewer.engine,
        () => callbacks.current.presentation.realScale?.units ?? "metres",
        setMeasured
      );
  }, [viewer, tool, callbacks]);
  if (tool !== "measure") return null;
  return (
    <output className="measured-distance" aria-label="Measured distance">
      {measured}
    </output>
  );
}
const instructions: Record<PublishedTool, string> = {
  pan: "Drag to pan",
  inspect: "Click the map to list what is there",
  "inspect-cell": "Click the map to list what is there",
  "region-pick": "Click inside a boundary to select it · Shift+drag a line to split it first",
  "region-outline": "Click each corner; double-click or press Enter to finish",
  "region-lasso": "Press and drag around the area you want",
  "region-edit": "Drag outline vertices to adjust the boundary",
  measure: "Click points to measure; double-click to finish",
  edit: "Click a shape to select it; drag to move; Ctrl+K lists commands",
};
function useHighlight(
  viewer: PublishedMapView | null,
  selection: RegionSelection | null,
  highlight: Geometry | undefined
) {
  useEffect(
    () => showSelection(viewer, selection?.geometry ?? highlight),
    [viewer, selection, highlight]
  );
}
function showSelection(viewer: PublishedMapView | null, geometry: Geometry | undefined) {
  if (!viewer) return;
  const source = viewer.engine.selection.getSource()!;
  source.clear();
  if (geometry) source.addFeature(new Feature({ geometry: new GeoJSON().readGeometry(geometry)! }));
}
function fit(viewer: PublishedMapView | null, presentation: PublishedPresentation) {
  if (!viewer) return;
  const { engine } = viewer;
  engine.map.getView().fit(bounds(presentation.footprint), {
    padding:
      presentation.drawing.mode === "drawn"
        ? sheetPadding(engine.furniture.get("sheet"), engine.map.getSize()?.[0] ?? 1200)
        : [35, 35, 35, 35],
  });
}
