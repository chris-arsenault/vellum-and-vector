import { MapScale, RecordQueue, type Band } from "@atlas/domain";
import type { PhysicalField } from "../world/field";
import type { PhysicalProfile } from "../world/profile";
import { clamp } from "../world/math";
import { edgeLeadingTo } from "../world/mesh";
import { workingArray, workingValues, releaseWorking } from "../world/physicalNumerics";
import { groundOf } from "../rock/ground";
import { averageGroundQuery, groundFact } from "../rock/groundQuery";
import { compileMix } from "../rock/modes";
import { rockCatalogue } from "../rock/rockCatalogue";

const failing = compileMix({ shear: 1 });
/**
 * How far this ground steepens or lowers the angle a slope holds: stronger rock stands steeper, open
 * joints stand gentler, and roots hold what would slide.
 */
const angleHeld = averageGroundQuery({
  start: 1,
  rock: (_, layer, { tree, grass }) =>
    clamp(0.55 + (layer.strength / rockCatalogue.strata.resistance) * 0.45, 0.55, 1.45) *
    (1.2 - 0.5 * groundFact(layer, "jointing")) *
    (1 + tree * 0.2 + grass * 0.1),
});
interface Face {
  i: number;
  j: number;
  distance: number;
  diffusion: number;
  volume: number;
}
function faces(map: PhysicalField) {
  const mesh = map.mesh;
  const ground = groundOf(map);
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
        // Ground that gives up easily goes in fewer rounds; what holds together comes away slowly.
        map.Elevation.get(i) >= map.Elevation.get(j)
          ? ground.faceGives(i, j, failing)
          : ground.faceGives(j, i, failing)
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
function exchange(face: Face, heights: Band, stable: Band, area: (i: number) => number) {
  const { i, j, volume: old } = face,
    areaI = area(i),
    areaJ = area(j);
  const inverse = 1 / areaI + 1 / areaJ;
  const head = heights.get(i) - heights.get(j) + old * inverse;
  const driving =
    head > 0
      ? Math.max(0, head - stable.get(i) * face.distance)
      : Math.min(0, head + stable.get(j) * face.distance);
  // What would level the step, less by how much the ground holds together: the same at any cell size.
  const volume = face.diffusion > 0 ? driving / (inverse * (1 + 1 / face.diffusion)) : 0;
  const change = volume - old;
  heights.add(i, -change / areaI);
  heights.add(j, change / areaJ);
  face.volume = volume;
  return Math.abs(change) * Math.max(1 / areaI, 1 / areaJ);
}
/** One foundation releases at most one finite surface slab from a cell in this settlement. */
function supportFailures(map: PhysicalField, failsAt: number) {
  const ground = groundOf(map),
    mesh = map.mesh,
    failed = workingArray(map, "uint8", "slope:failed").fill(0),
    routes = new RecordQueue(3);
  for (let i = 0; i < mesh.count; i++) {
    let target = -1,
      volume = 0,
      selected = 0;
    for (const [part, facet] of (["land", "cut"] as const).entries()) {
      const share = ground.share(i, facet);
      if (share <= 0) continue;
      const stable = failsAt * ground.fold(i, angleHeld, facet);
      let failure: ReturnType<typeof ground.failureFrom> | undefined;
      for (let edge = 0; edge < mesh.degree(i); edge++) {
        const j = mesh.neighbor(i, edge);
        if (j < 0 || ground.surface(i, facet) <= map.Elevation.get(j)) continue;
        failure ??= ground.failureFrom(i, facet, failing);
        const depth = failure(j, mesh.edgeLength(i, edge), stable),
          candidate = MapScale.metres(depth, "native") * share * mesh.area(i);
        if (candidate <= volume) continue;
        target = j;
        volume = candidate;
        selected = part;
      }
    }
    if (volume <= 0) continue;
    failed.set(i, 1);
    routes.push(i, target, volume, selected);
  }
  return { failed, routes };
}
/** Backward-Euler face exchange with unilateral stable slopes: ground fails until it stands. */
export function hillslopeFlux(map: PhysicalField, p: PhysicalProfile) {
  const plan = faces(map);
  const heights = workingValues(map, "float64", "slope:heights", (i) =>
    MapScale.metres(map.Elevation.get(i), "native")
  );
  // These heights span the represented neighbor distance. An assumed subcell hillslope length
  // cannot turn a gentle regional flank into a failing cliff. Material still sets its stable angle.
  const ground = groundOf(map),
    failsAt = p.MassWastingStableGradient;
  const stable = workingValues(
    map,
    "float64",
    "slope:stable",
    (i) => failsAt * ground.fold(i, angleHeld)
  );
  relaxFaces(map, plan, heights, stable);
  const { failed, routes } = supportFailures(map, failsAt);
  for (let at = 0; at < plan.count; at++) {
    const { i, j, volume } = plan.get(at);
    if (volume >= 0 && !failed.get(i)) routes.push(i, j, volume, -1);
    else if (volume < 0 && !failed.get(j)) routes.push(j, i, -volume, -1);
  }
  releaseWorking(map, heights, stable, failed, plan.slots, ...Object.values(plan.columns));
  return routes;
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
  stable: Band
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
    const movement = exchange(face, heights, stable, area);
    plan.columns.volume.set(index, face.volume);
    if (movement <= MapScale.metres(1, "native")) continue;
    enqueueCell(face.i);
    enqueueCell(face.j);
  }
  releaseWorking(map, queue, queued);
}
