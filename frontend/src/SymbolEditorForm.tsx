import { useState, useRef } from "react";
import { ConfigProvider } from "antd";
import { Style } from "geostyler/dist/Component/Style/Style.js";
import { GeoStylerContext } from "geostyler/dist/context/GeoStylerContext/GeoStylerContext.js";
import OpenLayersParser from "geostyler-openlayers-parser";
import type { Style as SymbolStyle } from "geostyler-style";
import type { LayerStyle } from "./types";
import { defaultSymbolStyle } from "./vectorStyles";
import type { Geometry } from "geojson";
import type { RenderFeature } from "./renderFeature";
import "geostyler/dist/index.css";

export interface SymbolEditorData {
  geometries: Geometry["type"][];
  properties: Record<string, { type: "string" | "number" | "boolean" }>;
  examples: RenderFeature[];
}
interface SymbolEditorProps {
  name: string;
  presentation: LayerStyle;
  apply: (symbols: SymbolStyle | undefined) => void;
  close: () => void;
}
export default function SymbolEditorForm({
  name,
  presentation,
  apply,
  close,
  data,
}: SymbolEditorProps & { data: SymbolEditorData }) {
  const container = useRef<HTMLDivElement>(null);
  const [symbols, setSymbols] = useState(
    () => presentation.symbols ?? defaultSymbolStyle(name, presentation, data.geometries)
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
        <GeoStylerContext.Provider value={symbolContext(data)}>
          {/* GeoStyler's style prop is symbol data, not a CSS style object. */}
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
function symbolContext(data: SymbolEditorData): import("geostyler").GeoStylerContextInterface {
  return {
    composition: { Editor: { rasterEditor: { visibility: false } } },
    data: {
      schema: { type: "object", properties: data.properties },
      exampleFeatures: {
        type: "FeatureCollection",
        features: data.examples.map((feature) => ({
          type: "Feature",
          id: feature.id,
          geometry: feature.geometry,
          properties: { ...feature.attributes, name: feature.name, kind: feature.kind },
        })),
      },
    },
  };
}
