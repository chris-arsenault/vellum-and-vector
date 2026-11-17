import { useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { collectPages, type MapReader } from "@atlas/map";
import { ErrorMessage } from "./ErrorMessage";
import { RealScaleProperties } from "./RealScaleProperties";
import { RealScaleLayers } from "./RealScaleLayers";
import { RealScaleLevels } from "./RealScaleLevels";
import { RealScaleCommandPalette } from "./RealScaleCommandPalette";
import { LandOptions, LandToolBar } from "./RealScaleLandTools";
import { AddressSearch, TownOptions, TownToolBar } from "./RealScaleTown";
import { RealScaleHexClasses } from "./RealScaleHexClasses";
import { isHex, withLatentLayers } from "./realScaleLandTools";
import { actionFor, chooseTool, editActions, type ActionContext } from "./realScaleActions";
import type { LengthUnits } from "./realScaleFields";
import {
  authorableLayers,
  drawShape,
  type AuthoringSession,
  type EditTool,
} from "./useRealScaleAuthoring";

interface Props {
  session: AuthoringSession;
  reader: MapReader;
  units: LengthUnits;
}
/** The selected features as published, re-read after every edit. */
function useSelectedFeatures(session: AuthoringSession, reader: MapReader) {
  const { map, state } = session;
  const query = useQuery({
    queryKey: ["edited-features", map.reference, state.selected, map.realScale?.edits ?? 0],
    enabled: state.selected.length > 0,
    // A selection can lie on the surface, in the caves or on a building's level.
    queryFn: async ({ signal }) =>
      (
        await Promise.all(
          map.spaces.map((space) =>
            collectPages((cursor) =>
              reader.features(
                map.reference,
                { spaceId: space.id, featureIds: state.selected, cursor },
                { signal }
              )
            )
          )
        )
      ).flat(),
  });
  return state.selected.length ? (query.data ?? []) : [];
}
/** Shortcuts act while the editor is open, except while typing in a field. */
function useShortcuts(context: ActionContext) {
  const latest = useRef(context);
  useEffect(() => {
    latest.current = context;
  });
  useEffect(() => {
    const key = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (target?.closest("input, textarea, select, [contenteditable]")) return;
      const action = actionFor(event);
      if (!action || action.blocked(latest.current)) return;
      event.preventDefault();
      void action.run(latest.current);
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, []);
}
export function RealScaleEditor({ session, reader, units }: Props) {
  const selected = useSelectedFeatures(session, reader);
  const [palette, setPalette] = useState(false);
  const context: ActionContext = { session, reader, selected, openPalette: () => setPalette(true) };
  useShortcuts(context);
  return (
    <aside className="right-panel authoring-panel" aria-label="Map editing">
      <h2>Edit map</h2>
      <p className="authoring-note">
        Edits change this map&apos;s published layers; generation no longer replaces it.
      </p>
      <ToolBar session={session} />
      <LandToolBar session={session} />
      <TownToolBar session={session} />
      {session.state.tool === "draw" && <DrawOptions session={session} />}
      <LandOptions session={session} />
      <TownOptions session={session} />
      <AddressSearch session={session} reader={reader} />
      <ActionBar context={context} />
      <ErrorMessage error={session.error} />
      {selected.length && selected.every(isHex) ? (
        <RealScaleHexClasses session={session} hexes={selected} />
      ) : (
        <RealScaleProperties session={session} selected={selected} units={units} />
      )}
      <RealScaleLevels session={session} />
      <RealScaleLayers session={session} />
      <EditHistory session={session} />
      {palette && <RealScaleCommandPalette context={context} close={() => setPalette(false)} />}
    </aside>
  );
}
const tools: [EditTool, string][] = [
  ["select", "Select and move"],
  ["points", "Edit points"],
  ["draw", "Draw"],
];
function ToolBar({ session }: { session: AuthoringSession }) {
  const { state, set } = session;
  return (
    <div role="toolbar" aria-label="Editing tools">
      {tools.map(([id, label]) => (
        <button key={id} aria-pressed={state.tool === id} onClick={() => chooseTool(session, id)}>
          {label}
        </button>
      ))}
      <label className="check">
        <input
          type="checkbox"
          checked={state.keepTool}
          onChange={(event) => set({ keepTool: event.target.checked })}
        />
        Keep tool in hand
      </label>
      <label className="check">
        <input
          type="checkbox"
          checked={state.snapHexes}
          onChange={(event) => set({ snapHexes: event.target.checked })}
        />
        Snap to hex grid
      </label>
    </div>
  );
}
function DrawOptions({ session }: { session: AuthoringSession }) {
  const { map, state, set } = session;
  const choice = state.draw;
  if (!choice) return <p>This map has no layer to draw into.</p>;
  const layers = withLatentLayers(map, authorableLayers(map));
  const kinds = layers.find((layer) => layer.id === choice.layerId)?.catalog.featureTypes ?? [];
  const change = (next: Partial<typeof choice>) => set({ draw: { ...choice, ...next } });
  return (
    <fieldset>
      <legend>New shape</legend>
      <label>
        Layer
        <select
          value={choice.layerId}
          onChange={(event) => {
            const layer = layers.find((entry) => entry.id === event.target.value);
            change({
              layerId: event.target.value,
              kind: layer?.catalog.featureTypes[0]?.kind ?? "",
            });
          }}
        >
          {layers.map((layer) => (
            <option key={layer.id} value={layer.id}>
              {layer.name}
            </option>
          ))}
        </select>
      </label>
      <label>
        Kind
        <select value={choice.kind} onChange={(event) => change({ kind: event.target.value })}>
          {kinds.map((kind) => (
            <option key={kind.id} value={kind.kind}>
              {kind.label}
            </option>
          ))}
        </select>
      </label>
      <label>
        Name
        <input value={choice.name} onChange={(event) => change({ name: event.target.value })} />
      </label>
      {drawShape(choice.layerId, choice.kind) === "line" && (
        <label>
          Width (m)
          <input
            type="number"
            min={0.1}
            step={0.1}
            value={choice.width}
            onChange={(event) =>
              change({ width: Math.max(Number(event.target.value) || 0.1, 0.1) })
            }
          />
        </label>
      )}
    </fieldset>
  );
}
const bar = [
  "undo",
  "redo",
  "delete",
  "duplicate",
  "same-kind",
  "copy-style",
  "paste-style",
  "lock",
  "palette",
];
function ActionBar({ context }: { context: ActionContext }) {
  return (
    <div role="toolbar" aria-label="Editing actions" className="authoring-actions">
      {editActions
        .filter((action) => bar.includes(action.id))
        .map((action) => {
          const blocked = action.blocked(context);
          return (
            <button
              key={action.id}
              disabled={!!blocked || context.session.busy}
              title={blocked ?? `${action.name} (${action.shortcut})`}
              onClick={() => void action.run(context)}
            >
              {action.name}
            </button>
          );
        })}
    </div>
  );
}
function EditHistory({ session }: { session: AuthoringSession }) {
  return (
    <section aria-label="Edit history">
      <h3>History</h3>
      {session.steps.length === 0 ? (
        <p>No edits yet</p>
      ) : (
        <ol>
          {session.steps.map((step) => (
            <li key={step.sequence} className={step.undone ? "undone" : undefined}>
              {step.label}
              {step.undone ? " (undone)" : ""}
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}
