import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useSyncExternalStore } from "react";
import { subscribe } from "./workspaceEvents";
import { atlasWorkspace, listWorkspaceWorlds, readEditorWorld } from "./atlasWorkspace";
import { commitWorkspaceCommand } from "./workspaceAuthoring";
import { generationPreviewFor, listJobs, startGeneration } from "./generationJobs";
import type { Command, World } from "./types";
import type { AtlasParameters } from "@atlas/generation";

export function useGenerationPreview(worldId: string, areaId: string) {
  return useSyncExternalStore(subscribe, () => generationPreviewFor(worldId, areaId));
}

export function useWorlds() {
  return useQuery({
    queryKey: ["worlds"],
    queryFn: () => listWorkspaceWorlds(),
  });
}
export function useWorld(id: string) {
  return useQuery({
    queryKey: ["world", id],
    queryFn: () => readEditorWorld(id),
    enabled: !!id,
  });
}
export function useJobs(worldId: string) {
  return useQuery({
    queryKey: ["jobs", worldId],
    enabled: !!worldId,
    queryFn: () => listJobs(worldId),
  });
}
export function useHistory(world: Pick<World, "id" | "version">) {
  const id = world.id;
  return useQuery({
    queryKey: ["history", id, world.version],
    gcTime: 0,
    queryFn: async () => (await atlasWorkspace()).readHistory(id, null, 100),
    enabled: !!id,
  });
}
export function makeCommand(world: World, kind: string, data: Record<string, unknown>): Command {
  return { operationId: crypto.randomUUID(), expectedVersion: world.version, kind, data };
}
export function useCommit(worldId: string) {
  const cache = useQueryClient();
  return useMutation({
    mutationKey: ["command", worldId],
    mutationFn: async (command: Command) => commitWorkspaceCommand(worldId, command),
    onSuccess: (result) => {
      cache.setQueryData(["world", worldId], result.candidate);
      return cache.invalidateQueries({ queryKey: ["history", worldId] });
    },
    onError: () => {
      void cache.invalidateQueries({ queryKey: ["world", worldId] });
    },
  });
}
export function useGenerate(world: World, areaId: string) {
  const cache = useQueryClient();
  return useMutation({
    mutationFn: ({
      domains,
      quality,
      seed,
      parameters,
    }: {
      domains: string[];
      quality: string;
      seed: number;
      parameters?: Partial<AtlasParameters>;
    }) =>
      Promise.resolve(
        startGeneration(world.id, {
          operationId: crypto.randomUUID(),
          expectedVersion: world.version,
          areaId,
          domains,
          quality,
          seed,
          parameters,
        })
      ),
    onSuccess: () => {
      void cache.invalidateQueries({ queryKey: ["jobs", world.id] });
    },
  });
}
