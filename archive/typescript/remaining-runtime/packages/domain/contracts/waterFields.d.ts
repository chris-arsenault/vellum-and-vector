import type { PhysicalFieldName } from "./physicalFields";
/**
 * Water on the land, as the map holds it. A cell's water column is what the cell itself
 * holds; the network is how water runs between cells and what the rivers carry; the yields
 * are what a cell's year of water gives the network. Rain, snow and warmth are the climate's
 * and are inputs to water, not part of it. One owner writes these bands
 * (packages/generation/src/water) and everything else asks it.
 */
export declare const waterColumn: {
  /** Snow lying on the cell through the year, as a depth of water over the cell. */
  readonly snow: "SnowPack";
  /** Water held in the soil, as a depth over the cell. */
  readonly soil: "SoilWater";
  /** Water held in the ground below the soil, as a depth over the cell. */
  readonly ground: "GroundwaterStorage";
  /** Standing water on the cell: its depth and the height of its surface. */
  readonly standing: "WaterDepths";
  readonly surface: "WaterSurfaceElevations";
  /** What stands on the cell (none, sea, lake) and which body it belongs to. */
  readonly kind: "WaterKindCodes";
  readonly body: "WaterBodyIds";
  /** The deepest water the cell has held as a lake. */
  readonly lakeMemory: "LakeMemory";
};
/** What a cell's year of water gives: to the surface, and into the ground. */
export declare const waterYields: readonly [
  "Runoff",
  "FloodRunoff",
  "DryRunoff",
  "WaterRecharge",
  "SeepageRecharge",
  "SnowKept",
  "GlacialMeltwater",
  "ExternalMeltwater",
  "GroundwaterRecharge",
  "GroundwaterOutflow",
  "GroundwaterReturn",
  "GroundwaterExchangeVolume",
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
];
/** Where water runs, and what runs there. */
export declare const waterNetwork: readonly [
  "FlowTargets",
  "FlowEdges",
  "DrainageElevations",
  "DrainageRanks",
  "DrainageGuidanceTargets",
  "DrainageBasinIds",
  "GroundwaterTargets",
  "LakeOutletTargets",
  "LakeOverflow",
  "CatchmentArea",
  "FlowAccumulation",
  "SmallChannelLength",
  "FloodFlow",
  "PerennialFlow",
  "FlowingMonths",
  "RiverOrders",
  "RiverSpineEdgeMasks",
  "RiverChannelOrders",
  "RiverChannelStrength",
  "RiverWidth",
  "RiverDepth",
];
/** Every band the water owner alone may write. */
export declare const waterBandNames: readonly PhysicalFieldName[];
