import { useEffect, useRef } from "react";
import type { MapReader } from "@atlas/map";
import { ErrorMessage } from "./ErrorMessage";
import { Icon } from "./AuthoredIcons";
import { AuthoredKinds } from "./AuthoredKinds";
import { AuthoredPalette } from "./AuthoredPalette";
import { AuthoredToolOptions } from "./AuthoredTerrainTools";
import { RealScaleProperties } from "./RealScaleProperties";
import { useSelectedFeatures } from "./useSelectedFeatures";
import { AddressSearch } from "./RealScaleTown";
import { runShortcut, shortcutFor } from "./authoredActions";
import { isCityProfile } from "./authoredState";
import type { ActionKind } from "./authoredUndo";
import type { AuthoringSession } from "./useRealScaleAuthoring";
import "./authoredEditor.css";

/** Shortcuts act while the editor is open, except while typing in a field. */
function useShortcuts(session: AuthoringSession) {
  const latest = useRef(session);
  useEffect(() => {
    latest.current = session;
  });
  useEffect(() => {
    const key = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (target?.closest("input, textarea, select, [contenteditable]")) return;
      const action = shortcutFor(event);
      if (!action) return;
      event.preventDefault();
      runShortcut(latest.current, action);
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, []);
}
const actionName = (kind: ActionKind | undefined) =>
  kind === "t" ? "terrain edit" : kind === "f" ? "shape edit" : "edit";
function UndoRedo({ session }: { session: AuthoringSession }) {
  return (
    <div className="authored-history-buttons" role="group" aria-label="Undo and redo">
      <button
        type="button"
        disabled={!session.canUndo || session.busy}
        title={
          session.busy
            ? "Wait for the current edit to finish"
            : session.canUndo
              ? `Undo last ${actionName(session.undoKind)} (Ctrl+Z)`
              : "Nothing to undo yet"
        }
        onClick={() => void session.undo()}
      >
        <Icon name="undo" />
        <span>Undo</span>
      </button>
      <button
        type="button"
        disabled={!session.canRedo || session.busy}
        title={
          session.busy
            ? "Wait for the current edit to finish"
            : session.canRedo
              ? `Redo ${actionName(session.redoKind)} (Ctrl+Shift+Z)`
              : "Nothing to redo"
        }
        onClick={() => void session.redo()}
      >
        <Icon name="redo" />
        <span>Redo</span>
      </button>
    </div>
  );
}
function Selection({ session, reader }: { session: AuthoringSession; reader: MapReader }) {
  const selected = useSelectedFeatures(session, reader);
  if (!session.state.selected.length) return null;
  return (
    <section className="authored-selection" aria-label="Selected shape">
      <RealScaleProperties session={session} selected={selected} units="metres" />
      <button
        type="button"
        className="danger"
        disabled={session.busy}
        title={session.busy ? "Wait for the current edit to finish" : "Delete selection (Delete)"}
        onClick={() =>
          void session
            .run({ command: "delete", ids: session.state.selected })
            .then(() => session.set({ selected: [] }))
        }
      >
        Delete selection
      </button>
    </section>
  );
}
function History({ session }: { session: AuthoringSession }) {
  return (
    <details className="authored-log">
      <summary>Shape history</summary>
      {session.steps.length === 0 ? (
        <p>No edits yet.</p>
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
    </details>
  );
}
/** The editing panel of an authored map: coasts, elevation, water and any catalogue kind,
 * drawn by hand on a map that began as open ocean (ADR 0019). */
export function AuthoredEditor({
  session,
  reader,
}: {
  session: AuthoringSession;
  reader: MapReader;
}) {
  useShortcuts(session);
  return (
    <aside className="right-panel authoring-panel authored-panel" aria-label="Map editing">
      <header className="authored-head">
        <h2>Draw the map</h2>
        <UndoRedo session={session} />
      </header>
      <AuthoredPalette session={session} />
      <AuthoredToolOptions session={session} />
      {isCityProfile(session.map.profile) && <AddressSearch session={session} reader={reader} />}
      <ErrorMessage error={session.error} />
      <Selection session={session} reader={reader} />
      <AuthoredKinds session={session} />
      <History session={session} />
    </aside>
  );
}
