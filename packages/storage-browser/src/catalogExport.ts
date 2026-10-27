import type { SpatialCatalog } from "./spatialCatalog";
import { transferFile } from "./fileTransfer";

interface Access {
  write(bytes: Uint8Array, options: { at: number }): number;
  flush(): void;
  close(): void;
}
type WritableFile = FileSystemFileHandle & { createSyncAccessHandle(): Promise<Access> };
/** The download is a file snapshot; neither worker nor UI holds the complete JSON string. */
export async function exportCatalog(catalog: SpatialCatalog, worldId: string, areaId?: string) {
  const root = await navigator.storage.getDirectory();
  const directory = await root.getDirectoryHandle("atlas-exports", { create: true });
  const name = `${crypto.randomUUID()}.geojson`;
  const file = (await directory.getFileHandle(name, { create: true })) as WritableFile;
  const handle = await file.createSyncAccessHandle();
  const encoder = new TextEncoder();
  let offset = 0;
  const write = (text: string) => {
    const bytes = encoder.encode(text);
    offset += transferFile("write", bytes, offset, (part, at) => handle.write(part, { at }));
  };
  try {
    const world = await catalog.readEditor(worldId);
    const header = {
      type: "FeatureCollection",
      worldReference: world.reference,
      name: world.name,
      version: world.version,
      regions: world.views
        .filter((view) => view.region)
        .map((view) => ({
          id: view.id,
          name: view.name,
          areaId: view.areaId,
          ...view.region,
        })),
      areas: Object.values(world.areas).map(({ id, parentId, profile, footprint, frame }) => ({
        id,
        parentId,
        profile,
        footprint,
        frame,
      })),
    };
    write(JSON.stringify(header).slice(0, -1) + ',"features":[');
    let after: string | null = null,
      first = true;
    do {
      const page = catalog.exportFeatures(worldId, areaId, after, 64);
      for (const feature of page.features) {
        write((first ? "" : ",") + JSON.stringify(feature));
        first = false;
      }
      after = page.next;
    } while (after);
    write("]}");
    handle.flush();
  } catch (error) {
    handle.close();
    await directory.removeEntry(name);
    throw error;
  }
  handle.close();
  return { file: await file.getFile(), remove: () => directory.removeEntry(name) };
}
