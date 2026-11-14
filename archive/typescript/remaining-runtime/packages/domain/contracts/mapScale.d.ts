import type { Bounds } from "./spatial";
export interface RelativeMeasure {
  readonly kind: "relative-measure";
  readonly fraction: number;
  readonly dimension: number;
  readonly exponent: number;
  readonly unit?: LengthUnit;
}
type LengthUnit = "m" | "km" | "mm" | "ft" | "native";
declare const resolvedSettings: unique symbol;
export type ResolvedSettings<T> = ResolvedMeasures<T> & {
  readonly [resolvedSettings]: true;
};
type RelativeOverrides<T> = Partial<ResolvedMeasures<T>> & {
  readonly [resolvedSettings]?: never;
};
export type ResolvedMeasures<T> = T extends RelativeMeasure
  ? number
  : T extends object
    ? {
        [K in keyof T]: ResolvedMeasures<T[K]>;
      }
    : T;
export interface ScaleDefinition<T extends object> {
  readonly kind: "relative-settings";
  readonly values: T;
}
/**
 * The sole conversion authority for generated geographic dimensions.
 * Fractions use an equal-area 4:3 frame's width: changing aspect ratio alone does not
 * change an isotropic process radius. Nonlinear laws act on a dimensionless size ratio.
 * Resolution affects explicit cell support, never the size of a declared landform.
 *
 * owner-direction(2026-11-12): geology is shares of the map; digital representation precision is fixed.
 */
export declare class MapScale {
  readonly width: number;
  readonly height: number;
  readonly cellSpan: number;
  static readonly referenceWidth = 4000000;
  static readonly referenceHeight = 3000000;
  static readonly nativePerMetre = 1024;
  private static readonly unitFactors;
  readonly span: number;
  constructor(width: number, height: number, cellSpan: number);
  static fromBounds(bounds: Bounds, cellSpan: number): MapScale;
  static fromCells(bounds: Bounds, cells: number): MapScale;
  /** Explicit reference context for supplied contract fixtures. */
  static reference(cellSpan?: number): MapScale;
  static length(fraction: number, exponent?: number, unit?: LengthUnit): RelativeMeasure;
  static area(fraction: number, exponent?: number): RelativeMeasure;
  static volume(fraction: number, exponent?: number): RelativeMeasure;
  static inverseLength(fraction: number, exponent?: number): RelativeMeasure;
  static measure(
    fraction: number,
    dimension: RelativeMeasure["dimension"],
    exponent?: number,
    unit?: LengthUnit
  ): RelativeMeasure;
  static definitions<T extends object>(values: T): ScaleDefinition<T>;
  private static checkExponent;
  private basis;
  length(fraction: number, exponent?: number): number;
  area(fraction: number, exponent?: number): number;
  volume(fraction: number, exponent?: number): number;
  inverseLength(fraction: number, exponent?: number): number;
  fraction(length: number, exponent?: number): number;
  areaFraction(area: number, exponent?: number): number;
  volumeFraction(volume: number, exponent?: number): number;
  measureFraction(value: number, dimension: number, exponent?: number, unit?: LengthUnit): number;
  cells(count: number): number;
  cellArea(count?: number): number;
  cellCount(length: number): number;
  resolution(cells: number): {
    cellArea: number;
    cellSpan: number;
    cellAreaKm2: number;
  };
  /** Explicit sampling support, not an automatic enlargement of generated features. */
  supported(length: number, cells?: number): number;
  /** Observed/placed values change encoding only; this never changes their map scale. */
  static metres(value: number, unit?: LengthUnit): number;
  static inUnits(metres: number, unit: LengthUnit): number;
  static areaUnits(value: number, from: "m2" | "km2", to: "m2" | "km2"): number;
  static volumeUnits(value: number, from: "m3" | "km3", to: "m3" | "km3"): number;
  static native(metres: number): number;
  /** Resolve relative declarations once. Numeric overrides of a measure are fractions. */
  resolve<T extends object>(
    definition: ScaleDefinition<T>,
    overrides?: RelativeOverrides<T>
  ): ResolvedSettings<T>;
  resolveMeasure(measure: RelativeMeasure, overrideFraction?: number): number;
  private resolveValue;
}
export {};
