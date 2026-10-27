import type { PhysicalField } from "./field";
import type { PhysicalProfile } from "./profile";
import { clamp } from "./math";
import { edgeLeadingTo } from "./mesh";
import { workingArray, workingValues, releaseWorking } from "./physicalNumerics";
import type { NumericalVector } from "@atlas/domain";

interface Face {
  i: number;
  j: number;
  distance: number;
  diffusion: number;
  volume: number;
}
function faces(map: PhysicalField, p: PhysicalProfile) {
  const mesh = map.mesh;
  let count = 0;
  for (let i = 0; i < mesh.count; i++)
    for (let edge = 0; edge < mesh.degree[i]; edge++)
      if (mesh.neighbors[i * mesh.stride + edge] > i) count++;
  const columns = {
    i: workingArray(map, "int32", "slope:from", count),
    j: workingArray(map, "int32", "slope:to", count),
    distance: workingArray(map, "float64", "slope:distance", count),
    diffusion: workingArray(map, "float64", "slope:diffusion", count),
    volume: workingArray(map, "float64", "slope:volume", count),
  };
  const slots = workingArray(map, "int32", "slope:slots", mesh.neighbors.length).fill(-1);
  let index = 0;
  for (let i = 0; i < mesh.count; i++)
    for (let edge = 0; edge < mesh.degree[i]; edge++) {
      const at = i * mesh.stride + edge,
        j = mesh.neighbors[at];
      if (j <= i) continue;
      slots[at] = index;
      slots[j * mesh.stride + edgeLeadingTo(mesh, j, i)] = index;
      columns.i[index] = i;
      columns.j[index] = j;
      columns.distance[index] = mesh.edgeLength[at];
      columns.diffusion[index++] =
        (((p.MassWastingTransportLength ** 2 * p.MassWastingTransportFraction) / 1000) *
          mesh.faceLength[at]) /
        mesh.faceDistance[at];
    }
  return {
    columns,
    count,
    slots,
    get(at: number): Face {
      return {
        i: columns.i[at],
        j: columns.j[at],
        distance: columns.distance[at],
        diffusion: columns.diffusion[at],
        volume: columns.volume[at],
      };
    },
  };
}
function exchange(
  face: Face,
  heights: NumericalVector,
  stable: NumericalVector,
  areas: ArrayLike<number>,
  budget: NumericalVector,
  spent: NumericalVector
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
  const heights = workingValues(map, "float64", "slope:heights", (i) => map.Elevation[i] / 1024);
  // Living cover holds slopes: roots steepen the stable gradient and bind the material a
  // slope can shed, so cleared or burnt land moves and wooded land stands.
  const binding = (i: number) =>
    clamp(map.TreeCover[i] + 0.5 * map.GrassCover[i] + 0.5 * map.WetlandCover[i], 0, 1);
  const stable = workingValues(
    map,
    "float64",
    "slope:stable",
    (i) =>
      p.MassWastingStableGradient *
      clamp(0.55 + (map.RockResistance[i] / 1000) * 0.45, 0.55, 1.45) *
      (1 + map.TreeCover[i] * 0.2 + map.GrassCover[i] * 0.1)
  );
  const budget = workingValues(
    map,
    "float64",
    "slope:budget",
    (i) => p.MaximumHillslopeTransport * Math.sqrt(mesh.areas[i]) * (1 - 0.6 * binding(i))
  );
  const spent = workingArray(map, "float64", "slope:spent");
  // A bounded ring contains each face at most once. This is solver work, not a
  // world-wide geological clock set by the smallest control volume.
  const queue = workingArray(map, "int32", "slope:queue", plan.count + 1),
    queued = workingArray(map, "uint8", "slope:queued", plan.count).fill(1);
  for (let i = 0; i < plan.count; i++) queue[i] = i;
  let head = 0,
    tail = plan.count;
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
    const face = plan.get(index);
    const movement = exchange(face, heights, stable, mesh.areas, budget, spent);
    plan.columns.volume[index] = face.volume;
    if (movement <= 1 / 1024) continue;
    enqueueCell(face.i);
    enqueueCell(face.j);
  }
  const cuts = workingArray(map, "float64", "slope:cuts"),
    fills = workingArray(map, "float64", "slope:fills");
  for (let at = 0; at < plan.count; at++) {
    const { i, j, volume } = plan.get(at);
    if (volume >= 0) {
      cuts[i] += volume;
      fills[j] += volume;
    } else {
      cuts[j] -= volume;
      fills[i] -= volume;
    }
  }
  releaseWorking(
    map,
    heights,
    stable,
    budget,
    spent,
    queue,
    queued,
    plan.slots,
    ...Object.values(plan.columns)
  );
  return { cuts, fills };
}
