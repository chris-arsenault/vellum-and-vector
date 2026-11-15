import { useState } from "react";
import { useMutation, useQuery, useQueryClient, type QueryClient } from "@tanstack/react-query";
import type { DeleteContext, GenerationStatus, StoredContext } from "@atlas/context";
import type { MapRef, MapNavigationState, SavedMapDocument } from "@atlas/map";
import type { FinishedContext } from "./App";

export interface LibraryProps {
  context: FinishedContext;
  close(): void;
  open(reference: MapRef, saved?: SavedMapDocument): void;
  observe(job: GenerationStatus): void;
  retained(mapIds: Set<string>): void;
}
export function useContextLibrary(props: LibraryProps) {
  const { context, open, observe } = props;
  const cache = useQueryClient();
  const [selected, select] = useState<StoredContext | null>(null);
  const [showJobs, setShowJobs] = useState(false);
  const [deleting, confirmDelete] = useState<{ target: DeleteContext; name: string } | null>(null);
  const inventory = useQuery({
    queryKey: ["stored-contexts", context.mode],
    queryFn: ({ signal }) => context.contexts.list({ signal }),
  });
  const jobs = useQuery({
    queryKey: ["generation-jobs", context.mode],
    enabled: showJobs || selected !== null,
    queryFn: ({ signal }) => context.generation.jobs({ signal }),
    refetchInterval: 2000,
  });
  const opening = useMutation({
    mutationFn: async (map: StoredContext) => {
      await context.maps.open(map.reference);
      const saved = await context.library.find(map.reference.mapId);
      return {
        reference: map.reference,
        saved: saved?.reference.revision === map.reference.revision ? saved : undefined,
      };
    },
    onSuccess: ({ reference, saved }) => open(reference, saved),
  });
  const resume = useMutation({
    mutationFn: (job: GenerationStatus) => context.generation.resume(job.jobId),
    onSuccess: observe,
  });
  const remove = useMutation({
    mutationFn: (target: DeleteContext) => context.contexts.delete(target),
    onSuccess: (value) => {
      cache.setQueryData(["stored-contexts", context.mode], value);
      props.retained(new Set(value.maps.map((map) => map.reference.mapId)));
      const retained = new Set(value.maps.map((map) => map.reference.mapId));
      detachDeletedChildren(cache, retained);
      confirmDelete(null);
      if (selected && !value.maps.some((m) => m.reference.mapId === selected.reference.mapId))
        select(null);
    },
    onSettled: async () => {
      await Promise.all([
        inventory.refetch(),
        jobs.refetch(),
        cache.invalidateQueries({ queryKey: ["saved-maps"] }),
        cache.invalidateQueries({ queryKey: ["related-maps"] }),
      ]);
    },
  });
  return {
    inventory,
    jobs,
    selected,
    select,
    deleting,
    confirmDelete,
    opening,
    resume,
    remove,
    props,
    setShowJobs,
  };
}
export type LibraryState = ReturnType<typeof useContextLibrary>;
function detachDeletedChildren(cache: QueryClient, retained: Set<string>) {
  for (const [key, view] of cache.getQueriesData<MapNavigationState>({
    queryKey: ["map-navigation"],
  })) {
    if (view?.regions.some((region) => region.child && !retained.has(region.child.mapId)))
      cache.setQueryData(key, {
        ...view,
        version: view.version + 1,
        regions: view.regions.map((region) =>
          region.child && !retained.has(region.child.mapId) ? { ...region, child: null } : region
        ),
      });
  }
}
