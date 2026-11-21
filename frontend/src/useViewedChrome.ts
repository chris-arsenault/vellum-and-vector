import { useEffect, useState } from "react";
import type { MapDescriptor, SavedMapDocument } from "@atlas/map";
import { startingPresentation, type ViewedChrome } from "./carriedPresentation";
import type { PublishedTool } from "./publishedInteractions";

/** A carried tool only holds if this map can still use it. */
function usableTool(tool: PublishedTool | undefined, map: MapDescriptor): PublishedTool {
  // An authored map opens ready to draw (ADR 0019).
  if (map.realScale?.kind === "authored") return "edit";
  if (!tool || tool === "region-edit") return "inspect";
  if ((tool === "edit" || tool === "measure") && !map.realScale) return "inspect";
  if (tool.startsWith("region-") && !map.regionScale.enabled) return "inspect";
  return tool;
}
/**
 * The workspace chrome: presentation, open panel and active tool. Opening another map
 * starts from the chrome of the one just viewed instead of resetting it.
 */
export function useViewedChrome(
  map: MapDescriptor,
  saved: SavedMapDocument | undefined,
  viewed: ViewedChrome | undefined
) {
  const [appearance, change] = useState(() =>
    startingPresentation(map, saved, viewed?.read()?.presentation ?? null)
  );
  const [tool, setRegionTool] = useState(() => usableTool(viewed?.read()?.tool, map));
  const [panel, showPanel] = useState(() => viewed?.read()?.panel ?? "regions");
  useEffect(
    () => viewed?.write({ presentation: appearance, panel, tool }),
    [viewed, appearance, panel, tool]
  );
  return { appearance, change, tool, setRegionTool, panel, showPanel };
}
