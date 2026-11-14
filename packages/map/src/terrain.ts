/** Published map bands used by all three base views; independent of generation channels. */
export const terrainLayerId = "terrain";
export const terrainBands = [
  "value",
  "relative-height",
  "water",
  "ice",
  "sample-span",
  "surface",
  "natural-surface",
  "display-height",
  "east-gradient",
  "north-gradient",
  "log-value",
  "paint-red",
  "paint-green",
  "paint-blue",
  "paint-alpha",
] as const;
