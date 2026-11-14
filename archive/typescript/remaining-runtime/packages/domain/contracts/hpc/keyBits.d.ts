/** -0 orders as 0, so key order agrees with numeric comparison. */
export declare function orderedHi(key: number): number;
/** Call after orderedHi for the same key; shares the scratch write. */
export declare function orderedLo(): number;
export declare function keyFromOrdered(hi: number, lo: number): number;
/** Unsigned lexicographic comparison of two ordered keys. */
export declare function orderedLess(hiA: number, loA: number, hiB: number, loB: number): boolean;
