import { createAtlasContext, type AtlasMode } from "@atlas/context";
import {
  RpcMapReader,
  RpcMapLibrary,
  RpcMapNavigation,
  RpcMapEditing,
  RpcGeneration,
  httpMapReader,
  httpMapLibrary,
  httpMapNavigation,
  httpMapEditing,
  HttpGeneration,
  RpcContextManagement,
  httpContextManagement,
} from "@atlas/transport";
import { AtlasContextClient } from "./AtlasContextClient";

export function executionMode(): AtlasMode {
  const mode = document.documentElement.dataset.atlasHost;
  if (mode !== "browser" && mode !== "backend")
    throw new Error("The application document must select its execution host.");
  return mode;
}

export function openFinishedAtlas<Configuration>(mode: AtlasMode, backendUrl?: string) {
  return createAtlasContext<Configuration>(mode, {
    async browser() {
      const worker = new AtlasContextClient(
        new Worker(new URL("./atlasContext.worker.ts", import.meta.url), { type: "module" })
      );
      try {
        await worker.request({ service: "open" });
      } catch (error) {
        await worker.close();
        throw error;
      }
      return {
        maps: new RpcMapReader((call, options) =>
          worker.request({ service: "maps", call }, options)
        ),
        library: new RpcMapLibrary((call, options) =>
          worker.request({ service: "library", call }, options)
        ),
        navigation: new RpcMapNavigation((call, options) =>
          worker.request({ service: "navigation", call }, options)
        ),
        editing: new RpcMapEditing((call, options) =>
          worker.request({ service: "editing", call }, options)
        ),
        generation: new RpcGeneration<Configuration>((call, options) =>
          worker.request({ service: "generation", call }, options)
        ),
        contexts: new RpcContextManagement((call, options) =>
          worker.request({ service: "contexts", call }, options)
        ),
        dispose: () => worker.close(),
      };
    },
    async backend() {
      if (!backendUrl) throw new Error("Configure the LAN backend address.");
      const maps = httpMapReader(backendUrl);
      return {
        maps,
        library: httpMapLibrary(backendUrl),
        navigation: httpMapNavigation(backendUrl),
        editing: httpMapEditing(backendUrl),
        generation: new HttpGeneration<Configuration>(backendUrl),
        contexts: httpContextManagement(backendUrl),
        dispose: () => Promise.resolve(),
      };
    },
  });
}
