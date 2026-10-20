import { useState } from "react";
import type { EditorState } from "./useEditor";
import type { FieldStyle } from "./types";
import { defaultFieldStyle, fieldLabel } from "./rasterPresentation";
import { FieldLegend } from "./RasterPanel";
import { LayerCatalogue } from "./LayerCatalogue";
import { FeatureThemes } from "./FeatureThemes";

function overlayActions(editor: EditorState) {
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
    remove: (channel: string) =>
      editor.setRasterView((view) => ({
        ...view,
        fields: view.fields.filter((f) => f.channel !== channel),
      })),
  };
}
export function LayerBrowser({
  editor,
  edit,
}: {
  editor: EditorState;
  edit: (target: string) => void;
}) {
  const [catalogue, setCatalogue] = useState(false);
  const available = new Set((editor.raster.data ?? []).map((r) => r.channel));
  const fields = editor.rasterView.fields.filter((field) => available.has(field.channel));
  return (
    <section className="layer-browser" aria-label="Map layers">
      <BaseChoices editor={editor} edit={edit} />
      <div className="layer-section-title">
        <h3>Overlays</h3>
        <button
          className="quiet"
          aria-expanded={catalogue}
          onClick={() => setCatalogue(!catalogue)}
        >
          {catalogue ? "Done" : "+ Add overlay"}
        </button>
      </div>
      {catalogue && <LayerCatalogue editor={editor} update={overlayActions(editor).update} />}
      <div className="active-overlays" aria-label="Visible field legends">
        {fields.map((field, index) => (
          <OverlayCard
            key={field.channel}
            editor={editor}
            field={field}
            index={index}
            count={fields.length}
            edit={edit}
          />
        ))}
      </div>
      {!fields.length && (
        <p className="empty-overlays">
          Layer temperature, water, people or magic over your terrain. Add an overlay to get
          started.
        </p>
      )}
      <FeatureThemes editor={editor} edit={edit} />
    </section>
  );
}
interface CardProps {
  editor: EditorState;
  field: FieldStyle;
  index: number;
  count: number;
  edit: (target: string) => void;
}
function OverlayCard({ editor, field, index, count, edit }: CardProps) {
  const name = fieldLabel(editor.world, field.channel);
  const actions = overlayActions(editor);
  return (
    <article className="overlay-card">
      <div className="overlay-heading">
        <label className="check">
          <input
            type="checkbox"
            aria-label={`Show ${name}`}
            checked={field.visible}
            onChange={(e) => actions.update(field.channel, { visible: e.target.checked })}
          />
          {name}
        </label>
        <button
          className="quiet"
          aria-label={`Style ${name}`}
          onClick={() => edit(`field:${field.channel}`)}
        >
          Style
        </button>
      </div>
      {field.visible && (
        <FieldLegend
          world={editor.world}
          field={field}
          data={(editor.raster.data ?? []).filter((r) => r.channel === field.channel)}
        />
      )}
      <div className="overlay-actions">
        <label>
          Opacity
          <input
            aria-label={`${name} opacity`}
            type="range"
            min="0"
            max="100"
            value={Math.round(field.opacity * 100)}
            onChange={(e) =>
              actions.update(field.channel, { opacity: Number(e.target.value) / 100 })
            }
          />
          <output>{Math.round(field.opacity * 100)}%</output>
        </label>
        <button
          className="quiet"
          disabled={index === 0}
          aria-label={`Move ${name} up`}
          onClick={() => actions.reorder(field.channel, -1)}
        >
          ↑
        </button>
        <button
          className="quiet"
          disabled={index === count - 1}
          aria-label={`Move ${name} down`}
          onClick={() => actions.reorder(field.channel, 1)}
        >
          ↓
        </button>
        <button
          className="quiet"
          aria-label={`Remove ${name}`}
          onClick={() => actions.remove(field.channel)}
        >
          ×
        </button>
      </div>
    </article>
  );
}
function BaseChoices({ editor, edit }: { editor: EditorState; edit: (target: string) => void }) {
  return (
    <fieldset className="base-choices">
      <legend>Base map</legend>
      <div className="base-grid">
        {(["topographic", "relief"] as const).map((base) => (
          <label className={`base-choice ${base}`} key={base}>
            <input
              type="radio"
              name="base-map"
              aria-label={base === "topographic" ? "Topographic" : "Relief"}
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
            <span>
              {base === "topographic" ? "Topographic" : "Relief"}
              <small>{base === "topographic" ? "Contours & terrain" : "Light & landforms"}</small>
            </span>
          </label>
        ))}
      </div>
      <button className="quiet terrain-style" onClick={() => edit("base:terrain")}>
        Adjust terrain appearance
      </button>
    </fieldset>
  );
}
