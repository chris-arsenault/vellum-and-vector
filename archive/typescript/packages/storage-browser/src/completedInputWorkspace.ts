import type { CompletedInputs } from "./generationInputs";
import { readSavedCatalog } from "./catalogPool";
import { SpatialCatalog } from "./spatialCatalog";
import { GeometryKernel } from "./geometryKernel";
import { requireThat } from "@atlas/domain";

/** This callback runs on the generation host. It cannot escape into a map reader. */
export function readCompletedInputs<T>(
  input: CompletedInputs,
  read: (catalog: SpatialCatalog, input: CompletedInputs) => Promise<T>
) {
  return readSavedCatalog(input.root, async (pool) => {
    requireThat(
      pool.getFileNames().includes(input.root.path),
      "missing_generation_inputs",
      "The completed generation catalog is missing."
    );
    const kernel = await GeometryKernel.create();
    let catalog: SpatialCatalog;
    try {
      catalog = new SpatialCatalog(new pool.OpfsSAHPoolDb(input.root.path), kernel);
    } catch (error) {
      kernel.close();
      throw error;
    }
    try {
      const world = await catalog.readWorld(input.worldId);
      requireThat(
        world.version === input.revision,
        "generation_input_revision",
        "The completed catalog does not match the selected map revision."
      );
      return await read(catalog, input);
    } finally {
      await catalog.close();
    }
  });
}
