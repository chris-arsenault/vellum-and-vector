import { areaSpace, spatial, type Area, type World } from "@atlas/domain";
import type { MapSpace } from "@atlas/map";

/** Frames belong to coordinate spaces; a regional map's opening window is separate. */
export function mapSnapshotSpaces(world: World, areaId: string): MapSpace[] {
  const lineage: Area[] = [];
  for (let id: string | null = areaId; id; id = world.areas[id].parentId)
    lineage.push(world.areas[id]);
  const spaces = new Map<string, MapSpace>();
  for (const area of lineage.reverse()) {
    const id = areaSpace(world, area.id);
    if (spaces.has(id)) continue;
    const bounds = spatial.bounds(id === world.id ? world.reference.domain : area.footprint);
    const origin = area.frame.origin;
    spaces.set(id, {
      id,
      bounds,
      parentSpaceId: area.parentId ? areaSpace(world, area.parentId) : null,
      metresPerUnit: area.frame.metresPerUnit,
      precision: world.reference.precision ?? spatial.precision,
      periodicWidth:
        id === world.id && world.reference.boundaryMode === "cylinder"
          ? bounds[2] - bounds[0]
          : null,
      frame: {
        origin: [origin.x, origin.y, origin.z],
        rotation: area.frame.rotation,
        floor: area.frame.floor,
      },
    });
  }
  return [...spaces.values()];
}
