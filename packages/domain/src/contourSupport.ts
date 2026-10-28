import type { AdaptiveTopology } from "./adaptiveTopology";

/** Reconstruction uses incident-cell gradients; retain the complete three-face stencil. */
export function* contourSupport(topology: AdaptiveTopology, members: Iterable<number>) {
  const count = topology.leaves.length,
    coverage = topology.coverage;
  const selected = coverage.scratch("uint8", "contour:adaptive-membership", count);
  const queue = coverage.scratch("int32", "contour:adaptive-support", count);
  let end = 0;
  const add = (cell: number) => {
    if (!selected.get(cell)) {
      selected.set(cell, 1);
      queue.set(end++, cell);
    }
  };
  try {
    for (const member of members) add(member);
    let start = 0;
    for (let ring = 0; ring < 3; ring++) {
      const stop = end;
      for (let index = start; index < stop; index++) {
        const cell = queue.get(index);
        for (let at = topology.offsets.get(cell); at < topology.offsets.get(cell + 1); at++)
          add(topology.neighbors.get(at));
      }
      start = stop;
    }
    for (let i = 0; i < end; i++) yield queue.get(i);
  } finally {
    coverage.release(selected);
    coverage.release(queue);
  }
}
