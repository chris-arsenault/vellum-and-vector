import { useEffect, useRef } from "react";
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
  useEffect(() => {
    if (!viewer || tool !== "edit" || !state || !map) return;
    const live = () => latest.current!;
    return installRealScaleEditing(viewer.engine, {
      state: () => live().state,
      select: (selected) => live().set({ selected }),
      command: (command) => live().run(command),
      drawn: () => {
        if (!live().state.keepTool) live().set({ tool: "select" });
      },
      showSpace: (spaceId) => live().showSpace(spaceId),
    });
  }, [viewer, tool, state, map]);
  useFocus(viewer, state?.focus);
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
