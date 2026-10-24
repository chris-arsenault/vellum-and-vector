/**
 * The resolution rule of ADR 0005: a process realizes a feature it would place from a
 * physical footprint only when that footprint spans at least this many cells of the
 * profile's mesh on its smaller dimension. Below it the feature is a latent quantity on the
 * unit that contains it, for a finer profile to realize.
 */
export const resolutionCells = 2;
