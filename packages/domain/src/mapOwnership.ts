import type { World } from "./model";
import type { Geometry } from "geojson";

export interface MapOwnership {
  sourceAreaId: string;
  sourceRevision: number;
  refinementLevel: number;
  /** The captured working frame stays stable across repeated refinement. */
  extent?: Geometry;
}

/** Ancestry locates independent maps but never supplies their live geographic records. */
export function ownsMapGeography(world: Pick<World, "areas">, areaId: string): boolean {
  const area = world.areas[areaId];
  return !!area && (!area.parentId || !!area.map);
}

/**
 * Geography is generated on every map except a building interior, which has no terrain. A
 * world whose history is fixed is one with any such run.
 */
export function hasGeneratedGeography(world: Pick<World, "areas" | "generations">): boolean {
  return world.generations.some(
    (run) => !run.areaId || world.areas[run.areaId]?.profile !== "interior"
  );
}

/** Legacy authoring representations stop at the first independently owned map. */
export function geographyAreas(world: Pick<World, "areas">, areaId: string): string[] {
  const ids: string[] = [];
  for (
    let id: string | null = areaId;
    id && !ids.includes(id);
    id = world.areas[id]?.parentId ?? null
  ) {
    ids.push(id);
    if (ownsMapGeography(world, id)) break;
  }
  return ids;
}
