import type { Position } from "./model";
import type { GridSurface } from "./grids";
import { type AdaptivePointLocator } from "./adaptivePoint";
/**
 * The class at a point, reconstructed from per-cell memberships. Each candidate class's
 * 0/1 membership is interpolated with the shared Hermite patches and the highest wins.
 * Cell centres keep their stored class. Regular grids blend memberships bilinearly.
 * Region margins can use classMarginInterpolator to trace the same winning transition.
 */
export declare function classInterpolator(
  grid: GridSurface<string>,
  channel: string,
  locate?: AdaptivePointLocator
): (p: Position) => number;
/** Signed margin of a family against other classes, using the raster's exact class weights. */
export declare function classMarginInterpolator(
  grid: GridSurface<string>,
  channel: string,
  includes: (code: number) => boolean,
  locate?: AdaptivePointLocator
): (p: Position) => number;
