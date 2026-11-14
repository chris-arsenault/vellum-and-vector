/**
 * Structural equality of records. Bands compare by their samples and coverages are storage
 * accounting, so a copy-on-write snapshot of an unchanged grid is the same value.
 */
export declare function sameValue(a: unknown, b: unknown): boolean;
