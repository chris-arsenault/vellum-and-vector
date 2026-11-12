/**
 * Whether a cell carries a river, and what kind. Water runs over all wet ground in streams too
 * small for a map; a cell carries a river when the flow gathered to it is as much as a stretch
 * of the map's own cells would shed in a year of ordinary rain. That is a statement about what
 * a map of this cell size can show, and the same on every map. Everything that makes country
 * differ comes from the flow itself: dry, porous or level ground gathers little, a river loses
 * water where it crosses dry ground, and one fed only in its wet season runs only then.
 */
export const riverRegimes = { none: 0, perennial: 1, seasonal: 2 } as const;
export type RiverRegime = (typeof riverRegimes)[keyof typeof riverRegimes];

/** The cells of ordinary runoff whose gathered water makes a river a map can show. */
export const riverCells = 24;

/** The flow, in cubic metres a second, that makes a river on a map of this cell size. */
export function riverFlow(cellArea: number, ordinaryRunoff: number, cells = riverCells) {
  const metresPerSecond = Math.max(0, ordinaryRunoff) / 1000 / (365.25 * 86_400);
  return cells * Math.max(0, cellArea) * metresPerSecond;
}
/**
 * A river that still runs in its driest season is perennial; one that reaches a river's flow
 * only in flood is seasonal, and dry for the rest of the year; less than that is no river.
 */
export function riverRegime(flood: number, perennial: number, river: number): RiverRegime {
  if (!(river > 0) || !(flood >= river)) return riverRegimes.none;
  return perennial >= river ? riverRegimes.perennial : riverRegimes.seasonal;
}
