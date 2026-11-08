import type { PhysicalField } from "../world/field";
import type { HeldRock } from "./groundTransport";

export interface GroundTransferObservation {
  readonly operation: "plate-placement" | "rock-accretion" | "cover-accretion" | "sheet-move";
  readonly phase: "before" | "after";
  readonly source: number;
  readonly target: number;
  /** Accepted mean height in native units, where the operation transfers an amount. */
  readonly accepted?: number;
}
type TransferObserver = (
  event: GroundTransferObservation,
  map: PhysicalField,
  held: HeldRock
) => void;
// hpc-exempt: optional harness callback and explicitly selected cells, never per-world tracking.
let transferWatcher: { cells: ReadonlySet<number>; observe: TransferObserver } | undefined;
const noTransferObservation: (accepted?: number) => void = () => undefined;
/** Inspect actual donor relationships without retaining a provenance graph in generated maps. */
export function watchGroundTransfers(cells: ReadonlySet<number>, observe: TransferObserver) {
  const previous = transferWatcher,
    watcher = { cells, observe };
  transferWatcher = watcher;
  return () => {
    if (transferWatcher === watcher) transferWatcher = previous;
  };
}
export function observeTransfer(
  map: PhysicalField,
  held: HeldRock,
  source: number,
  target: number,
  operation: GroundTransferObservation["operation"]
) {
  const watcher = transferWatcher;
  if (!watcher || !(watcher.cells.has(source) || watcher.cells.has(target)))
    return noTransferObservation;
  watcher.observe({ operation, phase: "before", source, target }, map, held);
  return (accepted?: number) =>
    watcher.observe({ operation, phase: "after", source, target, accepted }, map, held);
}
