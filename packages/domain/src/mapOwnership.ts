import type { World } from "./model";

/** Ancestry locates independent maps but never supplies their live geographic records. */
export function ownsMapGeography(world: Pick<World, "areas">, areaId: string): boolean {
  const area = world.areas[areaId];
  return !!area && (!area.parentId || !!area.map);
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
