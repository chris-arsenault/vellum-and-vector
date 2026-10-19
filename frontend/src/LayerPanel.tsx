import { lazy, Suspense, useRef, useState, useEffect } from "react";
import type { World } from "./types";
import type { EditorState } from "./useEditor";
import { LayerBrowser } from "./LayerBrowser";
import { RasterPanel } from "./RasterPanel";
import { defaultRasterPresentation } from "./rasterPresentation";

const SymbolEditor = lazy(() => import("./SymbolEditor"));
export function LayerPanel({ world, editor }: { world: World; editor: EditorState }) {
  const [target, setTarget] = useState("base");
  const vector = target.startsWith("vector:") ? target.slice(7) : null;
  const style = editor.styles.find((style) => style.layerId === vector);
  return (
    <div className="layer-panel">
      <label>
        View preset
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
      <LayerBrowser editor={editor} edit={setTarget} />
      <RasterPanel world={world} editor={editor} target={target} edit={setTarget} />
      {style && (
        <StyleDialog name={world.layers[style.layerId].name} close={() => setTarget("base")}>
          <Suspense fallback={<p>Loading style editor…</p>}>
            <SymbolEditor
              world={world}
              presentation={style}
              close={() => setTarget("base")}
              apply={(symbols) =>
                editor.setStyles(
                  editor.styles.map((item) =>
                    item.layerId === style.layerId ? { ...item, symbols } : item
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
              value={style.minScale}
              onChange={(event) =>
                editor.setStyles(
                  editor.styles.map((item) =>
                    item.layerId === style.layerId
                      ? { ...item, minScale: Number(event.target.value) }
                      : item
                  )
                )
              }
            />
          </label>
        </StyleDialog>
      )}
      <SessionViews world={world} editor={editor} />
    </div>
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
          })
        }
      >
        Save map view
      </button>
      {world.views.map((view) => (
        <button
          className="quiet"
          key={view.id}
          onClick={() => {
            editor.enter(view.areaId);
            editor.setStyles(view.layers);
            editor.setRasterView(view.raster ?? defaultRasterPresentation());
          }}
        >
          {view.name}
        </button>
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
