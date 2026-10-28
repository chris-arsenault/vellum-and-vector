import {
  requireThat,
  areaSpace,
  type DomainSnapshot,
  type World,
  type WorkspaceChange,
} from "@atlas/domain";
import { WorkspaceClient } from "./WorkspaceClient";
import { changed } from "./workspaceEvents";

let workspace: WorkspaceClient | undefined;
let ready: Promise<void> | undefined;
const worlds = new Map<string, Pick<World, "id" | "name" | "version">>();

export async function atlasWorkspace() {
  if (!workspace) {
    workspace = new WorkspaceClient(
      new Worker(new URL("./workspace.worker.ts", import.meta.url), { type: "module" })
    );
    ready = workspace.open(`session_${crypto.randomUUID()}`);
  }
  await ready;
  return workspace;
}
export async function registerWorkspaceWorld(snapshot: DomainSnapshot) {
  requireThat(!worlds.has(snapshot.world.id), "existing_world", "This world is already open.");
  const world = await (await atlasWorkspace()).importWorld(snapshot);
  rememberWorld(world);
  return world;
}
export function rememberWorld(world: World, change?: WorkspaceChange | null) {
  worlds.set(world.id, { id: world.id, name: world.name, version: world.version });
  changed(change ?? "world");
}
export function listWorkspaceWorlds() {
  return [...worlds.values()];
}
export async function readEditorWorld(id: string) {
  return (await atlasWorkspace()).readEditor(id);
}
export function workspaceScope(world: World, areaId: string) {
  return { worldId: world.id, areaId, spaceId: areaSpace(world, areaId) };
}
export async function undoWorkspaceWorld(id: string, operationId: string) {
  const change = await (await atlasWorkspace()).undo(id, operationId);
  const world = await readEditorWorld(id);
  rememberWorld(world, change);
  return world;
}
