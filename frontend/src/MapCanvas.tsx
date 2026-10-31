import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import GeoJSON from "ol/format/GeoJSON.js";
import type { Area, AtlasFeature, LayerStyle, Optional, Raster, Tool, World } from "./types";
import { createMap, fitArea, updateFeatures, applyMapUpdate, type MapEngine } from "./mapEngine";
import { updateRaster } from "./rasterLayers";
import type { RasterPresentation } from "./types";
import { installMapTools, type MapEvents } from "./mapInteractions";
import { interactionKey } from "./interactionLifetime";
import { toolInstruction } from "./cartography";
import { useGenerationPreview } from "./useAtlas";
import { updateRegionMap, type RegionPresentation } from "./regionMap";
import { canonicalPosition } from "@atlas/domain";
import type { CartographicPresentation } from "@atlas/domain";
import { updateDrawnMap, type DrawnMapInput } from "./drawnMap";
interface Props {
  world: World;
  area: Area;
  styles: LayerStyle[];
  raster: Optional<Raster[]>;
  baseRaster: Optional<Raster[]>;
  features: AtlasFeature[];
  tool: Tool;
  events: MapEvents;
  selection: {
    feature: AtlasFeature | null;
    role: "primary" | "footprint";
    region?: RegionPresentation;
  };
  proposal: AtlasFeature[];
  presentation: { raster: RasterPresentation; cartography: CartographicPresentation };
  onEngine: (engine: MapEngine | null) => void;
}

export function MapCanvas({
  world,
  area,
  styles,
  raster,
  baseRaster,
  tool,
  events,
  proposal,
  features,
  selection,
  presentation: appearance,
  onEngine,
}: Props) {
  const { raster: presentation, cartography } = appearance;
  const region = selection.region;
  const target = useRef<HTMLDivElement>(null);
  const coordinates = useRef<HTMLOutputElement>(null);
  const callbacks = useRef(events);
  useEffect(() => {
    callbacks.current = events;
  }, [events]);
  const { engine, mount } = useCanvasEngine(
    world.reference,
    onEngine,
    target,
    coordinates,
    callbacks
  );
  const editable = useEditableFeatures(features, selection.feature);
  useFeaturePresentation(engine, {
    world,
    area,
    styles,
    features: editable,
    view: cartography,
    region,
    base: baseRaster,
  });
  const previewLabel = useGenerationRaster(
    engine,
    world,
    area.id,
    raster,
    baseRaster,
    presentation
  );
  const subject = region ? { id: region.id ?? area.id, footprint: region.footprint } : area;
  useAreaFit(engine, subject, callbacks);
  useDrawnPresentation(engine, {
    world,
    region,
    area,
    view: cartography,
    features,
    styles,
    base: baseRaster ?? [],
    rasters: raster ?? [],
  });
  useFeatureTools(engine, tool, selection, callbacks, world.version, area.id);
  usePreview(engine, proposal);
  return (
    <CanvasSurface
      engine={engine}
      target={mount}
      coordinates={coordinates}
      tool={tool}
      previewLabel={previewLabel}
      subject={subject}
      cartography={cartography}
    />
  );
}
function useEditableFeatures(features: AtlasFeature[], selected: AtlasFeature | null) {
  // Selection loads canonical geometry for editing; overview products never become edits.
  return useMemo(
    () =>
      selected
        ? features.map((feature) => (feature.id === selected.id ? selected : feature))
        : features,
    [features, selected]
  );
}
function useDrawnPresentation(engine: MapEngine | null, input: DrawnMapInput) {
  useEffect(() => {
    if (!engine) return;
    updateRegionMap(engine, input.region);
    updateDrawnMap(engine, input);
  }, [engine, input]);
}
function useFeaturePresentation(
  engine: MapEngine | null,
  input: Pick<DrawnMapInput, "world" | "area" | "styles" | "features" | "view" | "region"> & {
    base: Optional<Raster[]>;
  }
) {
  const { world, area, styles, features, view, region, base } = input;
  useEffect(() => {
    if (engine)
      applyMapUpdate(engine, () =>
        updateFeatures(
          engine,
          world,
          area,
          styles,
          features,
          view,
          region?.footprint ?? area.footprint
        )
      );
  }, [engine, world, area, styles, features, view, region, base]);
}
function useCanvasEngine(
  initialReference: World["reference"],
  onEngine: Props["onEngine"],
  targetRef: import("react").RefObject<HTMLDivElement | null>,
  coordinates: import("react").RefObject<HTMLOutputElement | null>,
  callbacks: import("react").RefObject<MapEvents>
) {
  const [reference] = useState(initialReference);
  const [engine, setEngine] = useState<MapEngine | null>(null);
  const mount = useCallback(
    (element: HTMLDivElement | null) => {
      if (!element) return;
      targetRef.current = element;
      const next = createMap(element, reference);
      setEngine(next);
      onEngine(next);
      observeMap(next, targetRef, coordinates, callbacks);
      return () => {
        next.map.setTarget(undefined);
        next.map.getAllLayers().forEach((layer) => layer.dispose());
        next.map.dispose();
        onEngine(null);
        targetRef.current = null;
      };
    },
    [reference, onEngine, targetRef, coordinates, callbacks]
  );
  return { engine, mount };
}
interface SurfaceProps {
  engine: MapEngine | null;
  target: import("react").RefCallback<HTMLDivElement>;
  coordinates: import("react").RefObject<HTMLOutputElement | null>;
  tool: Tool;
  previewLabel: string | null | undefined;
  subject: Pick<Area, "id" | "footprint">;
  cartography: CartographicPresentation;
}
function CanvasSurface({
  engine,
  target,
  coordinates,
  tool,
  previewLabel,
  subject,
  cartography,
}: SurfaceProps) {
  return (
    <div className={`map-frame${cartography.mode === "drawn" ? " drawn-map" : ""}`}>
      <div
        className="map"
        ref={target}
        role="application"
        aria-label="World map canvas"
        aria-busy="true"
        onPointerDown={(event) => event.currentTarget.focus()}
      />
      <FitButton engine={engine} area={subject} />
      <output className="coordinates" ref={coordinates}>
        World coordinates · metres
      </output>
      <div className="map-instruction">
        {previewLabel ? `Generation preview · ${previewLabel} · ` : ""}
        {toolInstruction(tool)} · Space: pan · Esc: cancel
      </div>
    </div>
  );
}
function useFeatureTools(
  engine: MapEngine | null,
  tool: Tool,
  selection: Props["selection"],
  callbacks: import("react").RefObject<MapEvents>,
  version: number,
  areaId: string
) {
  const { feature, role } = selection;
  const selectedId = feature?.id ?? null;
  const key = interactionKey(tool, selectedId, role, version, areaId);
  useEffect(() => {
    if (engine) return installMapTools(engine, tool, selectedId, () => callbacks.current, role);
    // The key carries the active map, tool, target and (for editing tools) revision.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [engine, key, callbacks]);
}
function useAreaFit(
  engine: MapEngine | null,
  area: Pick<Area, "id" | "footprint">,
  callbacks: { current: MapEvents }
) {
  const fittedArea = useRef("");
  useEffect(() => {
    const signature = JSON.stringify([area.id, area.footprint]);
    if (engine && fittedArea.current !== signature) {
      fitArea(engine, area);
      fittedArea.current = signature;
      reportViewport(engine, callbacks.current);
    }
  }, [engine, area, callbacks]);
}
function useGenerationRaster(
  engine: MapEngine | null,
  world: World,
  areaId: string,
  raster: Optional<Raster[]>,
  baseRaster: Optional<Raster[]>,
  presentation: RasterPresentation
) {
  const preview = useGenerationPreview(world.id, areaId);
  useEffect(() => {
    if (!engine) return;
    const grid = preview?.grid;
    const base = baseRaster?.length
      ? baseRaster
      : grid
        ? [
            {
              id: grid.id,
              areaId,
              footprint: grid.scope.footprint,
              bounds: grid.bounds,
              channel: "elevation",
              field: grid,
              water: grid.channels.water ? grid : undefined,
              ice: grid.channels.ice ? grid : undefined,
              surface: grid.channels.finalSurface ? grid : undefined,
            },
          ]
        : [];
    applyMapUpdate(engine, () => updateRaster(engine, world, raster ?? [], base, presentation));
  }, [engine, world, areaId, raster, baseRaster, presentation, preview]);
  return !baseRaster?.length ? preview?.label : null;
}
function observeMap(
  engine: MapEngine,
  target: import("react").RefObject<HTMLDivElement | null>,
  coordinates: import("react").RefObject<HTMLOutputElement | null>,
  callbacks: import("react").RefObject<MapEvents>
) {
  engine.map.on("pointermove", (event) => {
    const p = canonicalPosition(engine.reference, {
      x: event.coordinate[0],
      y: event.coordinate[1],
      z: 0,
    });
    showCoordinates(coordinates.current, [p.x, p.y]);
  });
  engine.map.on("moveend", () => reportViewport(engine, callbacks.current));
  const busy = () => target.current?.setAttribute("aria-busy", "true");
  engine.map.on("loadstart", busy);
  engine.map.on("movestart", busy);
  engine.map.on("rendercomplete", () => target.current?.setAttribute("aria-busy", "false"));
}
function reportViewport(engine: MapEngine, events: MapEvents) {
  const size = engine.map.getSize();
  if (size?.[0] && size[1]) events.viewport(engine.map.getView().calculateExtent(size));
}
function showCoordinates(output: HTMLOutputElement | null, coordinate: number[]) {
  if (output) output.value = `${coordinate[0].toFixed(1)} E · ${coordinate[1].toFixed(1)} N · m`;
}
function FitButton({ engine, area }: { engine: MapEngine | null; area: Pick<Area, "footprint"> }) {
  return (
    <button
      className="fit-map"
      onClick={() => {
        if (engine) fitArea(engine, area);
      }}
    >
      Fit area
    </button>
  );
}

function usePreview(engine: MapEngine | null, proposal: AtlasFeature[]) {
  useEffect(() => {
    if (!engine) return;
    const source = engine.preview.getSource()!;
    const signature = JSON.stringify(proposal.map((feature) => feature.geometry));
    if (source.get("signature") === signature) return;
    source.set("signature", signature);
    source.clear();
    source.addFeatures(
      proposal.flatMap((f) => new GeoJSON().readFeatures({ type: "Feature", geometry: f.geometry }))
    );
  }, [engine, proposal]);
}
