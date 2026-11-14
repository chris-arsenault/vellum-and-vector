/** Indices of `keys` in ascending key order, ties by ascending index; `descending` reverses
 * the key order and keeps ties ascending. Eight stable byte passes over the ordered bits of
 * each float64 key; passes whose byte is constant are skipped. */
export declare function radixOrder(keys: ArrayLike<number>, descending?: boolean): Int32Array;
