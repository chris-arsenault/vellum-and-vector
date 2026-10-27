import type { AdaptiveTopology } from "./adaptiveTopology";
import type { NumericalAllocator } from "./numericalVector";
import { allocateNumerical } from "./numericalAllocation";

/** Reconstruction uses incident-cell gradients; retain the complete three-face stencil. */
export function* contourSupport(
  topology: AdaptiveTopology,
  members: Iterable<number>,
  numerical?: NumericalAllocator
) {
  const count = topology.leaves.length;
  const selected = allocateNumerical(
    { type: "uint8", length: count, lifetime: "process", name: "contour:adaptive-membership" },
    numerical
  );
  const queue = allocateNumerical(
    { type: "int32", length: count, lifetime: "process", name: "contour:adaptive-support" },
    numerical
  );
  let end = 0;
  const add = (cell: number) => {
    if (!selected[cell]) {
      selected[cell] = 1;
      queue[end++] = cell;
    }
  };
  try {
    for (const member of members) add(member);
    let start = 0;
    for (let ring = 0; ring < 3; ring++) {
      const stop = end;
      for (let index = start; index < stop; index++) {
        const cell = queue[index];
        for (let at = topology.offsets[cell]; at < topology.offsets[cell + 1]; at++)
          add(topology.neighbors[at]);
      }
      start = stop;
    }
    for (let i = 0; i < end; i++) yield queue[i];
  } finally {
    numerical?.releaseUnused([selected, queue], []);
  }
}
