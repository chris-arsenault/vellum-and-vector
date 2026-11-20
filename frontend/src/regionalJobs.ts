import { useRef } from "react";
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
interface Results {
  context: FinishedContext;
  cache: QueryClient;
  target: JobTarget | null;
  /** The map open now, read when an event arrives rather than when the job started. */
  current(): MapRef | null;
  open(reference: MapRef): Promise<void>;
  offer(child: MapRef, selection: RegionSelection): Promise<void>;
  close(): void;
  setError(error: unknown): void;
}
/**
 * A job brings its map into view once, on its first publication. Later publications and its
 * completion refresh that map only while it is open, so navigating away is never undone.
 * A refinement that creates its child still drops the user into the child with its controls.
 */
export function useJobResults(results: Results) {
  const shown = useRef<string | null>(null);
  const follow = async (reference: MapRef) => {
    const here = results.current();
    if (here?.mapId !== reference.mapId && shown.current === reference.mapId) return;
    shown.current = reference.mapId;
    if (here?.revision !== reference.revision || here.mapId !== reference.mapId)
      await results.open(reference);
  };
  return {
    restart: () => void (shown.current = null),
    published: async (reference: MapRef) => {
      await results.cache.invalidateQueries({ queryKey: ["finished-map", reference] });
      await follow(reference);
    },
    complete: async (reference: MapRef) => {
      const { target } = results;
      try {
        await attachChild(results.context, results.cache, target?.selection ?? null, reference);
      } catch (error) {
        results.setError(error);
      }
      if (!target?.creates) return follow(reference);
      await results.open(reference);
      results.close();
      await results.offer(reference, target.selection);
    },
  };
}
/** A map takes one job at a time; a cancelled job holds its map until it has stopped. */
export async function requireIdle(context: FinishedContext, map: MapRef) {
  const jobs = await context.generation.jobs();
  if (jobs.some((job) => job.state === "running" && job.details?.parent?.mapId === map.mapId))
    throw new Error("This map is still generating. Wait for its current job to stop.");
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
  await cache.invalidateQueries({ queryKey: ["stored-contexts"] });
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
