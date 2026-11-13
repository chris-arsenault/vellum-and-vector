import type { RetainedRiverNetwork } from "@atlas/domain";
import type { PhysicalField } from "../world/field";
import { nearestTriangle } from "../world/mesh";

/** Detached records travel with the map catalog and explicit local saves. */
export function captureRivers(map: PhysicalField): RetainedRiverNetwork {
  const position = (cell: number): [number, number] => [
    map.mesh.x(cell) + map.mesh.origin[0],
    map.mesh.y(cell) + map.mesh.origin[1],
  ];
  return {
    next: map.rivers.next,
    entries: map.rivers.entries.map((entry) => ({
      position: position(entry.cell),
      monthly: Array.from(entry.monthly),
      catchment: entry.catchment,
    })),
    reaches: [...map.rivers.reaches.values()].map((reach) => {
      const { cells, former, monthly, catchment, bed, width, depth, leakage, ...identity } = reach;
      return {
        ...identity,
        course: cells.map(position),
        former: former.map(({ cells, leftIn }) => ({ course: cells.map(position), leftIn })),
        monthly: Array.from(monthly),
        catchment: Array.from(catchment),
        bed: Array.from(bed),
        width: Array.from(width),
        depth: Array.from(depth),
        leakage: Array.from(leakage),
      };
    }),
  };
}

/** Restoring a map imports its own network; it never discovers rivers from its raster. */
export function restoreRivers(map: PhysicalField, saved: RetainedRiverNetwork) {
  const cell = ([x, y]: [number, number]) =>
    nearestTriangle(map.mesh, x - map.mesh.origin[0], y - map.mesh.origin[1]);
  map.rivers.reaches.clear();
  map.rivers.next = saved.next;
  map.rivers.entries = saved.entries.map((entry) => ({
    cell: cell(entry.position),
    monthly: Float64Array.from(entry.monthly),
    catchment: entry.catchment,
  }));
  for (const reach of saved.reaches)
    map.rivers.reaches.set(reach.id, {
      ...reach,
      cells: reach.course.map(cell),
      former: reach.former.map(({ course, leftIn }) => ({ cells: course.map(cell), leftIn })),
      monthly: Float64Array.from(reach.monthly),
      catchment: Float64Array.from(reach.catchment),
      bed: Float64Array.from(reach.bed),
      width: Float64Array.from(reach.width),
      depth: Float64Array.from(reach.depth),
      leakage: Float64Array.from(reach.leakage),
    });
  map.rivers.at = undefined;
}
