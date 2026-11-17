import { useQuery } from "@tanstack/react-query";
import type { MapDescriptor, SavedMapDocument } from "@atlas/map";
import { useStructure } from "./structureServices";
import { isGroundMap } from "./structureMaps";

/** The floors maps of a ground map's buildings and how far each has been edited, as one
 * value a saved view records. Opening floors or drawing in them changes it, so the ground
 * map shows unsaved changes and its Save keeps the floors (ADR 0016). */
export function useFloorsState(map: MapDescriptor) {
  const services = useStructure();
  const ground = isGroundMap(map) && !!services;
  const floors = useQuery({
    // Under "related-maps", so opening floors refreshes it with the breadcrumb's children.
    queryKey: ["related-maps", "floors", map.reference],
    enabled: ground,
    queryFn: async ({ signal }) => {
      const related = await services!.library.related(map.reference, { signal });
      const children = await Promise.all(
        related.children.map((child) => services!.reader.open(child, { signal }))
      );
      return children
        .filter((child) => child.realScale?.site)
        .map((child) => `${child.reference.mapId}:${child.realScale?.edits ?? 0}`)
        .sort()
        .join(",");
    },
  });
  return { value: ground ? floors.data : "", reading: ground && floors.isFetching };
}
/** The floors value to save with a map, whether it matches the saved view's, and whether
 * it is still being read (a stale value must not be saved). */
export function useSavedFloors(map: MapDescriptor, saved?: SavedMapDocument) {
  const before = (saved?.settings.floors as string | undefined) ?? "";
  const state = useFloorsState(map);
  // Until the floors are read, the saved value stands.
  const floors = state.value ?? before;
  return { floors, unchanged: floors === before, reading: state.reading };
}
