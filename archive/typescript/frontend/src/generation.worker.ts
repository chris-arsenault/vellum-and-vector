import { type GenerationDiagnostic } from "@atlas/generation";
import { DomainError, configureSpatial } from "@atlas/domain";
import {
  OpfsStore,
  ZarrResources,
  openBlockCache,
  openGenerationWorkspace,
  GeometryKernel,
  GeosSpatial,
} from "@atlas/storage-browser";
import { WorkspaceClient } from "./WorkspaceClient";
import { WorkspaceFields } from "@atlas/application";
import { executeGeneration } from "./generationExecution";
import { runRustGeneration } from "./rustGeneration";
import { MapAssets } from "@atlas/storage-browser/maps";
import type {
  GenerationWorkspaceStart,
  GenerationWorkspaceMessage,
} from "./generationWorkspaceProtocol";

const send = (message: GenerationWorkspaceMessage, transfer: Transferable[] = []) =>
  self.postMessage(message, { transfer });
let cancelled = false;
const controller = new AbortController();
self.onmessage = async (event: MessageEvent<GenerationWorkspaceStart | { kind: "cancel" }>) => {
  if ("kind" in event.data) {
    cancelled = true;
    controller.abort();
    return;
  }
  const { operationId, port } = event.data;
  const workspace = new WorkspaceClient(port);
  let blocks: Awaited<ReturnType<typeof openBlockCache>> | undefined;
  let fields: WorkspaceFields | undefined;
  let featureWorkspace: Awaited<ReturnType<typeof openGenerationWorkspace>> | undefined;
  let kernel: GeometryKernel | undefined;
  let stage = "Preparing geography";
  const diagnostics: GenerationDiagnostic[] = [];
  let outcome: GenerationWorkspaceMessage = { kind: "completed" };
  try {
    kernel = await GeometryKernel.create();
    configureSpatial((precision) => new GeosSpatial(kernel!, precision));
    blocks = await openBlockCache(`generation_${operationId}`);
    featureWorkspace = await openGenerationWorkspace(`generation_features_${operationId}`);
    const binary = await OpfsStore.open("atlas-resources"),
      store = new ZarrResources(binary);
    fields = new WorkspaceFields(workspace, store, blocks.cache);
    await executeGeneration(
      event.data,
      {
        binary,
        mapAssets: await MapAssets.open(),
        signal: controller.signal,
        blocks,
        store,
        kernel,
        fields,
        workspace,
        features: featureWorkspace.features,
        sourceFeatures: featureWorkspace.sourceFeatures,
        networks: featureWorkspace.networks,
        sourceNetworks: featureWorkspace.sourceNetworks,
        contours: featureWorkspace.contours,
        cancelled: () => cancelled,
        send,
      },
      {
        diagnostic(diagnostic) {
          diagnostics.push(diagnostic);
          send({ kind: "diagnostic", diagnostic });
        },
        progress(path, fraction, message) {
          stage = `${path.join(" / ")}: ${message}`;
          send({ kind: "progress", path, fraction, message });
        },
      },
      // owner-direction(2026-11-12): computation uses one Rust core for native and WASM
      (source, input, id, execution, observers) =>
        runRustGeneration(source, input, id, binary, execution, observers)
    );
  } catch (error) {
    outcome = failed(error, stage, diagnostics);
  } finally {
    try {
      await closeGeneration(fields, featureWorkspace, blocks, kernel);
    } catch (error) {
      if (outcome.kind === "completed")
        outcome = {
          kind: "failed",
          error: `Releasing local storage: ${String(error)}`,
          diagnostics,
        };
    } finally {
      port.close();
    }
  }
  send(outcome);
};
function failed(
  error: unknown,
  stage: string,
  diagnostics: GenerationDiagnostic[]
): GenerationWorkspaceMessage {
  return cancelled
    ? { kind: "cancelled" }
    : {
        kind: "failed",
        error: `${stage}: ${error instanceof Error ? error.message : String(error)}`,
        diagnostics: [...diagnostics, ...errorDiagnostics(error)],
      };
}
async function closeGeneration(
  fields: WorkspaceFields | undefined,
  features: Awaited<ReturnType<typeof openGenerationWorkspace>> | undefined,
  blocks: Awaited<ReturnType<typeof openBlockCache>> | undefined,
  kernel: GeometryKernel | undefined
) {
  try {
    try {
      await fields?.close();
    } finally {
      await features?.close();
    }
  } finally {
    try {
      await blocks?.close();
    } finally {
      configureSpatial();
      kernel?.close();
    }
  }
}
function errorDiagnostics(error: unknown): GenerationDiagnostic[] {
  return error instanceof DomainError && Array.isArray(error.details) ? error.details : [];
}
