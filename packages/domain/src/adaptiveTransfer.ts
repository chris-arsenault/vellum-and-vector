import { requireThat } from "./errors";
import type { Bounds } from "./spatial";
import {
  adaptiveCell,
  adaptiveGeometry,
  adaptiveLeafAt,
  type AdaptiveTopology,
} from "./adaptiveTopology";
import { adaptiveGradients } from "./adaptiveReconstruction";

type Quantity = "intensive" | "extensive" | "category";
function overlaps(a: Bounds, b: Bounds) {
  return a[0] < b[2] && a[2] > b[0] && a[1] < b[3] && a[3] > b[1];
}
export function visitAdaptiveOverlap(
  topology: AdaptiveTopology,
  bounds: Bounds,
  visit: (leaf: number) => void
) {
  const pending = [0];
  while (pending.length) {
    const node = pending.pop()!;
    const box = Array.from(topology.boxes.subarray(node * 4, node * 4 + 4)) as Bounds;
    if (!overlaps(box, bounds)) continue;
    const child = topology.children[node];
    if (child < 0) visit(topology.leafIndex[node]);
    else pending.push(child, child + 1, child + 2, child + 3);
  }
}
function limitedGradients(
  topology: AdaptiveTopology,
  values: Float64Array,
  geometry: ReturnType<typeof adaptiveGeometry>,
  selected: Int32Array
) {
  const gradients = adaptiveGradients(topology, values, geometry, selected);
  for (const i of selected) {
    let low = values[i],
      high = values[i];
    for (let at = topology.offsets[i]; at < topology.offsets[i + 1]; at++) {
      const v = values[topology.neighbors[at]];
      low = Math.min(low, v);
      high = Math.max(high, v);
    }
    const excursion =
      (Math.abs(gradients.x[i]) * geometry.width[i] +
        Math.abs(gradients.y[i]) * geometry.height[i]) /
      2;
    const factor =
      excursion > 0
        ? Math.min(1, (values[i] - low) / excursion, (high - values[i]) / excursion)
        : 1;
    gradients.x[i] *= factor;
    gradients.y[i] *= factor;
  }
  return gradients;
}
type Overlap = { source: number; area: number; dx: number; dy: number };
function transferOverlaps(
  source: AdaptiveTopology,
  target: AdaptiveTopology,
  geometry: ReturnType<typeof adaptiveGeometry>
) {
  return Array.from(target.leaves, (_, i) => {
    const box = adaptiveCell(target, i),
      items: Overlap[] = [];
    const parent = adaptiveLeafAt(source, (box[0] + box[2]) / 2, (box[1] + box[3]) / 2);
    const oldBox = adaptiveCell(source, parent);
    if (box[0] >= oldBox[0] && box[1] >= oldBox[1] && box[2] <= oldBox[2] && box[3] <= oldBox[3])
      return [
        {
          source: parent,
          area: (box[2] - box[0]) * (box[3] - box[1]),
          dx: (box[0] + box[2]) / 2 - geometry.x[parent],
          dy: (box[1] + box[3]) / 2 - geometry.y[parent],
        },
      ];
    visitAdaptiveOverlap(source, box, (j) => {
      const old = adaptiveCell(source, j);
      const x0 = Math.max(box[0], old[0]),
        y0 = Math.max(box[1], old[1]);
      const x1 = Math.min(box[2], old[2]),
        y1 = Math.min(box[3], old[3]);
      items.push({
        source: j,
        area: (x1 - x0) * (y1 - y0),
        dx: (x0 + x1) / 2 - geometry.x[j],
        dy: (y0 + y1) / 2 - geometry.y[j],
      });
    });
    return items;
  });
}
/** Reuse geometric overlap work when transferring all channels of one evolving world. */
export function prepareAdaptiveTransfer(source: AdaptiveTopology, target: AdaptiveTopology) {
  requireThat(
    source.bounds.every((value, i) => value === target.bounds[i]),
    "adaptive_transfer",
    "Conservative transfer requires the same extent."
  );
  const geometry = adaptiveGeometry(source),
    targetGeometry = adaptiveGeometry(target);
  const overlaps = transferOverlaps(source, target, geometry);
  const changed = Int32Array.from(
    new Set(
      overlaps.flatMap((items) =>
        items.filter((item) => item.dx !== 0 || item.dy !== 0).map((item) => item.source)
      )
    )
  );
  return (values: Float64Array, quantity: Quantity): Float64Array => {
    requireThat(
      values.length === source.leaves.length,
      "adaptive_transfer",
      "Transfer requires one value per source cell."
    );
    const density =
      quantity === "extensive"
        ? Float64Array.from(values, (value, i) => value / geometry.areas[i])
        : values;
    const gradient =
      quantity === "category" ? undefined : limitedGradients(source, density, geometry, changed);
    return Float64Array.from(target.leaves, (_, i) => {
      let total = 0,
        strongest = -1,
        category = 0;
      for (const { source: j, area, dx, dy } of overlaps[i]) {
        if (gradient) total += (density[j] + gradient.x[j] * dx + gradient.y[j] * dy) * area;
        if (area > strongest) {
          strongest = area;
          category = values[j];
        }
      }
      if (quantity === "category") return category;
      return quantity === "extensive" ? total : total / targetGeometry.areas[i];
    });
  };
}
/** Conservative overlap integration for nested or differently refined partitions of one extent. */
export function transferAdaptive(
  source: AdaptiveTopology,
  target: AdaptiveTopology,
  values: Float64Array,
  quantity: Quantity
): Float64Array {
  return prepareAdaptiveTransfer(source, target)(values, quantity);
}
