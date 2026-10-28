import { attachGrid, detachGrid, type DomainSnapshot } from "@atlas/domain";

/** An independent copy of a snapshot: records cloned, grids copied into resident bands. */
export function snapshotCopy(snapshot: DomainSnapshot): DomainSnapshot {
  return {
    ...structuredClone({ ...snapshot, numerical: {} }),
    numerical: Object.fromEntries(
      Object.entries(snapshot.numerical).map(([id, grid]) => [
        id,
        attachGrid(detachGrid(grid)) as DomainSnapshot["numerical"][string],
      ])
    ),
  };
}
/** The snapshot with its grids as plain arrays, for deep equality of records and samples. */
export function comparableSnapshot(snapshot: DomainSnapshot) {
  return { ...snapshot, numerical: numericalValues(snapshot) };
}
/** A snapshot's grids as plain arrays, for comparing sampled values. */
export function numericalValues(snapshot: DomainSnapshot) {
  return Object.fromEntries(
    Object.entries(snapshot.numerical).map(([id, grid]) => [id, detachGrid(grid)])
  );
}
