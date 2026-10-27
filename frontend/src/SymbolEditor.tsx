import { useState, useRef } from "react";
import { ConfigProvider } from "antd";
import { Style } from "geostyler/dist/Component/Style/Style.js";
import { GeoStylerContext } from "geostyler/dist/context/GeoStylerContext/GeoStylerContext.js";
import OpenLayersParser from "geostyler-openlayers-parser";
import type { Style as SymbolStyle } from "geostyler-style";
import type { LayerStyle, World } from "./types";
import { defaultSymbolStyle } from "./vectorStyles";
import type { LayerPresentation } from "@atlas/domain";
import { useLayerPresentation } from "./useWorkspacePresentation";
import "geostyler/dist/index.css";

interface SymbolEditorProps {
  world: World;
  presentation: LayerStyle;
  apply: (symbols: SymbolStyle | undefined) => void;
  close: () => void;
}
export default function SymbolEditor(props: SymbolEditorProps) {
  const data = useLayerPresentation(props.world, props.presentation.layerId);
  if (data.isPending) return <p role="status">Reading layer attributes…</p>;
  if (data.error) return <p role="alert">{data.error.message}</p>;
  return <SymbolEditorForm {...props} data={data.data} />;
}
function SymbolEditorForm({
  world,
  presentation,
  apply,
  close,
  data,
}: SymbolEditorProps & { data: LayerPresentation }) {
  const layer = world.layers[presentation.layerId];
  const container = useRef<HTMLDivElement>(null);
  const [symbols, setSymbols] = useState(
    () => presentation.symbols ?? defaultSymbolStyle(layer.name, presentation, data.geometries)
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
function symbolContext(data: LayerPresentation): import("geostyler").GeoStylerContextInterface {
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
