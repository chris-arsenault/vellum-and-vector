export declare function hermitePatch(
  c: Float64Array,
  u: number,
  v: number,
  du?: boolean,
  dv?: boolean
): number;
/** The sample correction and its first derivatives vanish on every cell face. */
export declare function adaptivePolynomial(
  c: Float64Array,
  center: number,
  u: number,
  v: number
): number;
export declare function evaluateAdaptiveCell(
  c: Float64Array,
  center: number,
  u: number,
  v: number
): number;
export declare function prepareAdaptiveCell(
  coefficients: Float64Array,
  center: number
): {
  coefficients: Float64Array<ArrayBufferLike>;
  correction: number;
  low: number;
  high: number;
};
export type PreparedAdaptiveCell = ReturnType<typeof prepareAdaptiveCell>;
export declare function preparedAdaptivePolynomial(
  cell: PreparedAdaptiveCell,
  u: number,
  v: number
): number;
export declare function evaluatePreparedAdaptiveCell(
  cell: PreparedAdaptiveCell,
  u: number,
  v: number
): number;
