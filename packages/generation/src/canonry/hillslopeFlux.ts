import type { PhysicalField } from "./field";
import type { PhysicalProfile } from "./profile";
import { clamp } from "./math";
import { edgeLeadingTo } from "./mesh";

interface Face {
  i: number;
  j: number;
  distance: number;
  diffusion: number;
  volume: number;
}
function faces(map: PhysicalField, p: PhysicalProfile) {
  const mesh = map.mesh,
    result: Face[] = [];
  const slots = new Int32Array(mesh.neighbors.length).fill(-1);
  for (let i = 0; i < mesh.count; i++)
    for (let edge = 0; edge < mesh.degree[i]; edge++) {
      const at = i * mesh.stride + edge,
        j = mesh.neighbors[at];
      if (j <= i) continue;
      slots[at] = result.length;
      slots[j * mesh.stride + edgeLeadingTo(mesh, j, i)] = result.length;
      result.push({
        i,
        j,
        distance: mesh.edgeLength[at],
        volume: 0,
        diffusion:
          (((p.MassWastingTransportLength ** 2 * p.MassWastingTransportFraction) / 1000) *
            mesh.faceLength[at]) /
          mesh.faceDistance[at],
      });
    }
  return { faces: result, slots };
}
function exchange(
  face: Face,
  heights: Float64Array,
  stable: Float64Array,
  areas: Float64Array,
  budget: Float64Array,
  spent: Float64Array
) {
  const { i, j, volume: old } = face;
  const inverse = 1 / areas[i] + 1 / areas[j];
  const head = heights[i] - heights[j] + old * inverse;
  const driving =
    head > 0
      ? Math.max(0, head - stable[i] * face.distance)
      : Math.min(0, head + stable[j] * face.distance);
  if (old > 0) spent[i] -= old;
  if (old < 0) spent[j] += old;
  const desired = driving / (inverse + 1 / face.diffusion);
  const volume = clamp(
    desired,
    -Math.max(0, budget[j] - spent[j]),
    Math.max(0, budget[i] - spent[i])
  );
  if (volume > 0) spent[i] += volume;
  if (volume < 0) spent[j] -= volume;
  const change = volume - old;
  heights[i] -= change / areas[i];
  heights[j] += change / areas[j];
  face.volume = volume;
  return Math.abs(change) * Math.max(1 / areas[i], 1 / areas[j]);
}
/** Backward-Euler face exchange with unilateral stable slopes and finite source budgets. */
export function hillslopeFlux(map: PhysicalField, p: PhysicalProfile) {
  const mesh = map.mesh,
    plan = faces(map, p);
  const heights = Float64Array.from(map.Elevation, (v) => v / 1024);
  const stable = Float64Array.from(
    map.RockResistance,
    (v) => p.MassWastingStableGradient * clamp(0.55 + (v / 1000) * 0.45, 0.55, 1.45)
  );
  const budget = Float64Array.from(
    mesh.areas,
    (area) => p.MaximumHillslopeTransport * Math.sqrt(area)
  );
  const spent = new Float64Array(mesh.count);
  // A bounded ring contains each face at most once. This is solver work, not a
  // world-wide geological clock set by the smallest control volume.
  const queue = new Int32Array(plan.faces.length + 1),
    queued = new Uint8Array(plan.faces.length).fill(1);
  plan.faces.forEach((_, i) => {
    queue[i] = i;
  });
  let head = 0,
    tail = plan.faces.length;
  const enqueueCell = (cell: number) => {
    for (let edge = 0; edge < mesh.degree[cell]; edge++) {
      const index = plan.slots[cell * mesh.stride + edge];
      if (index < 0 || queued[index]) continue;
      queue[tail] = index;
      tail = (tail + 1) % queue.length;
      queued[index] = 1;
    }
  };
  while (head !== tail) {
    const index = queue[head];
    head = (head + 1) % queue.length;
    queued[index] = 0;
    const face = plan.faces[index];
    if (exchange(face, heights, stable, mesh.areas, budget, spent) <= 1 / 1024) continue;
    enqueueCell(face.i);
    enqueueCell(face.j);
  }
  const cuts = new Float64Array(mesh.count),
    fills = cuts.slice();
  for (const { i, j, volume } of plan.faces) {
    if (volume >= 0) {
      cuts[i] += volume;
      fills[j] += volume;
    } else {
      cuts[j] -= volume;
      fills[i] -= volume;
    }
  }
  return { cuts, fills };
}
