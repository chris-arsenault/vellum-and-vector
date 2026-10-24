import { lazy, Suspense, useRef, useState, useEffect } from "react";
import type { World } from "./types";
import type { EditorState } from "./useEditor";
import { LayerBrowser } from "./LayerBrowser";
import { RasterPanel } from "./RasterPanel";
import { defaultRasterPresentation } from "./rasterPresentation";
import { VectorAppearance } from "./VectorAppearance";
import { FeatureDrawOrder } from "./FeatureDrawOrder";

const SymbolEditor = lazy(() => import("./SymbolEditor"));
export function LayerPanel({ world, editor }: { world: World; editor: EditorState }) {
  const [target, setTarget] = useState("");
  const [advanced, setAdvanced] = useState(false);
  const appearance = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!target) return;
    appearance.current?.scrollIntoView({ block: "nearest" });
    appearance.current?.querySelector<HTMLButtonElement>("button")?.focus({ preventScroll: true });
  }, [target]);
  const edit = (target: string) => {
    setTarget(target);
    setAdvanced(false);
  };
  const vector = target.startsWith("vector:") ? target.slice(7) : null;
  const style = editor.styles.find((style) => style.layerId === vector);
  return (
    <div className="layer-panel">
      <label className="view-preset">
        Preset
        <select
          aria-label="View preset"
          defaultValue="physical"
          onChange={(event) => editor.preset(event.target.value)}
        >
          {["physical", "political", "cultural", "magical", "infrastructure"].map((preset) => (
            <option key={preset}>{preset}</option>
          ))}
        </select>
      </label>
      <LayerBrowser editor={editor} edit={edit} target={target} />
      {target && !target.startsWith("field:") && (
        <div className="contextual-style" ref={appearance}>
          <button className="quiet" onClick={() => edit("")}>
            ← Back to map layers
          </button>
          <RasterPanel world={world} editor={editor} target={target} />
          {style && (
            <>
              <VectorAppearance
                editor={editor}
                presentation={style}
                advanced={() => setAdvanced(true)}
              />
              <FeatureDrawOrder editor={editor} layerId={style.layerId} />
            </>
          )}
        </div>
      )}
      {style && advanced && (
        <AdvancedSymbols editor={editor} presentation={style} close={() => setAdvanced(false)} />
      )}
      <SessionViews world={world} editor={editor} />
    </div>
  );
}
function AdvancedSymbols({
  editor,
  presentation,
  close,
}: {
  editor: EditorState;
  presentation: import("./types").LayerStyle;
  close: () => void;
}) {
  return (
    <StyleDialog name={editor.world.layers[presentation.layerId].name} close={close}>
      <Suspense fallback={<p>Loading style editor…</p>}>
        <SymbolEditor
          world={editor.world}
          presentation={presentation}
          close={close}
          apply={(symbols) =>
            editor.setStyles(
              editor.styles.map((item) =>
                item.layerId === presentation.layerId ? { ...item, symbols } : item
              )
            )
          }
        />
      </Suspense>
      <label>
        Minimum metres per pixel
        <input
          type="number"
          min="0"
          step="any"
          value={presentation.minScale}
          onChange={(e) =>
            editor.setStyles(
              editor.styles.map((item) =>
                item.layerId === presentation.layerId
                  ? { ...item, minScale: Number(e.target.value) }
                  : item
              )
            )
          }
        />
      </label>
    </StyleDialog>
  );
}
function SessionViews({ world, editor }: { world: World; editor: EditorState }) {
  const [name, setName] = useState("Custom composition");
  return (
    <details className="session-views">
      <summary>Session map views</summary>
      <label>
        View name
        <input value={name} onChange={(event) => setName(event.target.value)} />
      </label>
      <button
        className="secondary"
        disabled={!name.trim()}
        onClick={() =>
          editor.execute("setView", {
            id: crypto.randomUUID(),
            name: name.trim(),
            areaId: editor.area.id,
            layers: editor.styles,
            raster: editor.rasterView,
            regionId: editor.region?.id,
          })
        }
      >
        Save map view
      </button>
      {world.views
        .filter((view) => !view.region)
        .map((view) => (
          <div key={view.id}>
            <button
              className="quiet"
              onClick={() => {
                editor.enter(view.areaId);
                if (view.regionId) editor.enterRegion(view.regionId);
                editor.setStyles(view.layers);
                editor.setRasterView(view.raster ?? defaultRasterPresentation());
              }}
            >
              {view.name}
            </button>
            <button
              className="quiet"
              aria-label={`Remove ${view.name}`}
              onClick={() => editor.execute("removeView", { id: view.id })}
            >
              ×
            </button>
          </div>
        ))}
    </details>
  );
}
function StyleDialog({
  name,
  close,
  children,
}: {
  name: string;
  close: () => void;
  children: import("react").ReactNode;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    dialog.current?.showModal();
  }, []);
  return (
    <dialog className="style-dialog" ref={dialog} aria-label={`Style ${name}`} onCancel={close}>
      <header>
        <h2>Style {name}</h2>
        <button onClick={close} aria-label="Close style editor">
          ×
        </button>
      </header>
      {children}
    </dialog>
  );
}
