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
export function visitAdaptiveOverlap(
  topology: AdaptiveTopology,
  bounds: Bounds,
  visit: (leaf: number) => void
) {
  const pending = [0];
  const boxes = topology.boxes;
  while (pending.length) {
    const node = pending.pop()!;
    const at = node * 4;
    if (
      boxes[at] >= bounds[2] ||
      boxes[at + 2] <= bounds[0] ||
      boxes[at + 1] >= bounds[3] ||
      boxes[at + 3] <= bounds[1]
    )
      continue;
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
function unchangedCell(items: Overlap[], sourceAreas: Float64Array, targetArea: number) {
  const first = items[0];
  return (
    items.length === 1 &&
    first.dx === 0 &&
    first.dy === 0 &&
    first.area === sourceAreas[first.source] &&
    first.area === targetArea
  );
}
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
    const result = new Float64Array(target.leaves.length);
    for (let i = 0; i < result.length; i++) {
      const items = overlaps[i],
        first = items[0];
      // Most cells survive a local split unchanged. Preserve those samples
      // directly instead of integrating their identical footprint again.
      if (unchangedCell(items, geometry.areas, targetGeometry.areas[i])) {
        result[i] = values[first.source];
        continue;
      }
      let total = 0,
        strongest = -1,
        category = 0;
      for (const { source: j, area, dx, dy } of items) {
        if (gradient) total += (density[j] + gradient.x[j] * dx + gradient.y[j] * dy) * area;
        if (area > strongest) {
          strongest = area;
          category = values[j];
        }
      }
      result[i] =
        quantity === "category"
          ? category
          : quantity === "extensive"
            ? total
            : total / targetGeometry.areas[i];
    }
    return result;
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
