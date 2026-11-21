import { useQuery } from "@tanstack/react-query";
import { collectPages, type MapReader } from "@atlas/map";
import type { AuthoringSession } from "./useRealScaleAuthoring";

/** The selected features as published, re-read after every edit. */
export function useSelectedFeatures(session: AuthoringSession, reader: MapReader) {
  const { map, state } = session;
  const query = useQuery({
    queryKey: ["edited-features", map.reference, state.selected, map.realScale?.edits ?? 0],
    enabled: state.selected.length > 0,
    // A selection can lie on the surface, in the caves or on a building's level.
    queryFn: async ({ signal }) =>
      (
        await Promise.all(
          map.spaces.map((space) =>
            collectPages((cursor) =>
              reader.features(
                map.reference,
                { spaceId: space.id, featureIds: state.selected, cursor },
                { signal }
              )
            )
          )
        )
      ).flat(),
  });
  return state.selected.length ? (query.data ?? []) : [];
}
