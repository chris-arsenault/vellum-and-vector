import { requireThat } from "./errors";
import type { Bounds } from "./spatial";
import { adaptiveCell, adaptiveLeafAt, type AdaptiveTopology } from "./adaptiveTopology";
import type { NumericalAllocator, NumericalVector } from "./numericalVector";
import { generateNumerical } from "./numericalAllocation";
import { transferGradients, type TransferSamples } from "./adaptiveTransferGradient";

type Quantity = "intensive" | "extensive" | "category";
export function visitAdaptiveOverlap(
  topology: AdaptiveTopology,
  bounds: Bounds,
  visit: (leaf: number) => void
) {
  for (const leaf of overlappingAdaptiveLeaves(topology, bounds)) visit(leaf);
}
/** Stream overlapping leaves with a traversal stack proportional to tree depth. */
export function* overlappingAdaptiveLeaves(
  topology: AdaptiveTopology,
  bounds: Bounds,
  ascending = false
) {
  const pending = [0],
    boxes = topology.boxes;
  while (pending.length) {
    const node = pending.pop()!,
      at = node * 4;
    if (
      boxes[at] >= bounds[2] ||
      boxes[at + 2] <= bounds[0] ||
      boxes[at + 1] >= bounds[3] ||
      boxes[at + 3] <= bounds[1]
    )
      continue;
    const child = topology.children[node];
    if (child < 0) yield topology.leafIndex[node];
    else if (ascending) pending.push(child + 3, child + 2, child + 1, child);
    else pending.push(child, child + 1, child + 2, child + 3);
  }
}
function cellArea(box: Bounds) {
  return (box[2] - box[0]) * (box[3] - box[1]);
}
function overlaps(source: AdaptiveTopology, box: Bounds, visit: (j: number, box: Bounds) => void) {
  const parent = adaptiveLeafAt(source, (box[0] + box[2]) / 2, (box[1] + box[3]) / 2),
    old = adaptiveCell(source, parent);
  if (box[0] >= old[0] && box[1] >= old[1] && box[2] <= old[2] && box[3] <= old[3]) {
    visit(parent, box);
    return;
  }
  visitAdaptiveOverlap(source, box, (j) => {
    const other = adaptiveCell(source, j);
    visit(j, [
      Math.max(box[0], other[0]),
      Math.max(box[1], other[1]),
      Math.min(box[2], other[2]),
      Math.min(box[3], other[3]),
    ]);
  });
}
function sampleTransfer(
  source: AdaptiveTopology,
  target: AdaptiveTopology,
  i: number,
  sample: (i: number) => number,
  quantity: Quantity,
  gradient: ReturnType<typeof transferGradients>
) {
  const targetBox = adaptiveCell(target, i);
  let total = 0,
    strongest = -1,
    category = 0,
    unchanged: number | undefined;
  overlaps(source, targetBox, (j, box) => {
    const old = adaptiveCell(source, j),
      area = cellArea(box),
      dx = (box[0] + box[2] - old[0] - old[2]) / 2,
      dy = (box[1] + box[3] - old[1] - old[3]) / 2;
    if (dx === 0 && dy === 0 && area === cellArea(old) && area === cellArea(targetBox))
      unchanged = j;
    if (quantity !== "category") {
      const [x, y] = gradient(j),
        density = quantity === "extensive" ? sample(j) / cellArea(old) : sample(j);
      total += (density + x * dx + y * dy) * area;
    }
    if (area > strongest) {
      strongest = area;
      category = sample(j);
    }
  });
  if (unchanged !== undefined) return sample(unchanged);
  if (quantity === "category") return category;
  return quantity === "extensive" ? total : total / cellArea(targetBox);
}
/** Integrate local overlaps without retaining a world-sized overlap or gradient table. */
export function prepareAdaptiveTransfer(
  source: AdaptiveTopology,
  target: AdaptiveTopology,
  numerical?: NumericalAllocator
) {
  requireThat(
    source.bounds.every((value, i) => value === target.bounds[i]),
    "adaptive_transfer",
    "Conservative transfer requires the same extent."
  );
  return (values: TransferSamples, quantity: Quantity): NumericalVector => {
    if (typeof values !== "function")
      requireThat(
        values.length === source.leaves.length,
        "adaptive_transfer",
        "Transfer requires one value per source cell."
      );
    const sample = typeof values === "function" ? values : (j: number) => values[j],
      density =
        quantity === "extensive"
          ? (j: number) => sample(j) / cellArea(adaptiveCell(source, j))
          : sample,
      gradient = transferGradients(source, density);
    return generateNumerical(
      {
        type: "float64",
        length: target.leaves.length,
        lifetime: "process",
        name: "adaptive:transfer",
      },
      (i) => sampleTransfer(source, target, i, sample, quantity, gradient),
      numerical
    );
  };
}
export function transferAdaptive(
  source: AdaptiveTopology,
  target: AdaptiveTopology,
  values: NumericalVector,
  quantity: Quantity,
  numerical?: NumericalAllocator
): NumericalVector {
  return prepareAdaptiveTransfer(source, target, numerical)(values, quantity);
}
