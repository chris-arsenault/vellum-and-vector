import type { MapEditing, MapLibrary, MapReader, MapNavigation } from "@atlas/map";
import type { GenerationService } from "./generation";
import type { ContextManagement } from "./management";

export type AtlasMode = "browser" | "backend";
export interface ContextServices<Configuration> {
  maps: MapReader;
  navigation: MapNavigation;
  /** Real-scale authoring; world and regional maps refuse edits. */
  editing: MapEditing;
  library: MapLibrary;
  generation: GenerationService<Configuration>;
  contexts: ContextManagement;
  dispose(): Promise<void>;
}
// owner-direction(2026-11-12): only pure browser or pure backend is supported
export type AtlasContext<Configuration> =
  | (ContextServices<Configuration> & { readonly mode: "browser" })
  | (ContextServices<Configuration> & { readonly mode: "backend" });
export type ContextFactories<Configuration> = {
  [Mode in AtlasMode]: () => Promise<ContextServices<Configuration>>;
};

/** Initialize only the chosen host; failures never initialize a different workspace. */
export async function createAtlasContext<Configuration>(
  mode: AtlasMode,
  factories: ContextFactories<Configuration>
): Promise<AtlasContext<Configuration>> {
  // Check the runtime boundary too: configuration can arrive from outside TypeScript.
  if (mode !== "browser" && mode !== "backend") throw new Error("Unknown atlas context");
  return { ...(await factories[mode]()), mode };
}
