import type { PhysicalField } from "../world/field";

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
const poolIndex = Object.fromEntries(pools.map((pool, n) => [pool, n])) as Record<Pool, number>;
/** Who moved it. */
export type FlowCause = string;

const records = new WeakMap<PhysicalField, Map<FlowCause, Float64Array>>();
const recordOf = (map: PhysicalField) => {
  let held = records.get(map);
  if (!held) records.set(map, (held = new Map()));
  return held;
};
/** Enters a transfer in the record. Only the ledger, which also moves the material, calls this. */
export function recordFlow(
  map: PhysicalField,
  cause: FlowCause,
  from: Pool,
  to: Pool,
  volume: number
) {
  if (volume === 0) return;
  const record = recordOf(map);
  let moved = record.get(cause);
  if (!moved) record.set(cause, (moved = new Float64Array(pools.length * pools.length)));
  moved[poolIndex[from] * pools.length + poolIndex[to]] += volume;
}
/** Who moved what, largest first, for reports. */
export function flowRecord(map: PhysicalField) {
  const out: { cause: FlowCause; from: Pool; to: Pool; volume: number }[] = [];
  for (const [cause, moved] of recordOf(map))
    moved.forEach((volume, n) => {
      if (volume !== 0)
        out.push({
          cause,
          from: pools[Math.floor(n / pools.length)],
          to: pools[n % pools.length],
          volume,
        });
    });
  // hpc-exempt: a few dozen entries, sorted for a report.
  return out.sort((a, b) => b.volume - a.volume);
}
