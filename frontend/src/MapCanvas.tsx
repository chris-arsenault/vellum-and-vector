import { useEffect, useRef, useState } from "react";
import GeoJSON from "ol/format/GeoJSON.js";
import { Draw, Modify, Select } from "ol/interaction.js";
import { createBox } from "ol/interaction/Draw.js";
import type { Geometry } from "geojson";
import type { Area, AtlasFeature, LayerStyle, Optional, Raster, Tool, World } from "./types";
import { createMap, fitArea, updateFeatures, updateRaster, type MapEngine } from "./mapEngine";

interface Events {
  select: (feature: AtlasFeature | null) => void;
  draw: (geometry: Geometry) => void;
  modify: (feature: AtlasFeature, geometry: Geometry) => void;
  sculpt: (x: number, y: number) => void;
  enter: (id: string) => void;
  viewport: (extent: number[]) => void;
}
interface Props {
  world: World;
  area: Area;
  styles: LayerStyle[];
  raster: Optional<Raster[]>;
  baseRaster: Optional<Raster[]>;
  features: AtlasFeature[];
  tool: Tool;
  events: Events;
  proposal: AtlasFeature[];
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
    next.map.on("pointermove", (event) => {
      if (coordinates.current)
        coordinates.current.value = `${event.coordinate[0].toFixed(1)} E · ${event.coordinate[1].toFixed(1)} N · m`;
    });
    next.map.on("moveend", () => {
      const size = next.map.getSize();
      if (size?.[0] && size[1])
        callbacks.current.viewport(next.map.getView().calculateExtent(size));
    });
    return () => {
      next.map.setTarget(undefined);
      next.map.dispose();
    };
  }, [reference]);
  useEffect(() => {
    if (engine) updateFeatures(engine, world, area, styles, features);
  }, [engine, world, area, styles, features]);
  useEffect(() => {
    if (engine) updateRaster(engine, raster, baseRaster, styles);
  }, [engine, raster, baseRaster, styles]);
  useEffect(() => {
    if (engine && fittedArea.current !== area.id) {
      fitArea(engine, area);
      fittedArea.current = area.id;
      const size = engine.map.getSize();
      if (size?.[0] && size[1])
        callbacks.current.viewport(engine.map.getView().calculateExtent(size));
    }
  }, [engine, area]);
  useMapTools(engine, tool, callbacks);
  usePreview(engine, proposal);
  return (
    <div className="map-frame">
      <div className="map" ref={target} role="application" aria-label="World map canvas" />
      <button
        className="fit-map"
        onClick={() => {
          if (engine) fitArea(engine, area);
        }}
      >
        Fit area
      </button>
      <output className="coordinates" ref={coordinates}>
        World coordinates · metres
      </output>
      <div className="map-instruction">{instruction(tool)}</div>
    </div>
  );
}

function usePreview(engine: MapEngine | null, proposal: AtlasFeature[]) {
  useEffect(() => {
    if (!engine) return;
    const source = engine.preview.getSource()!;
    source.clear();
    source.addFeatures(
      proposal.flatMap((f) => new GeoJSON().readFeatures({ type: "Feature", geometry: f.geometry }))
    );
  }, [engine, proposal]);
}
function useMapTools(engine: MapEngine | null, tool: Tool, callbacks: React.RefObject<Events>) {
  useEffect(() => {
    if (!engine) return;
    const select = new Select({ layers: [engine.features], hitTolerance: 6 });
    if (tool === "select" || tool === "reshape") engine.map.addInteraction(select);
    select.on("select", (event) =>
      callbacks.current.select(event.selected[0]?.get("domain") ?? null)
    );
    const modify = new Modify({ features: select.getFeatures() });
    if (tool === "reshape") engine.map.addInteraction(modify);
    modify.on("modifyend", (event) =>
      event.features.forEach((feature) =>
        callbacks.current.modify(
          feature.get("domain"),
          new GeoJSON().writeGeometryObject(feature.getGeometry()!) as Geometry
        )
      )
    );
    const draw = createDraw(tool, callbacks);
    if (draw) engine.map.addInteraction(draw);
    const click = engine.map.on("singleclick", (event) => {
      if (tool === "sculpt") callbacks.current.sculpt(event.coordinate[0], event.coordinate[1]);
    });
    const double = engine.map.on("dblclick", (event) => {
      if (tool !== "select") return;
      engine.map.forEachFeatureAtPixel(event.pixel, (feature) => {
        const child = feature.get("area") as Optional<Area>;
        if (child) callbacks.current.enter(child.id);
      });
    });
    return () => {
      engine.map.removeInteraction(select);
      engine.map.removeInteraction(modify);
      if (draw) engine.map.removeInteraction(draw);
      engine.map.un("singleclick", click.listener);
      engine.map.un("dblclick", double.listener);
    };
  }, [engine, tool, callbacks]);
}

function createDraw(tool: Tool, callbacks: React.RefObject<Events>) {
  const types = {
    poi: "Point",
    road: "LineString",
    river: "LineString",
    polygon: "Polygon",
    refine: "Circle",
  } as const;
  if (!(tool in types)) return null;
  const draw = new Draw({
    type: types[tool as keyof typeof types],
    stopClick: true,
    geometryFunction: tool === "refine" ? createBox() : undefined,
  });
  draw.on("drawend", (event) =>
    callbacks.current.draw(
      new GeoJSON().writeGeometryObject(event.feature.getGeometry()!) as Geometry
    )
  );
  return draw;
}
function instruction(tool: Tool) {
  const labels: Record<Tool, string> = {
    select: "Select a feature · double-click a mapped area to enter",
    reshape: "Select a feature, then drag its vertices · boundary crossings stay locked",
    poi: "Click to place a located point",
    road: "Click to draw a road · double-click to finish",
    river: "Draw downstream · double-click to finish",
    polygon: "Draw a geographic polygon · double-click to finish",
    refine: "Drag a geographic extent to create detail",
    sculpt: "Click to sculpt the selected materialized field",
  };
  return labels[tool];
}
