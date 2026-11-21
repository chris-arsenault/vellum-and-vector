import type { EditCommand, Geometry, JsonValue } from "@atlas/map";
import type { DrawChoice } from "./useRealScaleAuthoring";

/** The drawStreet command for a street the Draw street tool finished: the chosen class, an
 * optional name, and the geometry whose ends join the ways they were snapped to. */
export function streetCommand(
  town: { roadClass: string; name: string },
  geometry: Geometry,
  creatorLayer: string
): EditCommand {
  return {
    command: "drawStreet",
    roadClass: town.roadClass,
    geometry,
    name: town.name.trim() || null,
    creatorLayer: creatorLayer || null,
  };
}
/** The create command for a shape the Draw tool finished. A real-scale line carries a width
 * at each point; an authored line, whose choice names its geometry, is a plain line. */
export function drawCommand(
  choice: DrawChoice,
  geometry: Geometry,
  creatorLayer: string
): EditCommand {
  const widths: Record<string, JsonValue> =
    geometry.type === "LineString" && !choice.geometry
      ? { widths: Array(geometry.coordinates.length).fill(choice.width) }
      : {};
  return {
    command: "create",
    layerId: choice.layerId,
    kind: choice.kind,
    name: choice.name.trim() || null,
    geometry,
    attributes: { ...choice.attributes, ...widths },
    creatorLayer: creatorLayer || null,
  };
}
