import { mkdir, copyFile, rm } from "node:fs/promises";
import { constants } from "node:fs";
import { join } from "node:path";
import { NativeResourceFiles } from "@atlas/engine/native";
import { GeometryKernel, SpatialCatalog, ZarrResources } from "@atlas/storage-browser";
import type { BackendCompletedInputs, PostgresGenerationInputs } from "@atlas/storage-postgres";
import type { MapRef } from "@atlas/map";
import { NativeCatalogDatabase } from "./nativeCatalogDatabase";

export interface NativeWorkspace {
  catalog: SpatialCatalog;
  resources: ZarrResources;
  retainInputs(input: Omit<BackendCompletedInputs, "catalogId">): Promise<BackendCompletedInputs>;
  close(): Promise<void>;
}

/** Workspace and captured catalogs are private files beside the native worker's resources. */
export class NativeWorkspaces {
  constructor(
    private directory: string,
    readonly inputs: PostgresGenerationInputs
  ) {}

  async open(id: string, source?: MapRef): Promise<NativeWorkspace> {
    const path = this.path("working", id);
    await mkdir(join(this.directory, "working"), { recursive: true });
    if (source) {
      const input = await this.inputs.read(source);
      await copyFile(this.path("completed", input.catalogId), path, constants.COPYFILE_EXCL);
    }
    const catalog = await openCatalog(path);
    return {
      catalog,
      resources: new ZarrResources(new NativeResourceFiles(this.directory)),
      retainInputs: (input) => this.retain(catalog, input),
      close: () => catalog.close(),
    };
  }

  async read<T>(
    reference: MapRef,
    action: (catalog: SpatialCatalog, input: BackendCompletedInputs) => Promise<T>
  ) {
    const input = await this.inputs.read(reference);
    const catalog = await openCatalog(this.path("completed", input.catalogId), true);
    try {
      await requireCompleted(catalog, input);
      return await action(catalog, input);
    } finally {
      await catalog.close();
    }
  }

  private async retain(catalog: SpatialCatalog, input: Omit<BackendCompletedInputs, "catalogId">) {
    await requireCompleted(catalog, input);
    const catalogId = crypto.randomUUID(),
      path = this.path("completed", catalogId);
    await mkdir(join(this.directory, "completed"), { recursive: true });
    catalog.snapshot(path);
    const retained = { ...input, catalogId };
    try {
      await this.inputs.bind(retained);
      return retained;
    } catch (error) {
      await rm(path, { force: true });
      throw error;
    }
  }

  private path(kind: "working" | "completed", id: string) {
    if (!/^[a-zA-Z0-9_-]+$/.test(id)) throw new Error("Catalog needs a safe identity.");
    return join(this.directory, kind, `${id}.sqlite3`);
  }
}
async function openCatalog(path: string, readOnly = false) {
  const kernel = await GeometryKernel.create();
  let db: NativeCatalogDatabase | undefined;
  try {
    db = new NativeCatalogDatabase(path, readOnly);
    return new SpatialCatalog(db, kernel);
  } catch (error) {
    db?.close();
    kernel.close();
    throw error;
  }
}
async function requireCompleted(
  catalog: SpatialCatalog,
  input: Omit<BackendCompletedInputs, "catalogId">
) {
  const world = await catalog.readWorld(input.worldId);
  if (world.version !== input.revision)
    throw new Error("The geography changed before its inputs were retained.");
  if (world.publication)
    throw new Error("Complete the geography before retaining generation inputs.");
  const worldAreas = (await catalog.readEditor(input.worldId)).areas;
  if (!worldAreas[input.areaId]) throw new Error("Choose an existing mapped area.");
}
