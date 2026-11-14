import { MapScale } from "@atlas/domain";
/** What water can dissolve. */
export const solutionSettings = {
  // How far fully soluble rock is lowered per unit of span, on fully wet ground.
  DissolvedPerSpan: MapScale.length(0.00002),
};
