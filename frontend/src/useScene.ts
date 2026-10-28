import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { useMemo } from "react";
import { atlasWorkspace, workspaceScope } from "./atlasWorkspace";
import { bounds } from "./presentation";
import { spatial, type Bounds } from "@atlas/domain";
import { type AtlasFeature, type World } from "./types";
import { sceneWindows, displayTolerance, mergeDisplayFragments } from "./sceneWindows";

export function useMapData(
  world: World,
  areaId: string,
  extent: number[] | null = null,
  resolution = 0
) {
  const scene = useScene(world, areaId, extent, resolution);
  const window = (extent ?? bounds(world.areas[areaId].footprint)) as Bounds;
  const windows = sceneWindows(world, window);
  const tolerance = displayTolerance(resolution);
  const fields = useQuery({
    queryKey: ["fields", world.id, areaId, windows, tolerance],
    staleTime: Infinity,
    gcTime: 0,
    placeholderData: keepPreviousData,
    enabled: extent !== null,
    queryFn: async () => (await atlasWorkspace()).readRasters(world.id, areaId, window, tolerance),
  });
  const split = useMemo(
    () => ({
      raster: fields.data?.filter((r) => r.channel !== "elevation"),
      base: fields.data?.filter((r) => r.channel === "elevation"),
    }),
    [fields.data]
  );
  const raster = { ...fields, data: split.raster };
  const baseRaster = { ...fields, data: split.base };
  return { scene, raster, baseRaster };
}

export function editArea(world: World, areaId: string, feature: AtlasFeature) {
  for (let current: string | null = areaId; current; current = world.areas[current].parentId)
    if (current === feature.areaId) return areaId;
  return feature.areaId;
}
export function scopedFootprint(world: World, areaId: string, feature: AtlasFeature) {
  if (!feature.footprint || feature.areaId === areaId) return feature;
  const footprint = spatial.intersection(feature.footprint, world.areas[areaId].footprint);
  const local = { ...feature };
  delete local.footprint;
  if (footprint) local.footprint = footprint;
  return local;
}

export function useScene(
  world: World,
  areaId: string,
  extent: number[] | null | undefined = undefined,
  resolution = 0
) {
  const tolerance = displayTolerance(resolution);
  const windows = sceneWindows(world, (extent ?? bounds(world.areas[areaId].footprint)) as Bounds);
  return useQuery<AtlasFeature[]>({
    queryKey: ["scene", world.id, areaId, windows, tolerance],
    staleTime: Infinity,
    gcTime: 0,
    enabled: extent !== null,
    placeholderData: (previous, query) => (query?.queryKey[2] === areaId ? previous : undefined),
    queryFn: async ({ signal }) => {
      const workspace = await atlasWorkspace(),
        features = new Map<string, AtlasFeature>();
      for (const window of windows) {
        let after: string | null = null;
        do {
          signal.throwIfAborted();
          const page = await workspace.readDisplay(
            {
              scope: workspaceScope(world, areaId),
              extent: window,
              layers: [],
              after,
              limit: 128,
              predicate: "intersects",
              geometry: null,
            },
            tolerance
          );
          for (const { feature } of page.records) {
            const previous = features.get(feature.id);
            features.set(
              feature.id,
              previous
                ? {
                    ...feature,
                    geometry: mergeDisplayFragments(previous.geometry, feature.geometry),
                    ...(previous.footprint && feature.footprint
                      ? { footprint: mergeDisplayFragments(previous.footprint, feature.footprint) }
                      : {}),
                  }
                : feature
            );
          }
          after = page.next;
        } while (after);
      }
      return [...features.values()];
    },
  });
}
