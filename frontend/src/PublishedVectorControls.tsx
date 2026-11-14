import { lazy, Suspense, useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import type { LayerStyle } from "./types";
import type { MapLayer } from "@atlas/map";
import { VectorAppearanceControls } from "./VectorAppearanceControls";
import { PanelBoundary } from "./PanelBoundary";
import { publishedFeature } from "./publishedAppearance";
import type { PublishedStyleContext } from "./publishedStyling";
const SymbolEditor = lazy(() => import("./SymbolEditorForm"));

export function PublishedVectorControls({
  context,
  layerId,
}: {
  context: PublishedStyleContext;
  layerId: string;
}) {
  const [advanced, setAdvanced] = useState(false);
  const { map, value, change } = context;
  const layer = map.layers.find((layer) => layer.id === layerId)!;
  const style = value.styles.find((style) => style.layerId === layerId);
  if (!style) return null;
  const update = (changes: Partial<LayerStyle>) =>
    change({
      ...value,
      styles: value.styles.map((style) =>
        style.layerId === layerId ? { ...style, ...changes } : style
      ),
    });
  return (
    <>
      <VectorAppearanceControls
        name={layer.name}
        presentation={style}
        kinds={layer.catalog.geometries}
        mode={value.drawing.mode}
        update={update}
        advanced={() => setAdvanced(true)}
      />
      <DrawOrder context={context} layerId={layerId} />
      {advanced && (
        <AdvancedSymbols
          context={context}
          presentation={style}
          update={update}
          close={() => setAdvanced(false)}
        />
      )}
    </>
  );
}
function DrawOrder({
  context: { map, value, change },
  layerId,
}: {
  context: PublishedStyleContext;
  layerId: string;
}) {
  const at = value.styles.findIndex((style) => style.layerId === layerId);
  return (
    <label>
      Draw order
      <select
        aria-label="Draw order"
        value={value.styles[at + 1]?.layerId ?? "bottom"}
        onChange={(event) => {
          const selected = value.styles[at],
            styles = value.styles.filter((style) => style.layerId !== layerId);
          const target =
            event.target.value === "bottom"
              ? styles.length
              : styles.findIndex((style) => style.layerId === event.target.value);
          styles.splice(target, 0, selected);
          change({ ...value, styles });
        }}
      >
        {value.styles
          .filter((style) => style.layerId !== layerId)
          .map((style) => (
            <option key={style.layerId} value={style.layerId}>
              Above {map.layers.find((layer) => layer.id === style.layerId)!.name}
            </option>
          ))}
        <option value="bottom">Below all feature layers</option>
      </select>
    </label>
  );
}
function useSymbolExamples(context: PublishedStyleContext, layer: MapLayer) {
  const { examples, properties, geometries } = layer.catalog;
  return useQuery({
    queryKey: ["map-symbol-examples", context.map.reference, layer.id],
    queryFn: async ({ signal }) => {
      const features = examples.length
        ? (
            await context.reader.features(
              context.map.reference,
              {
                spaceId: layer.spaceId,
                layerIds: [layer.id],
                featureIds: examples,
              },
              { signal }
            )
          ).items
        : [];
      return {
        examples: features.map(publishedFeature),
        properties,
        geometries,
      };
    },
  });
}
function AdvancedSymbols({
  context,
  presentation: style,
  update,
  close,
}: {
  context: PublishedStyleContext;
  presentation: LayerStyle;
  update(changes: Partial<LayerStyle>): void;
  close(): void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const layer = context.map.layers.find((layer) => layer.id === style.layerId)!;
  const data = useSymbolExamples(context, layer);
  useEffect(() => {
    dialog.current?.showModal();
  }, []);
  return (
    <dialog
      className="style-dialog"
      ref={dialog}
      aria-label={`Style ${layer.name}`}
      onCancel={close}
    >
      <header>
        <h2>Style {layer.name}</h2>
        <button onClick={close} aria-label="Close style editor">
          ×
        </button>
      </header>
      <PanelBoundary name="The style editor">
        {data.error && <p role="alert">{data.error.message}</p>}
        {data.isPending && <p role="status">Reading layer attributes…</p>}
        {data.data && (
          <Suspense fallback={<p>Loading style editor…</p>}>
            <SymbolEditor
              name={layer.name}
              presentation={style}
              data={data.data}
              close={close}
              apply={(symbols) => update({ symbols })}
            />
          </Suspense>
        )}
      </PanelBoundary>
      <label>
        Minimum metres per pixel
        <input
          type="number"
          min="0"
          step="any"
          value={style.minScale}
          onChange={(event) => update({ minScale: Number(event.target.value) })}
        />
      </label>
    </dialog>
  );
}
