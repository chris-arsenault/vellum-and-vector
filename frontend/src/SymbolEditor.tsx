import { useState, useRef } from "react";
import { ConfigProvider } from "antd";
import { Style } from "geostyler/dist/Component/Style/Style.js";
import { GeoStylerContext } from "geostyler/dist/context/GeoStylerContext/GeoStylerContext.js";
import OpenLayersParser from "geostyler-openlayers-parser";
import type { Style as SymbolStyle } from "geostyler-style";
import type { LayerStyle, World } from "./types";
import { defaultSymbolStyle } from "./vectorStyles";
import "geostyler/dist/index.css";

export default function SymbolEditor({
  world,
  presentation,
  apply,
  close,
}: {
  world: World;
  presentation: LayerStyle;
  apply: (symbols: SymbolStyle | undefined) => void;
  close: () => void;
}) {
  const layer = world.layers[presentation.layerId];
  const container = useRef<HTMLDivElement>(null);
  const [symbols, setSymbols] = useState(
    () =>
      presentation.symbols ??
      defaultSymbolStyle(
        layer.name,
        presentation,
        Object.values(world.features)
          .filter((feature) => feature.layerId === layer.id)
          .map((feature) => feature.geometry.type)
      )
  );
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);
  async function save() {
    setPending(true);
    try {
      const result = await new OpenLayersParser().writeStyle(symbols);
      if (result.errors?.length) throw result.errors[0];
      apply(symbols);
      close();
    } catch (error) {
      setError(error instanceof Error ? error.message : String(error));
    } finally {
      setPending(false);
    }
  }
  return (
    <div className="symbol-editor" ref={container}>
      <ConfigProvider getPopupContainer={() => container.current!}>
        <GeoStylerContext.Provider value={symbolContext(world, presentation.layerId)}>
          {/* GeoStyler's style prop is symbol data, not a CSS style object. */}
          {/* eslint-disable-next-line ahara/no-inline-styles */}
          <Style style={symbols} onStyleChange={setSymbols} disableClassification />
        </GeoStylerContext.Provider>
      </ConfigProvider>
      {error && <p role="alert">{error}</p>}
      <div className="dialog-actions">
        <button
          onClick={() => {
            apply(undefined);
            close();
          }}
        >
          Reset to atlas style
        </button>
        <button onClick={close}>Cancel</button>
        <button disabled={pending} onClick={() => void save()}>
          Apply style
        </button>
      </div>
    </div>
  );
}
function symbolContext(
  world: World,
  layerId: string
): import("geostyler").GeoStylerContextInterface {
  const features = Object.values(world.features).filter((feature) => feature.layerId === layerId);
  const properties = { name: { type: "string" }, kind: { type: "string" } } as Record<
    string,
    { type: "string" | "number" | "boolean" }
  >;
  for (const feature of features)
    for (const [name, value] of Object.entries(feature.attributes)) {
      if (typeof value === "number" || typeof value === "boolean" || typeof value === "string")
        properties[name] = { type: typeof value as "number" | "boolean" | "string" };
    }
  return {
    composition: { Editor: { rasterEditor: { visibility: false } } },
    data: {
      schema: { type: "object", properties },
      exampleFeatures: {
        type: "FeatureCollection",
        features: features.map((feature) => ({
          type: "Feature",
          id: feature.id,
          geometry: feature.geometry,
          properties: { ...feature.attributes, name: feature.name, kind: feature.kind },
        })),
      },
    },
  };
}
