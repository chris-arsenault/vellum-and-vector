import type { MapLibrary, MapRef, SaveMapRequest, SavedMapDocument, RelatedMaps } from "@atlas/map";
import { openMapWorkspace } from "./mapWorkspace";

type Workspace = Awaited<ReturnType<typeof openMapWorkspace>>;

async function saved<T>(read: (maps: Workspace) => T | Promise<T>): Promise<T> {
  return navigator.locks.request("atlas-saved-maps", async () => {
    const maps = await openMapWorkspace("saved");
    try {
      return await read(maps);
    } finally {
      await maps.close();
    }
  });
}

/** Platform catalog leases only; Rust copies and validates immutable GIS records. */
export function browserSavedMaps(
  local: Workspace,
  retain: (request: SaveMapRequest) => Promise<void>
) {
  async function ensure(reference: MapRef) {
    if (local.catalog.rust.contains(JSON.stringify(reference))) return;
    await saved((maps) => local.catalog.rust.copy_from(maps.source, JSON.stringify(reference)));
  }
  const library: MapLibrary = {
    list: (cursor, options) => saved((maps) => maps.library.list(cursor, options)),
    find: (id, options) => saved((maps) => maps.library.find(id, options)),
    open: (id, options) =>
      saved(async (maps) => {
        const document = await maps.library.open(id, options);
        local.catalog.rust.copy_from(maps.source, JSON.stringify(document.reference));
        return document;
      }),
    async save(request, options) {
      options?.signal?.throwIfAborted();
      await retain(request);
      return saved(
        (maps) =>
          JSON.parse(
            maps.catalog.rust.save_from(
              local.source,
              JSON.stringify(request),
              new Date().toISOString()
            )
          ) as SavedMapDocument
      );
    },
    async related(reference, options) {
      options?.signal?.throwIfAborted();
      await ensure(reference);
      return saved(
        (maps) =>
          JSON.parse(
            local.catalog.rust.related_with(maps.source, JSON.stringify(reference))
          ) as RelatedMaps
      );
    },
  };
  return { ensure, library };
}
