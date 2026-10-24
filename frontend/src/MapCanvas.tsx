import { useEffect, useRef, useState } from "react";
import GeoJSON from "ol/format/GeoJSON.js";
import type { Area, AtlasFeature, LayerStyle, Optional, Raster, Tool, World } from "./types";
import { createMap, fitArea, updateFeatures, applyMapUpdate, type MapEngine } from "./mapEngine";
import { updateRaster } from "./rasterLayers";
import type { RasterPresentation } from "./types";
import { installMapTools, type MapEvents } from "./mapInteractions";
import { toolInstruction } from "./cartography";
import { useGenerationPreview } from "./useAtlas";
import { canonicalPosition } from "@atlas/domain";
interface Props {
  world: World;
  area: Area;
  styles: LayerStyle[];
  raster: Optional<Raster[]>;
  baseRaster: Optional<Raster[]>;
  features: AtlasFeature[];
  tool: Tool;
  events: MapEvents;
  selection: { feature: AtlasFeature | null; role: "primary" | "footprint" };
  proposal: AtlasFeature[];
  presentation: RasterPresentation;
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
  presentation,
  onEngine,
}: Props) {
  const target = useRef<HTMLDivElement>(null);
  const coordinates = useRef<HTMLOutputElement>(null);
  const [engine, setEngine] = useState<MapEngine | null>(null);
  const [reference] = useState(world.reference);
  const callbacks = useRef(events);
  useEffect(() => {
    callbacks.current = events;
  }, [events]);
  useEffect(() => {
    if (!target.current) return;
    const next = createMap(target.current, reference);
    setEngine(next);
    onEngine(next);
    observeMap(next, target, coordinates, callbacks);
    return () => {
      next.map.setTarget(undefined);
      next.map.getAllLayers().forEach((layer) => layer.dispose());
      next.map.dispose();
      onEngine(null);
    };
  }, [reference, onEngine]);
  useEffect(() => {
    if (engine) applyMapUpdate(engine, () => updateFeatures(engine, world, area, styles, features));
  }, [engine, world, area, styles, features]);
  const previewLabel = useGenerationRaster(
    engine,
    world,
    area.id,
    raster,
    baseRaster,
    presentation
  );
  useAreaFit(engine, area, callbacks);
  useFeatureTools(engine, tool, selection, callbacks, world.version);
  usePreview(engine, proposal);
  return (
    <div className="map-frame">
      <div
        className="map"
        ref={target}
        role="application"
        aria-label="World map canvas"
        aria-busy="true"
        onPointerDown={(event) => event.currentTarget.focus()}
      />
      <FitButton engine={engine} area={area} />
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
  version: number
) {
  const { feature, role } = selection;
  useEffect(() => {
    if (engine)
      return installMapTools(engine, tool, feature?.id ?? null, () => callbacks.current, role);
  }, [engine, tool, feature?.id, role, version, callbacks]);
}
function useAreaFit(engine: MapEngine | null, area: Area, callbacks: { current: MapEvents }) {
  const fittedArea = useRef("");
  useEffect(() => {
    if (engine && fittedArea.current !== area.id) {
      fitArea(engine, area);
      fittedArea.current = area.id;
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
function FitButton({ engine, area }: { engine: MapEngine | null; area: Area }) {
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
