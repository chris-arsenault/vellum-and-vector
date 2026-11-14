import { useQuery } from "@tanstack/react-query";
import type { World } from "@atlas/domain";
import { atlasWorkspace, workspaceScope } from "./atlasWorkspace";

export function useConnections(world: World, areaId: string) {
  return useQuery({
    queryKey: ["connections", world.id, world.version, areaId],
    queryFn: async () => (await atlasWorkspace()).readConnections(workspaceScope(world, areaId)),
  });
}
export function useLayerPresentation(world: World, layerId: string) {
  return useQuery({
    queryKey: ["layerPresentation", world.id, world.version, layerId],
    queryFn: async () => (await atlasWorkspace()).readLayerPresentation(world.id, layerId),
  });
}
