import {
  openBrowserWorkspace,
  GeometryKernel,
  GeosSpatial,
  openStorageSession,
  collectSavedStorage,
  type BrowserWorkspace,
} from "@atlas/storage-browser";
import { configureSpatial } from "@atlas/domain";
import type { WorkspaceOperation, WorkspaceRequest, WorkspaceReply } from "./workspaceProtocol";
import { executeWorkspaceCommand } from "./workspaceCommands";
import { importWorkspace, importLegacyWorld } from "./workspaceImport";
import { workspaceRasters } from "./workspaceRasters";
import { workspaceRasterGeography } from "./workspaceRasterGeography";
import { generationSource } from "./workspaceGeneration";
import { operationWorld } from "./workspaceRouting";
import { workspaceAnalysis } from "./workspaceAnalysis";
import { workspaceGenerationSetup } from "./workspaceGenerationSetup";

let name: string | null = null;
let spatialKernel: GeometryKernel | null = null;
let releaseSession: (() => Promise<void>) | null = null;
const workspaces = new Map<string, BrowserWorkspace>();
async function operate(operation: WorkspaceOperation) {
  if (operation.kind === "connect") {
    operation.port.onmessage = (event: MessageEvent<WorkspaceRequest>) =>
      enqueue(event.data, operation.port);
    operation.port.start();
    return;
  }
  if (operation.kind === "open") {
    if (name) throw new Error("A workspace is already open.");
    const release = await openStorageSession(collectSavedStorage);
    try {
      spatialKernel = await GeometryKernel.create();
    } catch (error) {
      await release();
      throw error;
    }
    name = operation.name;
    releaseSession = release;
    configureSpatial((precision) => new GeosSpatial(spatialKernel!, precision));
    return;
  }
  if (!name) throw new Error("Open a geographic workspace first.");
  if (operation.kind === "close") {
    for (const current of workspaces.values()) await current.close();
    workspaces.clear();
    name = null;
    configureSpatial();
    spatialKernel?.close();
    spatialKernel = null;
    await releaseSession?.();
    releaseSession = null;
    return;
  }
  return operateWorld(operation);
}
async function operateWorld(operation: WorkspaceOperation) {
  const worldId = operationWorld(operation);
  let current = workspaces.get(worldId);
  if (operation.kind === "openLegacyWorld") {
    const imported = await openBrowserWorkspace(`${name}_${crypto.randomUUID()}`);
    try {
      const world = await importLegacyWorld(imported, operation.saved);
      await current?.close();
      workspaces.set(worldId, imported);
      return world;
    } catch (error) {
      await imported.close();
      throw error;
    }
  }
  if (operation.kind === "openSavedWorld") {
    if (current) await current.restore(operation.root);
    else {
      const restored = await openBrowserWorkspace(`${name}_${worldId}`, operation.root);
      current = restored;
      workspaces.set(worldId, current);
    }
    return current.catalog.readEditor(worldId);
  }
  if (!current) {
    current = await openBrowserWorkspace(`${name}_${worldId}`);
    workspaces.set(worldId, current);
  }
  if (operation.kind === "saveWorld") {
    const world = await current.catalog.readWorld(worldId);
    return { root: await current.snapshot(), name: world.name, version: world.version };
  }
  return dispatch(current, operation);
}
async function dispatch(current: BrowserWorkspace, operation: WorkspaceOperation) {
  const { catalog } = current;
  switch (operation.kind) {
    case "readEditor":
      return catalog.readEditor(operation.worldId);
    case "readRegistry":
      return catalog.readRegistry(operation.input);
    case "readSettlement":
      return catalog.readSettlement(operation.scope, operation.featureId);
    case "readConnections":
      return catalog.readConnections(operation.scope);
    case "readLayerPresentation":
      return catalog.readLayerPresentation(operation.worldId, operation.layerId);
    case "readFeature":
      return catalog.readFeature(operation.scope, operation.featureId);
    default:
      return execute(current, operation);
  }
}
async function execute(current: BrowserWorkspace, operation: WorkspaceOperation) {
  const { catalog } = current;
  switch (operation.kind) {
    case "readRasters":
      return workspaceRasters(
        current,
        operation.worldId,
        operation.areaId,
        operation.extent,
        operation.tolerance
      );
    case "readRasterGeography":
      return workspaceRasterGeography(catalog, operation.reference);
    case "generationSource":
      return generationSource(catalog, operation.worldId, operation.areaId);
    case "generationSetup":
      return workspaceGenerationSetup(current, operation.worldId, operation.input);
    case "analyze":
      return workspaceAnalysis(current, operation.worldId, operation.input);
    case "export":
      return current.export(operation.worldId, operation.areaId);
    case "importWorld":
      return importWorkspace(current, operation.snapshot);
    default:
      return queryCatalog(current, operation);
  }
}
async function queryCatalog(current: BrowserWorkspace, operation: WorkspaceOperation) {
  const { catalog } = current;
  switch (operation.kind) {
    case "readWorld":
      return catalog.readWorld(operation.worldId);
    case "readRecords":
      return catalog.readRecords(operation.scope, operation.recordKind, operation.ids);
    case "readFeatures":
      return catalog.readFeatures(operation.query);
    case "readDisplay":
      return catalog.readDisplay(operation.query, operation.tolerance);
    case "readAuthoring":
      return catalog.readAuthoring(operation.input);
    case "readAuthoringPage":
      return catalog.readAuthoringPage(operation.input, operation.after, operation.limit);
    case "readFieldGeography":
      return catalog.readFieldGeography(operation.scope, operation.resourceId);
    case "regionChoices":
      return catalog.regionChoices(operation.query);
    case "drawRegion":
      return catalog.drawRegion(operation.input);
    default:
      return history(current, operation);
  }
}
async function history(current: BrowserWorkspace, operation: WorkspaceOperation) {
  const { catalog } = current;
  switch (operation.kind) {
    case "readHistory":
      return catalog.readHistory(operation.worldId, operation.before, operation.limit);
    case "readCauses":
      return catalog.readCauses(operation.worldId, operation.areaId);
    default:
      return mutate(current, operation);
  }
}
async function mutate(current: BrowserWorkspace, operation: WorkspaceOperation) {
  const { catalog } = current;
  switch (operation.kind) {
    case "createWorld":
      return catalog.createWorld(operation.world);
    case "commit":
      return catalog.commit(operation.changes);
    case "beginPublication":
      return catalog.beginPublication(operation.input);
    case "appendPublication":
      return catalog.appendPublication(operation.token, operation.changes);
    case "finishPublication":
      return catalog.finishPublication(operation.token);
    case "discardPublication":
      return catalog.discardPublication(operation.token);
    case "executeCommand":
      return executeWorkspaceCommand(catalog, current.resources, operation.input);
    case "undo":
      return catalog.undo(operation.worldId, operation.operationId);
    default:
      throw new Error(`Unsupported workspace operation: ${operation.kind}`);
  }
}
// Ordering belongs to the owning worker; UI events never mutate a second catalog copy.
let pending = Promise.resolve();
function enqueue(request: WorkspaceRequest, target: { postMessage(reply: WorkspaceReply): void }) {
  pending = pending.then(async () => {
    const { id, operation } = request;
    let reply: WorkspaceReply;
    try {
      reply = { id, value: await operate(operation) };
    } catch (error) {
      reply = { id, error: error instanceof Error ? error.message : String(error) };
    }
    target.postMessage(reply);
  });
}
self.onmessage = (event: MessageEvent<WorkspaceRequest>) => enqueue(event.data, self);
