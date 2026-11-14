/**
 * A cell's year of water, month by month: what its surface gives the rivers in each of twelve
 * equal months, in millimetres. Month 0 is the coldest. The months are the year's rhythm in
 * whatever span a pass stands for; they are not time passing.
 */
export declare const waterMonths = 12;
export declare const waterYearFields: (
  | "SurfaceWaterMonth0"
  | "SurfaceWaterMonth1"
  | "SurfaceWaterMonth2"
  | "SurfaceWaterMonth3"
  | "SurfaceWaterMonth4"
  | "SurfaceWaterMonth6"
  | "SurfaceWaterMonth7"
  | "SurfaceWaterMonth8"
  | "SurfaceWaterMonth5"
  | "SurfaceWaterMonth9"
  | "SurfaceWaterMonth10"
  | "SurfaceWaterMonth11"
)[];
export type WaterYearField = (typeof waterYearFields)[number];
/** The established transfer year travels and is captured independently of ending held contents. */
export declare const waterYearStateFields: readonly [
  ...(
    | "SurfaceWaterMonth0"
    | "SurfaceWaterMonth1"
    | "SurfaceWaterMonth2"
    | "SurfaceWaterMonth3"
    | "SurfaceWaterMonth4"
    | "SurfaceWaterMonth6"
    | "SurfaceWaterMonth7"
    | "SurfaceWaterMonth8"
    | "SurfaceWaterMonth5"
    | "SurfaceWaterMonth9"
    | "SurfaceWaterMonth10"
    | "SurfaceWaterMonth11"
  )[],
  "WaterRecharge",
  "SnowKept",
];
