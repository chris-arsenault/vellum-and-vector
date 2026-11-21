import { useEffect, useRef, useState } from "react";
import type { PublishedMapView } from "./PublishedMapView";
import type { PublishedTool } from "./publishedInteractions";
import type { AuthoringSession, AuthoringState } from "./useRealScaleAuthoring";
import { installRealScaleEditing } from "./realScaleEditing";

/** Install the editing interactions while the Edit tool is active on a real-scale map. */
export function useRealScaleEditing(
  viewer: PublishedMapView | null,
  tool: PublishedTool,
  session?: AuthoringSession
) {
  const latest = useRef(session);
  useEffect(() => {
    latest.current = session;
  });
  const state = session?.state;
  const map = session?.map;
  const installed = useInstalledState(state);
  useEffect(() => {
    if (!viewer || tool !== "edit" || !installed || !map) return;
    const live = () => latest.current!;
    return installRealScaleEditing(viewer.engine, {
      state: () => live().state,
      select: (selected) => live().set({ selected }),
      command: (command) => live().run(command),
      terrain: (edit) => live().terrain(edit),
      drawn: () => {
        if (!live().state.keepTool) live().set({ tool: "select" });
      },
      showSpace: (spaceId) => live().showSpace(spaceId),
    });
  }, [viewer, tool, installed, map]);
  useFocus(viewer, state?.focus);
}
/** The state as it was when the interactions were last installed, unless something but the
 * brush and height settings changed. Those are read as gestures happen; changing them must
 * not reinstall the interactions and abort a line half drawn. */
function useInstalledState(state: AuthoringState | undefined) {
  const [held, setHeld] = useState(state);
  if (state !== held && !sameButSettings(held, state)) setHeld(state);
  return held;
}
function sameButSettings(a: AuthoringState | undefined, b: AuthoringState | undefined) {
  if (!a || !b) return false;
  return (Object.keys(a) as (keyof AuthoringState)[]).every(
    (key) => key === "authored" || Object.is(a[key], b[key])
  );
}
/** Centre the view on a found building or street, closing in no further than it needs. */
function useFocus(viewer: PublishedMapView | null, focus: AuthoringState["focus"] | undefined) {
  useEffect(() => {
    if (!viewer || !focus) return;
    const [w, s, e, n] = focus.bounds;
    const view = viewer.engine.map.getView();
    const zoom = view.getZoom();
    view.fit([w, s, e, n], { padding: [120, 120, 120, 120], maxZoom: zoom, duration: 0 });
    view.setCenter([(w + e) / 2, (s + n) / 2]);
  }, [viewer, focus]);
}
