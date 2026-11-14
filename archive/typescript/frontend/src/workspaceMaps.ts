import type { BrowserWorkspace } from "@atlas/storage-browser";
import type { openMapWorkspace } from "@atlas/storage-browser/maps";
import type { WorkspaceMapOperation } from "./workspaceMapProtocol";

export type WorkspaceMaps = Pick<
  Awaited<ReturnType<typeof openMapWorkspace>>,
  "catalog" | "publication"
>;

export async function operateWorkspaceMap(
  current: Pick<BrowserWorkspace, "catalog" | "retainInputs">,
  maps: WorkspaceMaps,
  operation: WorkspaceMapOperation
) {
  switch (operation.kind) {
    case "mapHead": {
      const reference = maps.catalog.findHead(operation.mapId);
      if (reference && maps.catalog.open(reference).worldId !== operation.worldId)
        throw new Error("This map belongs to another world.");
      return reference;
    }
    case "mapParent":
      return current.catalog.generationInputs.atVersion(
        operation.worldId,
        operation.areaId,
        operation.revision
      );
    case "completeMap":
      return completeMap(current, maps, operation);
    case "publishMap": {
      const first = operation.args[0];
      const map = "reference" in first ? first : maps.catalog.open(first);
      if (map.worldId !== operation.worldId) throw new Error("Publish a map in its own world.");
      const method = maps.publication[operation.method] as (...args: unknown[]) => void;
      return method.apply(maps.publication, operation.args);
    }
  }
}
async function completeMap(
  current: Pick<BrowserWorkspace, "catalog" | "retainInputs">,
  maps: WorkspaceMaps,
  operation: Extract<WorkspaceMapOperation, { kind: "completeMap" }>
) {
  const { reference, worldId, revision } = operation;
  const map = maps.catalog.open(reference);
  if (map.worldId !== worldId || map.state !== "incomplete")
    throw new Error("Complete a pending map in its own world.");
  await current.retainInputs({ reference, worldId, areaId: reference.mapId, revision });
  try {
    maps.publication.finish(reference);
  } catch (error) {
    current.catalog.generationInputs.unbind(reference);
    throw error;
  }
}
