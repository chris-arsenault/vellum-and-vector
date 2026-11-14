import type { PhysicalField } from "../world/field";

/** Who moved it. */
export type FlowCause = string;
export interface Transfer<Store extends string> {
  cause: FlowCause;
  from: Store;
  to: Store;
  volume: number;
}
/**
 * A record of transfers between the named stores of one substance on a map: who moved how
 * much from where to where. It is a report of what a run did, not state the run reads back.
 */
export function transferRecord<Store extends string>(stores: readonly Store[]) {
  const index = Object.fromEntries(stores.map((store, n) => [store, n])) as Record<Store, number>,
    // hpc-exempt: a report keyed by map; what was moved is in the map's own bands.
    records = new WeakMap<PhysicalField, Map<FlowCause, Float64Array>>();
  const recordOf = (map: PhysicalField) => {
    let held = records.get(map);
    if (!held) records.set(map, (held = new Map()));
    return held;
  };
  return {
    /** Enters a transfer in the record. */
    record(map: PhysicalField, cause: FlowCause, from: Store, to: Store, volume: number) {
      if (volume === 0) return;
      const record = recordOf(map);
      let moved = record.get(cause);
      if (!moved) record.set(cause, (moved = new Float64Array(stores.length * stores.length)));
      moved[index[from] * stores.length + index[to]] += volume;
    },
    /** States a transfer's present size, replacing what was last stated for it. */
    state(map: PhysicalField, cause: FlowCause, from: Store, to: Store, volume: number) {
      const record = recordOf(map);
      let moved = record.get(cause);
      if (!moved) record.set(cause, (moved = new Float64Array(stores.length * stores.length)));
      moved[index[from] * stores.length + index[to]] = volume;
    },
    /** Who moved what, largest first, for reports. */
    read(map: PhysicalField) {
      const out: Transfer<Store>[] = [];
      for (const [cause, moved] of recordOf(map))
        moved.forEach((volume, n) => {
          if (volume !== 0)
            out.push({
              cause,
              from: stores[Math.floor(n / stores.length)],
              to: stores[n % stores.length],
              volume,
            });
        });
      // hpc-exempt: a few dozen entries, sorted for a report.
      return out.sort((a, b) => b.volume - a.volume);
    },
  };
}

/**
 * The stocks material sits in. What changes the land moves material between two of these through the
 * ledger, and the record of who moved what is how a report tells what became of the ground.
 */
export const pools = [
  "rock",
  "soil",
  "loose",
  "load",
  "sea",
  "crust",
  "ice",
  "melt",
  "space",
] as const;
export type Pool = (typeof pools)[number];
const ground = transferRecord(pools);
/** Enters a transfer in the record. Only the ledger, which also moves the material, calls this. */
export const recordFlow = ground.record;
/** Who moved what, largest first, for reports. */
export const flowRecord = ground.read;
