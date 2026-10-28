import type { PhysicalField } from "./field";
import type { PhysicalProfile } from "./profile";
import { clamp } from "./math";
import { edgeLeadingTo } from "./mesh";
import { workingArray, workingValues, releaseWorking } from "./physicalNumerics";
import type { Band } from "@atlas/domain";

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
    for (let edge = 0; edge < mesh.degree(i); edge++) if (mesh.neighbor(i, edge) > i) count++;
  const columns = {
    i: workingArray(map, "int32", "slope:from", count),
    j: workingArray(map, "int32", "slope:to", count),
    distance: workingArray(map, "float64", "slope:distance", count),
    diffusion: workingArray(map, "float64", "slope:diffusion", count),
    volume: workingArray(map, "float64", "slope:volume", count),
  };
  // One slot per directed edge, addressed as cell × stride + edge.
  const slots = workingArray(map, "int32", "slope:slots", mesh.count * mesh.stride).fill(-1);
  let index = 0;
  for (let i = 0; i < mesh.count; i++)
    for (let edge = 0; edge < mesh.degree(i); edge++) {
      const j = mesh.neighbor(i, edge);
      if (j <= i) continue;
      slots.set(i * mesh.stride + edge, index);
      slots.set(j * mesh.stride + edgeLeadingTo(mesh, j, i), index);
      columns.i.set(index, i);
      columns.j.set(index, j);
      columns.distance.set(index, mesh.edgeLength(i, edge));
      columns.diffusion.set(
        index++,
        (((p.MassWastingTransportLength ** 2 * p.MassWastingTransportFraction) / 1000) *
          mesh.faceLength(i, edge)) /
          mesh.faceDistance(i, edge)
      );
    }
  return {
    columns,
    count,
    slots,
    get(at: number): Face {
      return {
        i: columns.i.get(at),
        j: columns.j.get(at),
        distance: columns.distance.get(at),
        diffusion: columns.diffusion.get(at),
        volume: columns.volume.get(at),
      };
    },
  };
}
function exchange(
  face: Face,
  heights: Band,
  stable: Band,
  area: (i: number) => number,
  budget: Band,
  spent: Band
) {
  const { i, j, volume: old } = face,
    areaI = area(i),
    areaJ = area(j);
  const inverse = 1 / areaI + 1 / areaJ;
  const head = heights.get(i) - heights.get(j) + old * inverse;
  const driving =
    head > 0
      ? Math.max(0, head - stable.get(i) * face.distance)
      : Math.min(0, head + stable.get(j) * face.distance);
  if (old > 0) spent.add(i, -old);
  if (old < 0) spent.add(j, old);
  const desired = driving / (inverse + 1 / face.diffusion);
  const volume = clamp(
    desired,
    -Math.max(0, budget.get(j) - spent.get(j)),
    Math.max(0, budget.get(i) - spent.get(i))
  );
  if (volume > 0) spent.add(i, volume);
  if (volume < 0) spent.add(j, -volume);
  const change = volume - old;
  heights.add(i, -change / areaI);
  heights.add(j, change / areaJ);
  face.volume = volume;
  return Math.abs(change) * Math.max(1 / areaI, 1 / areaJ);
}
/** Backward-Euler face exchange with unilateral stable slopes and finite source budgets. */
export function hillslopeFlux(map: PhysicalField, p: PhysicalProfile) {
  const mesh = map.mesh,
    plan = faces(map, p);
  const heights = workingValues(
    map,
    "float64",
    "slope:heights",
    (i) => map.Elevation.get(i) / 1024
  );
  // Living cover holds slopes: roots steepen the stable gradient and bind the material a
  // slope can shed, so cleared or burnt land moves and wooded land stands.
  const binding = (i: number) =>
    clamp(map.TreeCover.get(i) + 0.5 * map.GrassCover.get(i) + 0.5 * map.WetlandCover.get(i), 0, 1);
  const stable = workingValues(
    map,
    "float64",
    "slope:stable",
    (i) =>
      p.MassWastingStableGradient *
      clamp(0.55 + (map.RockResistance.get(i) / 1000) * 0.45, 0.55, 1.45) *
      (1 + map.TreeCover.get(i) * 0.2 + map.GrassCover.get(i) * 0.1)
  );
  const budget = workingValues(
    map,
    "float64",
    "slope:budget",
    (i) => p.MaximumHillslopeTransport * Math.sqrt(mesh.area(i)) * (1 - 0.6 * binding(i))
  );
  const spent = workingArray(map, "float64", "slope:spent");
  relaxFaces(map, plan, heights, stable, budget, spent);
  const cuts = workingArray(map, "float64", "slope:cuts"),
    fills = workingArray(map, "float64", "slope:fills");
  for (let at = 0; at < plan.count; at++) {
    const { i, j, volume } = plan.get(at);
    if (volume >= 0) {
      cuts.add(i, volume);
      fills.add(j, volume);
    } else {
      cuts.add(j, -volume);
      fills.add(i, -volume);
    }
  }
  releaseWorking(map, heights, stable, budget, spent, plan.slots, ...Object.values(plan.columns));
  return { cuts, fills };
}
/**
 * Relax every face until no exchange moves material. A bounded ring contains each face at
 * most once. This is solver work, not a world-wide geological clock set by the smallest
 * control volume.
 */
function relaxFaces(
  map: PhysicalField,
  plan: ReturnType<typeof faces>,
  heights: Band,
  stable: Band,
  budget: Band,
  spent: Band
) {
  const mesh = map.mesh,
    area = (i: number) => mesh.area(i),
    queue = workingArray(map, "int32", "slope:queue", plan.count + 1),
    queued = workingArray(map, "uint8", "slope:queued", plan.count).fill(1);
  for (let i = 0; i < plan.count; i++) queue.set(i, i);
  let head = 0,
    tail = plan.count;
  const enqueueCell = (cell: number) => {
    for (let edge = 0; edge < mesh.degree(cell); edge++) {
      const index = plan.slots.get(cell * mesh.stride + edge);
      if (index < 0 || queued.get(index)) continue;
      queue.set(tail, index);
      tail = (tail + 1) % queue.length;
      queued.set(index, 1);
    }
  };
  while (head !== tail) {
    const index = queue.get(head);
    head = (head + 1) % queue.length;
    queued.set(index, 0);
    const face = plan.get(index);
    const movement = exchange(face, heights, stable, area, budget, spent);
    plan.columns.volume.set(index, face.volume);
    if (movement <= 1 / 1024) continue;
    enqueueCell(face.i);
    enqueueCell(face.j);
  }
  releaseWorking(map, queue, queued);
}
