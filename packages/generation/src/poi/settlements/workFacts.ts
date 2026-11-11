import { MapScale } from "@atlas/domain";

/**
 * The measures the catalogue's built places are sited and judged by: how far people go for a
 * thing, how much of it makes a work worth raising, and how many hands it takes to keep one.
 */
/** How far a band goes from its camp to tap a vein, in metres, and the fire that can be tapped. */
export const tappingReach = MapScale.length(0.00625),
  tappableFire = 100;
/** Degrees a forge at full use gives its seat, and the share of its heat that takes ice in a year. */
export const fullForgeHeat = 8,
  thawShare = 0.02;
/** Ice and cold that hold a memory in full, in metres and degrees of frost. */
export const memoryIce = MapScale.length(0.0000025),
  memoryCold = 10;
/** A town this large is worth a siege; a camp or a village changes hands without one. */
export const besiegedTown = 100;
/** Water a harbour stands in (m), the seat it may lie from (m), and the people who build one. */
export const harbourDepth = MapScale.length(0.0000075, 0.5),
  harbourReach = MapScale.length(0.0025),
  harbourHands = 1000;
/** Depth that lets a laden ship lie near the shore, and the Pressure that wrecks a mole. */
export const harbourGoodDepth = MapScale.length(0.0000025),
  harbourSurge = 400;
/** Ice thicker than this, in metres, is ground nobody settles. */
export const uninhabitableIce = MapScale.length(2.5e-7);
/** The people a settled place needs before it digs and keeps a work. */
export const settledHands = 500;
/** Soil water depth per diverted flow; exposure is folded into this inverse area. */
export const soilShare = MapScale.measure(3.2e11, -2);
/** The condition above which a work keeps its line. */
export const keptCondition = 0.5;
