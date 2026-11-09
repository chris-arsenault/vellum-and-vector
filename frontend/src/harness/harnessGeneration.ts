import {
  areaSpace,
  refinedRegionArea,
  regionRefinementInput,
  spatial,
  type Position,
} from "@atlas/domain";
import {
  atlasParametersSchema,
  type AtlasGenerationInput,
  type MapRunnerOptions,
} from "@atlas/generation";
import {
  SqliteContourWorkspace,
  SqliteFeatureWorkspace,
  SqliteNetworkWorkspace,
  type BrowserWorkspace,
} from "@atlas/storage-browser";
import { blockCacheFixture } from "../../../packages/storage-browser/src/blockCacheFixture";
import {
  sqliteFixture,
  sqliteFixtureMemory,
} from "../../../packages/storage-browser/src/sqliteFixture";
import { executeGeneration, type GenerationExecution } from "../generationExecution";
import type { GenerationWorkspaceMessage } from "../generationWorkspaceProtocol";
import { generationSource } from "../workspaceGeneration";
import { workspaceGenerationSetup } from "../workspaceGenerationSetup";
import { WorkspaceFields } from "../workspaceFields";
import { executeWorkspaceCommand } from "../workspaceCommands";
import { importState } from "../workspaceImport";
import { SnapshotFields } from "../snapshotFields";
import { draftWorldSnapshot, prepareDraft, type GenerationDraft } from "../generationDraft";
import { inheritedGeneration } from "../generationJobs";
import type { WorkspaceClient } from "../WorkspaceClient";
import type { HarnessWorkspace } from "./harnessWorkspace";

export interface NativeMemory {
  geosWasmBytes: number;
  scratchSqlite: ReturnType<typeof sqliteFixtureMemory>;
  catalogSqlite: ReturnType<typeof sqliteFixtureMemory>;
}
/** What a run reports while it goes: the runner's own observers plus the worker's messages. */
export type RunObservers = Pick<MapRunnerOptions, "diagnostic" | "progress" | "inspect"> & {
  message?(message: GenerationWorkspaceMessage): void;
  /** The reader is installed only while generation's scratch resources remain open. */
  nativeMemory?(read: (() => NativeMemory) | undefined): void;
  /** Ends the run at its next step: the observer has what it came for. */
  stop?(): boolean;
};
const asWorkspace = (ws: HarnessWorkspace) => ws as unknown as BrowserWorkspace;

/**
 * One generation request run as the app's generation worker runs it (`executeGeneration`):
 * the same source read, feature load, runner and publication. The app's workspace worker is
 * the harness catalog itself, answering the same calls in process.
 */
export async function runGeneration(
  ws: HarnessWorkspace,
  worldId: string,
  input: AtlasGenerationInput,
  observers: RunObservers = {}
) {
  const scratch = await sqliteFixture(),
    blocks = blockCacheFixture(Infinity),
    fields = new WorkspaceFields(ws.catalog, ws.resources, blocks.cache),
    world = await ws.catalog.readEditor(worldId);
  const workspace = new Proxy(ws.catalog, {
    get(target, key) {
      if (key === "generationSource")
        return (id: string, areaId: string) => generationSource(target, id, areaId);
      const value = Reflect.get(target, key, target);
      return typeof value === "function" ? value.bind(target) : value;
    },
  }) as unknown as WorkspaceClient;
  const execution: GenerationExecution = {
    features: new SqliteFeatureWorkspace(scratch),
    sourceFeatures: new SqliteFeatureWorkspace(scratch, "source_features"),
    networks: new SqliteNetworkWorkspace(scratch),
    sourceNetworks: new SqliteNetworkWorkspace(scratch, "source_networks"),
    contours: new SqliteContourWorkspace(scratch),
    blocks: blocks as unknown as GenerationExecution["blocks"],
    store: ws.resources,
    kernel: ws.kernel,
    fields,
    workspace,
    cancelled: () => observers.stop?.() ?? false,
    send: (message) => observers.message?.(message),
  };
  try {
    observers.nativeMemory?.(() => ({
      geosWasmBytes: ws.kernel.native.Module.HEAPU8.byteLength,
      scratchSqlite: sqliteFixtureMemory(scratch),
      catalogSqlite: sqliteFixtureMemory(ws.db),
    }));
    await executeGeneration(
      {
        worldId,
        input,
        expectedVersion: world.version,
        operationId: crypto.randomUUID(),
        port: undefined as unknown as MessagePort,
      },
      execution,
      observers
    );
  } finally {
    try {
      observers.nativeMemory?.(undefined);
    } finally {
      await fields.close();
      blocks.close();
      scratch.close();
    }
  }
}

/** A new world from a generation draft: installed as the app installs it, then generated. */
export async function generateWorld(
  ws: HarnessWorkspace,
  draft: GenerationDraft,
  observers?: RunObservers
) {
  const snapshot = draftWorldSnapshot(draft);
  // The app's import (importWorkspace), with the harness's block cache in place of OPFS.
  await importState(asWorkspace(ws), new SnapshotFields(), snapshot, undefined, ws.working.cache);
  await runGeneration(ws, snapshot.world.id, prepareDraft(draft).input, observers);
  return { worldId: snapshot.world.id, root: snapshot.scope.areaId };
}

async function command(ws: HarnessWorkspace, worldId: string, kind: string, data: object) {
  const world = await ws.catalog.readEditor(worldId),
    root = Object.values(world.areas).find((area) => !area.parentId)!.id;
  await executeWorkspaceCommand(
    ws.catalog,
    ws.resources,
    {
      scope: { worldId, areaId: root, spaceId: areaSpace(world, root) },
      preview: false,
      command: {
        operationId: crypto.randomUUID(),
        expectedVersion: world.version,
        kind,
        data: data as Record<string, unknown>,
      },
    },
    ws.working.cache
  );
}

/**
 * A region chosen as the app chooses one, the subdivision under a point of the world, made
 * an independent map and refined with the app's regional request and preparation.
 */
export async function refineRegion(
  ws: HarnessWorkspace,
  worldId: string,
  position: Position,
  quality: string,
  observers?: RunObservers,
  domains = ["physical", "magic", "built", "cultural", "political"]
) {
  let world = await ws.catalog.readEditor(worldId);
  const root = Object.values(world.areas).find((area) => !area.parentId)!.id,
    choices = await ws.catalog.regionChoices({
      scope: { worldId, areaId: root, spaceId: areaSpace(world, root) },
      sourceAreaId: root,
      parentId: null,
      editingId: null,
      cuts: [],
      position,
      viewport: spatial.bounds(world.areas[root].footprint),
    });
  if (!choices.candidates.length) throw new Error("No region at that position.");
  const regionId = crypto.randomUUID();
  await command(ws, worldId, "putView", {
    id: regionId,
    name: "Harness region",
    areaId: root,
    layers: [],
    region: { parentId: null, footprint: choices.candidates[0].footprint },
  });
  world = await ws.catalog.readEditor(worldId);
  await command(ws, worldId, "createArea", regionRefinementInput(world, regionId));
  world = await ws.catalog.readEditor(worldId);
  const child = refinedRegionArea(world, regionId)!.id;
  // The app's regional request (RegionalGeneration, startGeneration) with every domain.
  const request: AtlasGenerationInput = {
    areaId: child,
    quality,
    seed: world.seed,
    domains,
    parameters: atlasParametersSchema.parse(inheritedGeneration(world, child)?.parameters ?? {}),
  };
  const prepared = await workspaceGenerationSetup(asWorkspace(ws), worldId, request);
  const errors = prepared.diagnostics.filter((item) => item.severity === "error");
  if (errors.length) throw new Error(errors.map((item) => item.message).join("\n"));
  await runGeneration(ws, worldId, { ...request, ...prepared.input }, observers);
  return { child, regionId };
}
