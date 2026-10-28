import type { Tool } from "./types";
import { isRegionTool } from "./useRegions";

/** The identity under which a tool's map interactions are installed. Region selection and
 * refinement keep their sketch across unrelated world revisions; editing tools still follow the
 * revision because their interactions bind the selected feature's canonical geometry. */
export function interactionKey(
  tool: Tool,
  selectedId: string | null,
  role: "primary" | "footprint",
  version: number
) {
  return JSON.stringify([tool, selectedId, role, isRegionTool(tool) ? null : version]);
}
