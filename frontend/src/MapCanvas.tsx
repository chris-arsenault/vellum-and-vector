import { useEffect, useRef, useState } from "react";
import GeoJSON from "ol/format/GeoJSON.js";
import type { Area, AtlasFeature, LayerStyle, Optional, Raster, Tool, World } from "./types";
import { createMap, fitArea, updateFeatures, applyMapUpdate, type MapEngine } from "./mapEngine";
import { updateRaster } from "./rasterLayers";
import type { RasterPresentation } from "./types";
import { installMapTools, type MapEvents } from "./mapInteractions";
import { toolInstruction } from "./cartography";
interface Props {
  world: World;
  area: Area;
  styles: LayerStyle[];
  raster: Optional<Raster[]>;
  baseRaster: Optional<Raster[]>;
  features: AtlasFeature[];
  tool: Tool;
  events: MapEvents;
  selected: AtlasFeature | null;
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
  selected,
  presentation,
  onEngine,
}: Props) {
  const target = useRef<HTMLDivElement>(null);
  const coordinates = useRef<HTMLOutputElement>(null);
  const [engine, setEngine] = useState<MapEngine | null>(null);
  const fittedArea = useRef("");
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
  useEffect(() => {
    if (engine)
      applyMapUpdate(engine, () =>
        updateRaster(engine, world, raster ?? [], baseRaster ?? [], presentation)
      );
  }, [engine, world, raster, baseRaster, presentation]);
  useEffect(() => {
    if (engine && fittedArea.current !== area.id) {
      fitArea(engine, area);
      fittedArea.current = area.id;
      reportViewport(engine, callbacks.current);
    }
  }, [engine, area]);
  useEffect(() => {
    if (engine) return installMapTools(engine, tool, selected?.id ?? null, () => callbacks.current);
  }, [engine, tool, selected?.id]);
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
      <div className="map-instruction">{toolInstruction(tool)} · Space: pan · Esc: cancel</div>
    </div>
  );
}
function observeMap(
  engine: MapEngine,
  target: import("react").RefObject<HTMLDivElement | null>,
  coordinates: import("react").RefObject<HTMLOutputElement | null>,
  callbacks: import("react").RefObject<MapEvents>
) {
  engine.map.on("pointermove", (event) => showCoordinates(coordinates.current, event.coordinate));
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
