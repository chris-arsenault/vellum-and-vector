import type { MapDescriptor } from "@atlas/map";
import type { PublishedMapView } from "./PublishedMapView";
import type { PublishedTool } from "./publishedInteractions";
import type { AuthoringSession } from "./useRealScaleAuthoring";
import { useRealScaleEditing } from "./useRealScaleEditing";
import { useAuthoredCanvas } from "./useAuthoredCanvas";

/** The canvas's editing: the interactions of the edit tool on a real-scale or authored map
 * and, on an authored map, the terrain reload after each rewrite and the height under the
 * pointer. Other maps render nothing. */
export function CanvasEditing(props: {
  viewer: PublishedMapView | null;
  tool: PublishedTool;
  map: MapDescriptor;
  authoring?: AuthoringSession;
}) {
  const { viewer, tool, map, authoring } = props;
  useRealScaleEditing(viewer, tool, authoring);
  const elevation = useAuthoredCanvas(
    viewer,
    map.realScale?.kind === "authored" ? authoring?.stamp : undefined
  );
  if (!elevation) return null;
  return (
    <output className="elevation-readout" aria-label="Elevation under the cursor">
      {elevation}
    </output>
  );
}
