import { requireThat } from "@atlas/domain";
import type { BinaryStore } from "./opfsStore";
import { resourcePrefix } from "./resourcePaths";

/** The Rust writer supplies complete Zarr chunks; this host only owns local I/O. */
export function rustResourceOutput(store: BinaryStore) {
  return {
    async create(id: string) {
      requireThat(
        !(await store.get(`${resourcePrefix(id)}/resource.json`)),
        "resource_exists",
        "Completed numerical resources are immutable."
      );
    },
    write: (id: string, path: string, bytes: Uint8Array) =>
      store.set(`${resourcePrefix(id)}/${path}`, bytes),
    remove: (id: string) => store.deletePrefix(resourcePrefix(id)),
  };
}
