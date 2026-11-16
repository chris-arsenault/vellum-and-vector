import { useEffect, useRef } from "react";
import type { PublishedMapView } from "./PublishedMapView";
import type { PublishedTool } from "./publishedInteractions";
import type { AuthoringSession } from "./useRealScaleAuthoring";
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
    });
  }, [viewer, tool, state, map]);
}
