import { requireThat } from "./errors";
import type { Bounds } from "./spatial";

export interface RelativeMeasure {
  readonly kind: "relative-measure";
  readonly fraction: number;
  readonly dimension: number;
  readonly exponent: number;
  readonly unit?: LengthUnit;
}
type LengthUnit = "m" | "km" | "mm" | "ft" | "native";
const resolvedSettings = Symbol("resolved-map-settings");
export type ResolvedSettings<T> = ResolvedMeasures<T> & { readonly [resolvedSettings]: true };
type RelativeOverrides<T> = Partial<ResolvedMeasures<T>> & { readonly [resolvedSettings]?: never };
export type ResolvedMeasures<T> = T extends RelativeMeasure
  ? number
  : T extends object
    ? { [K in keyof T]: ResolvedMeasures<T[K]> }
    : T;
export interface ScaleDefinition<T extends object> {
  readonly kind: "relative-settings";
  readonly values: T;
}
const isMeasure = (value: unknown): value is RelativeMeasure =>
  value !== null &&
  typeof value === "object" &&
  "kind" in value &&
  value.kind === "relative-measure";

/**
 * The sole conversion authority for generated geographic dimensions.
 * Fractions use an equal-area 4:3 frame's width: changing aspect ratio alone does not
 * change an isotropic process radius. Nonlinear laws act on a dimensionless size ratio.
 * Resolution affects explicit cell support, never the size of a declared landform.
 *
 * owner-direction(2026-11-12): geology is shares of the map; digital representation precision is fixed.
 */
export class MapScale {
  static readonly referenceWidth = 4_000_000;
  static readonly referenceHeight = 3_000_000;
  static readonly nativePerMetre = 1024;
  private static readonly unitFactors = {
    m: 1,
    km: 1000,
    mm: 0.001,
    ft: 0.3048,
    native: 1 / MapScale.nativePerMetre,
  };
  readonly span: number;

  constructor(
    readonly width: number,
    readonly height: number,
    readonly cellSpan: number
  ) {
    requireThat(
      [width, height, cellSpan].every((value) => Number.isFinite(value) && value > 0),
      "map_scale",
      "Map dimensions and resolution must be finite and positive."
    );
    this.span = Math.sqrt((width * height * MapScale.referenceWidth) / MapScale.referenceHeight);
  }

  static fromBounds(bounds: Bounds, cellSpan: number) {
    return new MapScale(bounds[2] - bounds[0], bounds[3] - bounds[1], cellSpan);
  }
  static fromCells(bounds: Bounds, cells: number) {
    requireThat(Number.isFinite(cells) && cells > 0, "map_scale", "Cell count must be positive.");
    const width = bounds[2] - bounds[0],
      height = bounds[3] - bounds[1];
    return new MapScale(width, height, Math.sqrt((width * height) / cells));
  }
  /** Explicit reference context for supplied contract fixtures. */
  static reference(cellSpan = 1) {
    return new MapScale(MapScale.referenceWidth, MapScale.referenceHeight, cellSpan);
  }
  static length(fraction: number, exponent = 1, unit: LengthUnit = "m"): RelativeMeasure {
    return MapScale.measure(fraction, 1, exponent, unit);
  }
  static area(fraction: number, exponent = 1): RelativeMeasure {
    return MapScale.measure(fraction, 2, exponent);
  }
  static volume(fraction: number, exponent = 1): RelativeMeasure {
    return MapScale.measure(fraction, 3, exponent);
  }
  static inverseLength(fraction: number, exponent = 1): RelativeMeasure {
    return MapScale.measure(fraction, -1, exponent);
  }
  static measure(
    fraction: number,
    dimension: RelativeMeasure["dimension"],
    exponent = 1,
    unit: LengthUnit = "m"
  ): RelativeMeasure {
    requireThat(Number.isFinite(fraction), "map_scale", "Relative dimensions must be finite.");
    requireThat(
      Number.isFinite(dimension) && dimension !== 0,
      "map_scale",
      "Declare a nonzero finite length dimension."
    );
    MapScale.checkExponent(exponent);
    return { kind: "relative-measure", fraction, dimension, exponent, unit };
  }
  static definitions<T extends object>(values: T): ScaleDefinition<T> {
    return { kind: "relative-settings", values };
  }
  private static checkExponent(exponent: number) {
    requireThat(
      Number.isFinite(exponent) && exponent > 0,
      "map_scale",
      "A scaling exponent must be finite and positive; fixed geographic lengths are unsupported."
    );
  }
  private basis(exponent: number) {
    MapScale.checkExponent(exponent);
    return MapScale.referenceWidth * (this.span / MapScale.referenceWidth) ** exponent;
  }
  length(fraction: number, exponent = 1) {
    return fraction * this.basis(exponent);
  }
  area(fraction: number, exponent = 1) {
    return fraction * this.basis(exponent) ** 2;
  }
  volume(fraction: number, exponent = 1) {
    return fraction * this.basis(exponent) ** 3;
  }
  inverseLength(fraction: number, exponent = 1) {
    return fraction / this.basis(exponent);
  }
  fraction(length: number, exponent = 1) {
    return length / this.basis(exponent);
  }
  areaFraction(area: number, exponent = 1) {
    return area / this.basis(exponent) ** 2;
  }
  volumeFraction(volume: number, exponent = 1) {
    return volume / this.basis(exponent) ** 3;
  }
  measureFraction(value: number, dimension: number, exponent = 1, unit: LengthUnit = "m") {
    return (value * MapScale.unitFactors[unit] ** dimension) / this.basis(exponent) ** dimension;
  }
  cells(count: number) {
    return count * this.cellSpan;
  }
  cellArea(count = 1) {
    return count * this.cellSpan ** 2;
  }
  cellCount(length: number) {
    return length / this.cellSpan;
  }
  resolution(cells: number) {
    requireThat(Number.isFinite(cells) && cells > 0, "map_scale", "Cell count must be positive.");
    const cellArea = (this.width * this.height) / cells;
    return {
      cellArea,
      cellSpan: Math.sqrt(cellArea),
      cellAreaKm2: MapScale.areaUnits(cellArea, "m2", "km2"),
    };
  }
  /** Explicit sampling support, not an automatic enlargement of generated features. */
  supported(length: number, cells = 1) {
    return Math.max(length, this.cells(cells));
  }
  /** Observed/placed values change encoding only; this never changes their map scale. */
  static metres(value: number, unit: LengthUnit = "m") {
    return value * MapScale.unitFactors[unit];
  }
  static inUnits(metres: number, unit: LengthUnit) {
    return metres / MapScale.unitFactors[unit];
  }
  static areaUnits(value: number, from: "m2" | "km2", to: "m2" | "km2") {
    const factor = MapScale.unitFactors.km ** 2;
    return (value * (from === "km2" ? factor : 1)) / (to === "km2" ? factor : 1);
  }
  static volumeUnits(value: number, from: "m3" | "km3", to: "m3" | "km3") {
    const factor = MapScale.unitFactors.km ** 3;
    return (value * (from === "km3" ? factor : 1)) / (to === "km3" ? factor : 1);
  }
  static native(metres: number) {
    const value = MapScale.inUnits(metres, "native");
    return Math.sign(value) * Math.round(Math.abs(value)) || 0;
  }
  /** Resolve relative declarations once. Numeric overrides of a measure are fractions. */
  resolve<T extends object>(
    definition: ScaleDefinition<T>,
    overrides: RelativeOverrides<T> = {}
  ): ResolvedSettings<T> {
    requireThat(
      definition.kind === "relative-settings",
      "map_scale",
      "Resolve declared settings, not an already resolved profile."
    );
    requireThat(
      !(resolvedSettings in overrides),
      "map_scale",
      "Overrides must be relative settings, not an already resolved profile."
    );
    return Object.assign(this.resolveValue(definition.values, overrides) as object, {
      [resolvedSettings]: true as const,
    }) as ResolvedSettings<T>;
  }
  resolveMeasure(measure: RelativeMeasure, overrideFraction = measure.fraction) {
    return (
      overrideFraction *
      (this.basis(measure.exponent) / MapScale.unitFactors[measure.unit ?? "m"]) **
        measure.dimension
    );
  }
  private resolveValue(value: unknown, override: unknown): unknown {
    if (isMeasure(value)) {
      const fraction = typeof override === "number" ? override : value.fraction;
      return this.resolveMeasure(value, fraction);
    }
    if (value === null || typeof value !== "object") return override ?? value;
    if (Array.isArray(value)) {
      const supplied = Array.isArray(override) ? override : [];
      return value.map((entry, index) => this.resolveValue(entry, supplied[index]));
    }
    const supplied = (override ?? {}) as Record<string, unknown>;
    return Object.fromEntries(
      Object.entries(value).map(([key, entry]) => [key, this.resolveValue(entry, supplied[key])])
    );
  }
}
