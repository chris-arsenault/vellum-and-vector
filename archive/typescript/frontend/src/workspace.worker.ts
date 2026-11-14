import {
  openBrowserWorkspace,
  GeometryKernel,
  GeosSpatial,
  openStorageSession,
  openBlockCache,
  collectSavedStorage,
  abandonGenerationStorage,
  readCompletedInputs,
  type BrowserWorkspace,
  type SpatialCatalog,
} from "@atlas/storage-browser";
import { configureSpatial } from "@atlas/domain";
import type {
  CatalogCall,
  WorkspaceOperation,
  WorkspaceRequest,
  WorkspaceReply,
  WorldOperation,
} from "./workspaceProtocol";
import { executeWorkspaceCommand } from "./workspaceCommands";
import { importWorkspace } from "./workspaceImport";
import { workspaceRasters } from "./workspaceRasters";
import { workspaceRasterGeography } from "./workspaceRasterGeography";
import { generationSource } from "@atlas/application";
import { workspaceAnalysis } from "./workspaceAnalysis";
import { workspaceCell } from "./workspaceCell";
import { workspaceGenerationSetup } from "./workspaceGenerationSetup";
import { createRequestScheduler, type Lane } from "./requestScheduler";
import { openMapWorkspace } from "@atlas/storage-browser/maps";
import { operateWorkspaceMap } from "./workspaceMaps";
import { dispatchMapRead } from "@atlas/transport";

let name: string | null = null;
let spatialKernel: GeometryKernel | null = null;
let releaseSession: (() => Promise<void>) | null = null;
const workspaces = new Map<string, BrowserWorkspace>();
const maps = new Map<string, Awaited<ReturnType<typeof openMapWorkspace>>>();
const scheduler = createRequestScheduler();

async function operate(operation: WorkspaceOperation) {
  switch (operation.kind) {
    case "connect":
      operation.port.onmessage = (event: MessageEvent<WorkspaceRequest>) =>
        enqueue("bulk", event.data, operation.port);
      operation.port.start();
      return;
    case "open":
      return open(operation.name);
    case "close":
      return close();
    default:
      if (!name) throw new Error("Open a geographic workspace first.");
      return operateWorld(operation);
  }
}
async function open(session: string) {
  if (name) throw new Error("A workspace is already open.");
  const release = await openStorageSession(collectSavedStorage);
  try {
    spatialKernel = await GeometryKernel.create();
  } catch (error) {
    await release();
    throw error;
  }
  name = session;
  releaseSession = release;
  configureSpatial((precision) => new GeosSpatial(spatialKernel!, precision));
}
async function close() {
  for (const current of maps.values()) await current.close();
  maps.clear();
  for (const current of workspaces.values()) await current.close();
  workspaces.clear();
  name = null;
  configureSpatial();
  spatialKernel?.close();
  spatialKernel = null;
  await releaseSession?.();
  releaseSession = null;
}
async function operateWorld(operation: WorldOperation) {
  const { worldId } = operation;
  if (operation.kind === "readMap") {
    const products = await openWorldMaps(worldId);
    const map = products.catalog.open(operation.call.args[0]);
    if (map.worldId !== worldId) throw new Error("This map belongs to another world.");
    return dispatchMapRead(products.reader, operation.call);
  }
  let current = workspaces.get(worldId);
  if (operation.kind === "openSavedWorld") {
    if (current) await current.restore(operation.root);
    else {
      current = await openBrowserWorkspace(`${name}_${worldId}`, operation.root);
      workspaces.set(worldId, current);
    }
    return current.catalog.readEditor(worldId);
  }
  if (!current) {
    current = await openBrowserWorkspace(`${name}_${worldId}`);
    workspaces.set(worldId, current);
  }
  if (operation.kind === "catalog") return callCatalog(current.catalog, operation);
  if (["mapHead", "mapParent", "completeMap", "publishMap"].includes(operation.kind)) {
    const products = await openWorldMaps(worldId);
    return operateWorkspaceMap(
      current,
      products,
      operation as import("./workspaceMapProtocol").WorkspaceMapOperation
    );
  }
  return lifecycle(current, operation);
}
async function openWorldMaps(worldId: string) {
  let products = maps.get(worldId);
  if (!products) {
    products = await openMapWorkspace(`${name}_${worldId}`);
    maps.set(worldId, products);
  }
  return products;
}
function callCatalog(catalog: SpatialCatalog, call: CatalogCall) {
  const method = catalog[call.method] as (...args: unknown[]) => unknown;
  return method.apply(catalog, call.args);
}
/** World lifecycle beside the catalog: saves, exports, imports and abandoned operations. */
async function lifecycle(current: BrowserWorkspace, operation: WorldOperation) {
  switch (operation.kind) {
    case "saveWorld": {
      const world = await current.catalog.readWorld(operation.worldId);
      return { root: await current.snapshot(), name: world.name, version: world.version };
    }
    case "export":
      return current.export(operation.worldId, operation.areaId);
    case "importWorld":
      return importWorkspace(current, operation.snapshot);
    case "abandonOperation":
      // The host terminated the worker: drop staged batches, then its working files.
      await current.catalog.abandonPublication(operation.operationId);
      await abandonGenerationStorage(operation.operationId);
      return;
    default:
      return execute(current, operation);
  }
}
async function execute(current: BrowserWorkspace, operation: WorldOperation) {
  const { catalog } = current;
  switch (operation.kind) {
    case "readCell": {
      const blocks = await openBlockCache(`cell_${crypto.randomUUID()}`);
      try {
        return await workspaceCell(
          current,
          operation.worldId,
          operation.areaId,
          operation.position,
          blocks.cache
        );
      } finally {
        await blocks.close();
      }
    }
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
    case "executeCommand":
      return executeWorkspaceCommand(
        catalog,
        current.resources,
        operation.input,
        undefined,
        (reference, read) => readCompletedInputs(catalog.generationInputs.read(reference), read)
      );
    default:
      throw new Error(`Unsupported workspace operation: ${(operation as { kind: string }).kind}`);
  }
}
/** Ordering belongs to the owning worker; UI events never mutate a second catalog copy.
 * The editor's own requests run ahead of queued generation and render traffic. */
function enqueue(
  lane: Lane,
  request: WorkspaceRequest,
  target: { postMessage(reply: WorkspaceReply): void }
) {
  scheduler.enqueue(lane, async () => {
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
self.onmessage = (event: MessageEvent<WorkspaceRequest>) =>
  enqueue("interactive", event.data, self);
