// Facade contracts use JS numbers. cbor-x supports int64AsNumber at runtime,
// but its Options declaration omits it; retain the inferred option shape here.
export const cborOptions = { useRecords: false, int64AsNumber: true };
