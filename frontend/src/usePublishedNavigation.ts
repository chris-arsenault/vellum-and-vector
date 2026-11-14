import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type {
  MapDescriptor,
  MapNavigation,
  MapNavigationState,
  NavigationChange,
} from "@atlas/map";

/** Rust validates view changes on the selected host; only Save map persists them. */
export function usePublishedNavigation(map: MapDescriptor, navigation: MapNavigation) {
  const cache = useQueryClient();
  const queryKey = ["map-navigation", map.reference];
  const query = useQuery({
    queryKey,
    staleTime: Infinity,
    queryFn: ({ signal }) => navigation.read(map.reference, { signal }),
  });
  const mutation = useMutation({
    mutationFn: async ({ change, version }: { change: NavigationChange; version: number }) => {
      const current = cache.getQueryData<MapNavigationState>(queryKey);
      if (!current || current.version !== version)
        throw new Error("The map view changed. Try the selection again.");
      const next = await navigation.commit(map.reference, current, change);
      if (cache.getQueryData<MapNavigationState>(queryKey)?.version !== version)
        throw new Error("The map view changed. Try the selection again.");
      cache.setQueryData(queryKey, next);
      return next;
    },
  });
  return {
    state: query.data ?? null,
    error: mutation.error ?? query.error,
    pending: mutation.isPending,
    async commit(change: NavigationChange, expectedVersion = query.data?.version) {
      if (expectedVersion === undefined) throw new Error("Wait for map regions and views to load.");
      return mutation.mutateAsync({ change, version: expectedVersion });
    },
  };
}
export type PublishedNavigationState = ReturnType<typeof usePublishedNavigation>;
export const asError = (error: unknown) =>
  error instanceof Error ? error : new Error(String(error));
