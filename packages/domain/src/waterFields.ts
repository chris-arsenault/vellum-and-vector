import type { PhysicalFieldName } from "./physicalFields";
import { waterYearFields } from "./waterYearFields";

/**
 * Water on the land, as the map holds it. A cell's water column is what the cell itself
 * holds; the network is how water runs between cells and what the rivers carry; the yields
 * are what a cell's year of water gives the network. Rain, snow and warmth are the climate's
 * and are inputs to water, not part of it. One owner writes these bands
 * (packages/generation/src/water) and everything else asks it.
 */
export const waterColumn = {
  /** Snow lying on the cell through the year, as a depth of water over the cell. */
  snow: "SnowPack",
  /** Water held in the soil, as a depth over the cell. */
  soil: "SoilWater",
  /** Water held in the ground below the soil, as a depth over the cell. */
  ground: "GroundwaterStorage",
  /** Standing water on the cell: its depth and the height of its surface. */
  standing: "WaterDepths",
  surface: "WaterSurfaceElevations",
  /** What stands on the cell (none, sea, lake) and which body it belongs to. */
  kind: "WaterKindCodes",
  body: "WaterBodyIds",
  /** The deepest water the cell has held as a lake. */
  lakeMemory: "LakeMemory",
} as const satisfies Record<string, PhysicalFieldName>;

/** What a cell's year of water gives: to the surface, and into the ground. */
export const waterYields = [
  "Runoff",
  "FloodRunoff",
  "DryRunoff",
  "WaterRecharge",
  "SnowKept",
  "GlacialMeltwater",
  "ExternalMeltwater",
  "GroundwaterRecharge",
  "GroundwaterOutflow",
  "GroundwaterReturn",
  "GroundwaterExchangeVolume",
  ...waterYearFields,
] as const satisfies readonly PhysicalFieldName[];

/** Where water runs, and what runs there. */
export const waterNetwork = [
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
  "FloodFlow",
  "PerennialFlow",
  "FlowingMonths",
  "RiverOrders",
  "RiverSpineEdgeMasks",
  "RiverChannelOrders",
  "RiverChannelStrength",
  "RiverWidth",
  "RiverDepth",
] as const satisfies readonly PhysicalFieldName[];

/** Every band the water owner alone may write. */
export const waterBandNames: readonly PhysicalFieldName[] = [
  ...Object.values(waterColumn),
  ...waterYields,
  ...waterNetwork,
];
