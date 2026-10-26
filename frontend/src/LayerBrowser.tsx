import { useId } from "react";
import type { EditorState } from "./useEditor";
import type { FieldStyle } from "./types";
import { defaultFieldStyle } from "./rasterPresentation";
import { OverlayStack, type OverlayActions } from "./OverlayStack";
import { LayerCatalogue } from "./LayerCatalogue";
import { FeatureThemes } from "./FeatureThemes";
import { DrawnFieldsPanel } from "./DrawnFieldsPanel";

function overlayActions(
  editor: EditorState,
  edit: (target: string) => void,
  target: string
): OverlayActions {
  return {
    update: (channel: string, changes: Partial<FieldStyle>) =>
      editor.setRasterView((view) => ({
        ...view,
        fields: view.fields.some((f) => f.channel === channel)
          ? view.fields.map((f) => (f.channel === channel ? { ...f, ...changes } : f))
          : [...view.fields, { ...defaultFieldStyle(channel), ...changes }],
      })),
    reorder: (channel: string, direction: number) =>
      editor.setRasterView((view) => {
        const next = [...view.fields],
          index = next.findIndex((f) => f.channel === channel);
        const destination = index + direction;
        if (destination < 0 || destination >= next.length) return view;
        [next[index], next[destination]] = [next[destination], next[index]];
        return { ...view, fields: next };
      }),
    remove: (channel: string) => {
      editor.setRasterView((view) => ({
        ...view,
        fields: view.fields.filter((f) => f.channel !== channel),
      }));
      if (target === `field:${channel}`) edit("");
    },
  };
}
export function LayerBrowser({
  editor,
  edit,
  target,
}: {
  editor: EditorState;
  edit: (target: string) => void;
  target: string;
}) {
  const catalogue = useId();
  const actions = overlayActions(editor, edit, target);
  const available = new Set((editor.raster.data ?? []).map((r) => r.channel));
  const fields = editor.rasterView.fields.filter((field) => available.has(field.channel));
  return (
    <section className="layer-browser" aria-label="Map layers">
      {editor.cartography.mode === "raster" ? (
        <>
          <div className="layer-section-title">
            <h3>Overlays</h3>
            <button className="quiet" popoverTarget={catalogue}>
              + Add overlay
            </button>
          </div>
          <LayerCatalogue
            id={catalogue}
            editor={editor}
            update={actions.update}
            remove={actions.remove}
          />
          <OverlayStack
            editor={editor}
            fields={fields}
            actions={actions}
            target={target}
            edit={edit}
          />
          {!fields.length && <p className="empty-overlays">No overlays</p>}
        </>
      ) : (
        <DrawnFieldsPanel editor={editor} />
      )}
      <FeatureThemes editor={editor} edit={edit} />
    </section>
  );
}
const baseLabels = { surface: "Surface", topographic: "Topographic", relief: "Relief" } as const;
export function BaseChoices({
  editor,
  edit,
}: {
  editor: EditorState;
  edit: (target: string) => void;
}) {
  return (
    <fieldset className="base-choices">
      <legend>Base map</legend>
      <div className="base-grid">
        {(["surface", "topographic", "relief"] as const).map((base) => (
          <label className={`base-choice ${base}`} key={base}>
            <input
              type="radio"
              name="base-map"
              aria-label={baseLabels[base]}
              checked={editor.rasterView.base === base}
              onChange={() => editor.setRasterView((view) => ({ ...view, base }))}
            />
            <svg className="base-preview" viewBox="0 0 140 72" aria-hidden="true">
              <path className="preview-water" d="M0 0H140V72H0Z" />
              <path className="preview-land" d="M0 0H120Q78 22 108 35T60 72H0Z" />
              <path
                className="preview-hill"
                d="M-10 62Q28 2 62 22T99 8M-5 76Q30 14 58 35T91 25M-12 88Q35 25 56 48T84 41"
              />
              <path className="preview-river" d="M22 0Q15 20 45 33T70 69" />
            </svg>
            <span>{baseLabels[base]}</span>
          </label>
        ))}
        <button
          className="quiet terrain-style"
          aria-label="Adjust terrain appearance"
          title="Adjust terrain appearance"
          onClick={() => edit("base:terrain")}
        >
          <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
            <path
              d="M2 4H14M2 8H14M2 12H14M5 2V6M11 6V10M7 10V14"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.5"
            />
          </svg>
        </button>
      </div>
    </fieldset>
  );
}
