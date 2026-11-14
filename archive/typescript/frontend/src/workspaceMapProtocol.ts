import type { MapPublisher } from "@atlas/context";
import type { MapRef } from "@atlas/map";
import type { MapCall } from "@atlas/transport";

export type MapPublicationMethod = Exclude<keyof MapPublisher, "finish">;
export type WorkspaceMapOperation =
  | { kind: "readMap"; worldId: string; call: MapCall }
  | { kind: "mapHead"; worldId: string; mapId: string }
  | { kind: "mapParent"; worldId: string; areaId: string; revision: number }
  | { kind: "completeMap"; worldId: string; reference: MapRef; revision: number }
  | {
      kind: "publishMap";
      worldId: string;
      method: MapPublicationMethod;
      args: Parameters<MapPublisher[MapPublicationMethod]>;
    };

/** Private publication commands share the workspace worker's ordering with generation writes. */
export class GenerationMapClient {
  constructor(private request: (operation: WorkspaceMapOperation) => Promise<unknown>) {}
  head(worldId: string, mapId: string) {
    return this.request({ kind: "mapHead", worldId, mapId }) as Promise<MapRef | null>;
  }
  parent(worldId: string, areaId: string, revision: number) {
    return this.request({ kind: "mapParent", worldId, areaId, revision }) as Promise<MapRef>;
  }
  publisher(worldId: string, revision: number): MapPublisher {
    const call = async <M extends MapPublicationMethod>(
      method: M,
      ...args: Parameters<MapPublisher[M]>
    ) => {
      await this.request({ kind: "publishMap", worldId, method, args });
    };
    return {
      begin: (...args) => call("begin", ...args),
      append: (...args) => call("append", ...args),
      addLayer: (...args) => call("addLayer", ...args),
      discard: (...args) => call("discard", ...args),
      finish: async (reference) => {
        await this.request({ kind: "completeMap", worldId, reference, revision });
      },
    };
  }
}
