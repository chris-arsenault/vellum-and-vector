import type { WorkspaceOperation } from "./workspaceProtocol";

export function operationWorld(operation: WorkspaceOperation): string {
  if ("worldId" in operation) return operation.worldId;
  if ("scope" in operation) return operation.scope.worldId;
  if ("query" in operation) return operation.query.scope.worldId;
  if (operation.kind === "importWorld") return operation.snapshot.world.id;
  if (operation.kind === "createWorld") return operation.world.id;
  if (operation.kind === "commit") return operation.changes.worldId;
  if ("input" in operation) return inputWorld(operation);
  throw new Error("This operation needs a world identity.");
}
function inputWorld(operation: Extract<WorkspaceOperation, { input: unknown }>) {
  if (operation.kind === "readRegistry") return operation.input.worldId;
  if (operation.kind === "drawRegion") return operation.input.query.scope.worldId;
  if (
    operation.kind === "readAuthoring" ||
    operation.kind === "readAuthoringPage" ||
    operation.kind === "executeCommand"
  )
    return operation.input.scope.worldId;
  throw new Error("This operation needs a world identity.");
}
