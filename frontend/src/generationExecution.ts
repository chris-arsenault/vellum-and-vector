import {
  generateAtlas,
  generationPreview,
  generationSnapshot,
  type MapRunnerOptions,
} from "@atlas/generation";
import {
  requireThat,
  type DomainSnapshot,
  type Diagnostic,
  type FeatureWorkspace,
  type NetworkWorkspace,
  type ContourWorkspace,
} from "@atlas/domain";
import type { openNumericalArena, ZarrResources } from "@atlas/storage-browser";
import type { WorkspaceClient } from "./WorkspaceClient";
import type { WorkspaceFields } from "./workspaceFields";
import type {
  GenerationWorkspaceStart,
  GenerationWorkspaceMessage,
} from "./generationWorkspaceProtocol";
import { publishWorkspaceGeneration } from "./generationPublication";
import { transferableBuffers } from "./transferableBuffers";
import { loadGenerationFeatures } from "./generationInputs";

export interface GenerationExecution {
  features: FeatureWorkspace;
  sourceFeatures: FeatureWorkspace;
  networks: NetworkWorkspace;
  sourceNetworks: NetworkWorkspace;
  contours: ContourWorkspace;
  working: Awaited<ReturnType<typeof openNumericalArena>>;
  store: ZarrResources;
  fields: WorkspaceFields;
  workspace: WorkspaceClient;
  cancelled(): boolean;
  send(message: GenerationWorkspaceMessage, transfer?: Transferable[]): void;
}
const yieldControl = () => new Promise<void>((resolve) => setTimeout(resolve, 0));
export async function executeGeneration(
  start: GenerationWorkspaceStart,
  execution: GenerationExecution,
  observers: Pick<MapRunnerOptions, "diagnostic" | "progress">
) {
  const { worldId, input, expectedVersion } = start;
  const source = await execution.workspace.generationSource(worldId, input.areaId);
  requireThat(
    source.world.version === expectedVersion,
    "stale_version",
    "The world changed before generation started."
  );
  await loadGenerationFeatures(
    source,
    execution.workspace,
    execution.sourceFeatures,
    () => requireThat(!execution.cancelled(), "generation_cancelled", "Generation was cancelled."),
    execution.sourceNetworks
  );
  await execution.fields.read(source, {
    scope: source.scope,
    objects: [],
    spatialLayers: [],
    parentHistory: [],
    dependencies: false,
    channels: source.world.fields
      .filter((field) => field.resourceId)
      .map((field) => ({ fieldId: field.id, names: field.channels ?? [] })),
  });
  const result = await generateAtlas(source, input, {
    ...observers,
    numerical: execution.working.arena,
    features: execution.features,
    sourceFeatures: execution.sourceFeatures,
    networks: execution.networks,
    sourceNetworks: execution.sourceNetworks,
    contours: execution.contours,
    cancelled: execution.cancelled,
    yieldControl,
    async saveBoundary(boundary) {
      const grid = generationPreview(boundary.state);
      if (!grid.channels.elevation) return;
      const label =
        boundary.kind === "epoch"
          ? boundary.ancestry.map((epoch) => epoch.id).join(" / ")
          : "Present geography";
      execution.send({ kind: "preview", grid, label }, transferableBuffers(grid));
      await yieldControl();
    },
  });
  observers.progress?.(["finalize"], 0.995, "Publishing completed geography");
  await publishGeneration(start, execution, source, result);
}
async function publishGeneration(
  start: GenerationWorkspaceStart,
  execution: GenerationExecution,
  source: DomainSnapshot,
  result: Awaited<ReturnType<typeof generateAtlas>>
) {
  const { input, operationId } = start;
  const warnings: Diagnostic[] = [];
  const snapshot = generationSnapshot(result, input, operationId, source, warnings);
  const initial =
    source.world.generations.length === 0 && !source.world.areas[input.areaId].parentId;
  const history = [
    ...result.state.history,
    ...(result.state.causes?.length
      ? [{ path: ["present"], ancestry: [], causes: result.state.causes }]
      : []),
  ];
  await publishWorkspaceGeneration(
    execution.workspace,
    execution.store,
    source,
    snapshot,
    operationId,
    initial,
    history,
    (change) =>
      execution.send({ kind: "published", revision: change.revision, change, partial: initial }),
    () => requireThat(!execution.cancelled(), "generation_cancelled", "Generation was cancelled."),
    result.state
  );
  for (const diagnostic of warnings) execution.send({ kind: "diagnostic", diagnostic });
}
