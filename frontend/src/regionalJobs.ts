import type { QueryClient } from "@tanstack/react-query";
import type {
  MapDescriptor,
  MapNavigationState,
  MapRef,
  MapRegion,
  RegionSelection,
} from "@atlas/map";
import type { FinishedContext } from "./App";

/** The region a job's map belongs to; `creates` marks the job that creates the child. */
export interface JobTarget {
  selection: RegionSelection;
  creates: boolean;
  /** The child a refinement regenerates; its controls reopen after a cancel or failure. */
  child?: MapRef;
}
/**
 * A refinement that stops before finishing leaves its child at the revision it started from:
 * the child reopens there, and its region's controls can reopen over it.
 */
export function useRecovery(
  target: JobTarget | null,
  actions: {
    close(): void;
    open(reference: MapRef): Promise<void>;
    refine(selection: RegionSelection, name: string, child?: MapRef): Promise<void>;
  }
) {
  if (!target?.child || target.creates) return { adjust: undefined, stopped: undefined };
  const { selection, child } = target;
  return {
    stopped: () => void actions.open(child),
    adjust: () => {
      actions.close();
      void actions.refine(selection, selection.regionPath.at(-1)?.name ?? "", child);
    },
  };
}
/** The parent's region whose child is `map`, as a refinement selection; null for a world. */
export async function childSelection(
  context: FinishedContext,
  cache: QueryClient,
  map: MapDescriptor
): Promise<RegionSelection | null> {
  if (!map.parent) return null;
  const state = await workingNavigation(context, cache, map.parent);
  const region = state.regions.find((each) => each.child?.mapId === map.reference.mapId);
  if (!region) return null;
  const regionPath: MapRegion[] = [];
  for (let at: MapRegion | undefined = region; at;) {
    regionPath.unshift(at);
    const parentId: string | null = at.parentId;
    at = state.regions.find((each) => each.id === parentId);
  }
  return {
    parent: map.parent,
    spaceId: region.spaceId,
    geometry: region.geometry,
    featureIds: [],
    regionPath,
  };
}
export async function attachChild(
  context: FinishedContext,
  cache: QueryClient,
  selection: RegionSelection | null,
  reference: MapRef
) {
  const selected = selection?.regionPath.at(-1);
  if (selection && selected) {
    const state = await workingNavigation(context, cache, selection.parent);
    const next = await context.navigation.commit(selection.parent, state, {
      kind: "attachChild",
      data: { region_id: selected.id, child: reference },
    });
    cache.setQueryData(["map-navigation", selection.parent], next);
  }
  await cache.invalidateQueries({ queryKey: ["related-maps"] });
}
/** A map's working regions stay in the cache until saved; the store holds only the saved ones. */
async function workingNavigation(
  context: FinishedContext,
  cache: QueryClient,
  map: MapRef
): Promise<MapNavigationState> {
  const key = ["map-navigation", map];
  return (
    cache.getQueryData<MapNavigationState>(key) ??
    (await cache.fetchQuery<MapNavigationState>({
      queryKey: key,
      queryFn: ({ signal }) => context.navigation.read(map, { signal }),
    }))
  );
}
