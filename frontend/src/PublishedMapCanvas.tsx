import { useCallback, useEffect, useRef, useState } from "react";
import Feature from "ol/Feature.js";
import GeoJSON from "ol/format/GeoJSON.js";
import type { Inspection, MapDescriptor, MapReader, RegionSelection } from "@atlas/map";
import { createPublishedMap, type PublishedMapEngine } from "./publishedMapEngine";
import { PublishedMapView, type PublishedPresentation } from "./PublishedMapView";
import { installPublishedInteractions, type PublishedTool } from "./publishedInteractions";
import { ErrorMessage } from "./ErrorMessage";
import { sheetPadding } from "./drawnSheet";
import { bounds } from "./presentation";
import { installPublishedRegions, type PublishedRegionEvents } from "./publishedRegionInteractions";

interface Props {
  map: MapDescriptor;
  reader: MapReader;
  spaceId: string;
  presentation: PublishedPresentation;
  tool: PublishedTool;
  selection: RegionSelection | null;
  onInspection(value: Inspection): void;
  regionEvents: PublishedRegionEvents;
  onEngine(value: PublishedMapEngine | null): void;
}
export function PublishedMapCanvas(props: Props) {
  return (
    <MapCanvas key={`${props.map.reference.mapId}:${props.map.reference.revision}`} {...props} />
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
      position: ([x, y]) => {
        if (coordinates.current)
          coordinates.current.textContent = `${(x * viewer.engine.space.metresPerUnit).toFixed(2)}, ${(y * viewer.engine.space.metresPerUnit).toFixed(2)} m`;
      },
    }));
  }, [viewer, reader, tool]);
  useEffect(() => {
    if (viewer)
      return installPublishedRegions(viewer.engine, tool, () => callbacks.current.regionEvents);
  }, [viewer, tool]);
  useEffect(() => showSelection(viewer, selection, map), [viewer, selection, map]);
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
      <div className="map-instruction">{instructions[tool]} · Esc: cancel</div>
      <ErrorMessage error={error} />
    </div>
  );
}
const instructions: Record<PublishedTool, string> = {
  pan: "Drag to pan",
  inspect: "Click a feature to inspect it",
  "inspect-cell": "Click to inspect this place",
  "region-pick": "Click inside a geographic or territorial boundary",
  "region-outline": "Draw a region; double-click or press Enter to finish",
  "region-cut": "Draw a dividing line; double-click to finish",
  "region-edit": "Drag outline vertices to adjust the boundary",
};
function showSelection(
  viewer: PublishedMapView | null,
  selection: RegionSelection | null,
  map: MapDescriptor
) {
  if (!viewer) return;
  const source = viewer.engine.selection.getSource()!;
  source.clear();
  if (
    selection?.parent.mapId === map.reference.mapId &&
    selection.parent.revision === map.reference.revision
  )
    source.addFeature(new Feature({ geometry: new GeoJSON().readGeometry(selection.geometry)! }));
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
