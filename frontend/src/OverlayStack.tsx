import { useEffect, useId, useRef, useState } from "react";
import { biomes } from "@atlas/domain";
import type { EditorState } from "./useEditor";
import type { FieldStyle } from "./types";
import { fieldLabel, palettes } from "./rasterPresentation";
import { FieldLegend, RasterPanel } from "./RasterPanel";

export interface OverlayActions {
  update: (channel: string, changes: Partial<FieldStyle>) => void;
  reorder: (channel: string, direction: number) => void;
  remove: (channel: string) => void;
}
interface StackProps {
  editor: EditorState;
  fields: FieldStyle[];
  actions: OverlayActions;
  target: string;
  edit: (target: string) => void;
}
export function OverlayStack(props: StackProps) {
  return (
    <div className="active-overlays" aria-label="Visible field legends">
      {props.fields.map((field, index) => (
        <OverlayRow key={field.channel} {...props} field={field} index={index} />
      ))}
    </div>
  );
}
type RowProps = StackProps & { field: FieldStyle; index: number };
function OverlayRow(props: RowProps) {
  const { editor, actions, target, field, edit } = props;
  const [expanded, setExpanded] = useState(false);
  const disclosure = useRef<HTMLDetailsElement>(null);
  const name = fieldLabel(editor.world, field.channel);
  const data = (editor.raster.data ?? []).filter((r) => r.channel === field.channel);
  const unit = data[0]?.field.units[field.channel] ?? "";
  const editing = target === `field:${field.channel}`;
  useEffect(() => {
    if (editing && disclosure.current) disclosure.current.open = true;
  }, [editing]);
  return (
    <details
      className={`overlay-row${field.visible ? "" : " overlay-hidden"}`}
      ref={disclosure}
      onToggle={(event) => setExpanded(event.currentTarget.open)}
    >
      <summary title={`Expand ${name} legend`}>
        <svg className="overlay-disclosure" viewBox="0 0 8 8" aria-hidden="true">
          <path d="M2 1L6 4L2 7Z" fill="currentColor" />
        </svg>
        <label className="check overlay-name">
          <input
            type="checkbox"
            aria-label={`Show ${name}`}
            checked={field.visible}
            onChange={(e) => actions.update(field.channel, { visible: e.target.checked })}
          />
          <OverlaySwatch field={field} />
          <span title={name}>{name}</span>
        </label>
        <small className="overlay-unit" title={unit}>
          {unit === "category" ? "Classes" : unit}
        </small>
        <OverlayOpacity name={name} field={field} update={actions.update} />
        <OverlayButtons
          {...props}
          name={name}
          editing={editing}
          onStyle={() => {
            disclosure.current!.open = true;
            edit(editing ? "" : `field:${field.channel}`);
          }}
        />
      </summary>
      {expanded && (
        <div className="overlay-content">
          {editing ? (
            <RasterPanel world={editor.world} editor={editor} target={target} />
          ) : (
            <FieldLegend world={editor.world} field={field} data={data} />
          )}
        </div>
      )}
    </details>
  );
}
function OverlayOpacity({
  name,
  field,
  update,
}: {
  name: string;
  field: FieldStyle;
  update: OverlayActions["update"];
}) {
  return (
    <label className="overlay-opacity">
      <input
        aria-label={`${name} opacity`}
        title={`${name} opacity`}
        type="range"
        min="0"
        max="100"
        value={Math.round(field.opacity * 100)}
        onChange={(e) => update(field.channel, { opacity: Number(e.target.value) / 100 })}
      />
      <output>{Math.round(field.opacity * 100)}%</output>
    </label>
  );
}
function OverlayButtons({
  field,
  index,
  fields,
  actions,
  editing,
  onStyle,
  name,
}: RowProps & {
  name: string;
  editing: boolean;
  onStyle: () => void;
}) {
  return (
    <>
      <button
        className="quiet"
        aria-label={`Style ${name}`}
        title={`Style ${name}`}
        aria-pressed={editing}
        onClick={onStyle}
      >
        <svg width="14" height="14" viewBox="0 0 16 16" aria-hidden="true">
          <path
            d="M2 4H14M2 8H14M2 12H14M5 2V6M11 6V10M7 10V14"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
          />
        </svg>
      </button>
      <button
        className="quiet overlay-order"
        disabled={index === 0}
        aria-label={`Move ${name} up`}
        title="Move overlay up"
        onClick={() => actions.reorder(field.channel, -1)}
      >
        ↑
      </button>
      <button
        className="quiet overlay-order"
        disabled={index === fields.length - 1}
        aria-label={`Move ${name} down`}
        title="Move overlay down"
        onClick={() => actions.reorder(field.channel, 1)}
      >
        ↓
      </button>
      <button
        className="quiet overlay-remove"
        aria-label={`Remove ${name}`}
        title="Remove overlay from the stack"
        onClick={() => actions.remove(field.channel)}
      >
        ×
      </button>
    </>
  );
}
function OverlaySwatch({ field }: { field: FieldStyle }) {
  const id = useId();
  const colors = field.channel === "biome" ? biomes.map((b) => b.color) : palettes[field.palette];
  return (
    <svg
      className="overlay-swatch"
      viewBox="0 0 24 8"
      aria-hidden="true"
      preserveAspectRatio="none"
    >
      {field.channel === "biome" ? (
        colors.map((color, i) => (
          <rect
            key={color}
            x={(i * 24) / colors.length}
            width={24 / colors.length}
            height="8"
            fill={color}
          />
        ))
      ) : (
        <>
          <defs>
            <linearGradient id={id}>
              {colors.map((color, i) => (
                <stop key={color} offset={i / (colors.length - 1)} stopColor={color} />
              ))}
            </linearGradient>
          </defs>
          <rect width="24" height="8" fill={`url(#${id})`} />
        </>
      )}
    </svg>
  );
}
