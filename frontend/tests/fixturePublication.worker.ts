import { OpfsStore, ZarrResources } from "@atlas/storage-browser";
import { attachGrid, type DomainSnapshot, type GridArrays } from "@atlas/domain";
import { WorkspaceClient } from "../src/WorkspaceClient";
import { publishWorkspaceGeneration } from "../src/generationPublication";
import { openSpatialRuntime } from "../src/spatialRuntime";

/** Test geography enters through the same immutable resources and catalog commits as generation. */
self.onmessage = async (
  event: MessageEvent<{
    original: DomainSnapshot;
    snapshot: DomainSnapshot;
    operationId: string;
    port: MessagePort;
  }>
) => {
  // Grids cross the port as plain arrays; attach them to this worker's cache.
  const attached = (value: DomainSnapshot): DomainSnapshot => ({
    ...value,
    numerical: Object.fromEntries(
      Object.entries(value.numerical).map(([id, grid]) => [
        id,
        attachGrid(grid as unknown as GridArrays) as DomainSnapshot["numerical"][string],
      ])
    ),
  });
  const { operationId, port } = event.data,
    original = attached(event.data.original),
    snapshot = attached(event.data.snapshot);
  const closeSpatial = await openSpatialRuntime();
  try {
    const workspace = new WorkspaceClient(port);
    const resources = new ZarrResources(await OpfsStore.open("atlas-resources"));
    const initial =
      !original.world.generations.length && !original.world.areas[original.scope.areaId].parentId;
    await publishWorkspaceGeneration(
      workspace,
      resources,
      original,
      snapshot,
      operationId,
      initial,
      [],
      (change) =>
        self.postMessage({
          kind: "published",
          revision: change.revision,
          change,
          partial: initial,
        })
    );
    self.postMessage({ kind: "completed" });
  } catch (error) {
    self.postMessage({
      kind: "failed",
      error: error instanceof Error ? error.message : String(error),
    });
  } finally {
    closeSpatial();
    port.close();
  }
};
