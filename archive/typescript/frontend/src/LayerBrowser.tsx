import { useId } from "react";
import type { EditorState } from "./useEditor";
import type { FieldStyle } from "./types";
import { defaultFieldStyle } from "./rasterPresentation";
import { OverlayStack, type OverlayActions } from "./OverlayStack";
import { LayerCatalogue } from "./LayerCatalogue";
import { FeatureThemes } from "./FeatureThemes";
import { DrawnFieldsPanel } from "./DrawnFieldsPanel";
import { BaseMapChoices } from "./BaseMapChoices";

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
  const available = new Set<string>((editor.raster.data ?? []).map((r) => r.channel));
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
export function BaseChoices({
  editor,
  edit,
}: {
  editor: EditorState;
  edit: (target: string) => void;
}) {
  return (
    <BaseMapChoices
      view={editor.rasterView}
      change={(base) => editor.setRasterView((view) => ({ ...view, base }))}
      edit={() => edit("base:terrain")}
    />
  );
}
