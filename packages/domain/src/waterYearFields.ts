/**
 * A cell's year of water, month by month: what its surface gives the rivers in each of twelve
 * equal months, in millimetres. Month 0 is the coldest. The months are the year's rhythm in
 * whatever span a pass stands for; they are not time passing.
 */
export const waterMonths = 12;
type Month = 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 | 11;
export const waterYearFields = Array.from(
  { length: waterMonths },
  (_, month) => `SurfaceWaterMonth${month as Month}` as const
);
export type WaterYearField = (typeof waterYearFields)[number];
