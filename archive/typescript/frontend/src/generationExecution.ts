import {
  generationSnapshot,
  type MapRunnerOptions,
  type GenerationState,
  type AtlasGenerationInput,
} from "@atlas/generation";
import {
  requireThat,
  spatial,
  type DomainSnapshot,
  type Diagnostic,
  type FeatureWorkspace,
  type NetworkWorkspace,
  type ContourWorkspace,
} from "@atlas/domain";
import {
  encodeRecordGeometry,
  type GeometryKernel,
  type openBlockCache,
  type ZarrResources,
  type BinaryStore,
} from "@atlas/storage-browser";
import type { WorkspaceClient } from "./WorkspaceClient";
import type { WorkspaceFields } from "@atlas/application";
import type {
  GenerationWorkspaceStart,
  GenerationWorkspaceMessage,
} from "./generationWorkspaceProtocol";
import { publishWorkspaceGeneration } from "./generationPublication";
import type { ReadyGeography } from "@atlas/application";
import { loadGenerationFeatures } from "@atlas/application";
import { publishGeneratedMap } from "./generationMapPublication";
import type { MapAssets } from "@atlas/storage-browser/maps";

export interface GenerationExecution {
  mapAssets: Pick<MapAssets, "producerFiles">;
  binary: BinaryStore;
  features: FeatureWorkspace;
  sourceFeatures: FeatureWorkspace;
  networks: NetworkWorkspace;
  sourceNetworks: NetworkWorkspace;
  contours: ContourWorkspace;
  /** The block cache every coverage of the run pages through, and its scratch file. */
  blocks: Awaited<ReturnType<typeof openBlockCache>>;
  store: ZarrResources;
  /** The worker's geometry kernel, which encodes published records once. */
  kernel: GeometryKernel;
  fields: WorkspaceFields;
  workspace: WorkspaceClient;
  cancelled(): boolean;
  signal: AbortSignal;
  send(message: GenerationWorkspaceMessage, transfer?: Transferable[]): void;
}
export type GenerationObservers = Pick<
  MapRunnerOptions,
  "diagnostic" | "progress" | "inspect" | "boundary" | "resume"
>;
export interface ProducedGeneration {
  state: GenerationState;
  completed?: boolean;
  ready?: ReadyGeography;
  close(): void | Promise<void>;
}
export type GenerationProducer = (
  source: DomainSnapshot,
  input: AtlasGenerationInput,
  operationId: string,
  execution: GenerationExecution,
  observers: GenerationObservers
) => Promise<ProducedGeneration>;
export async function executeGeneration(
  start: GenerationWorkspaceStart,
  execution: GenerationExecution,
  observers: GenerationObservers,
  produce: GenerationProducer
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
  const result = await produce(source, input, start.operationId, execution, observers);
  try {
    await publishGeneration(start, execution, source, result, observers);
  } finally {
    await result.close();
  }
}
async function publishGeneration(
  start: GenerationWorkspaceStart,
  execution: GenerationExecution,
  source: DomainSnapshot,
  result: ProducedGeneration,
  observers: GenerationObservers
) {
  const { input, operationId } = start;
  const warnings: Diagnostic[] = [];
  const snapshot = await completedSnapshot(start, execution, source, result, warnings, observers),
    features = result.state.features!;
  const initial =
    source.world.generations.length === 0 && !source.world.areas[input.areaId].parentId;
  const history = [
    ...result.state.history,
    ...(result.state.causes?.length
      ? [{ path: ["present"], ancestry: [], causes: result.state.causes }]
      : []),
  ];
  let revision = source.world.version;
  await publishWorkspaceGeneration(
    execution.workspace,
    execution.store,
    source,
    snapshot,
    operationId,
    initial,
    history,
    (change) => {
      revision = change.revision;
      execution.send({ kind: "published", revision, change, partial: initial });
    },
    () => requireThat(!execution.cancelled(), "generation_cancelled", "Generation was cancelled."),
    {
      ready: result.ready,
      features,
      sourceFeatures: result.state.sourceFeatures,
      networks: result.state.networks,
      sourceNetworks: result.state.sourceNetworks,
      // The worker holds the kernel; records reach the catalog already encoded.
      encode: (record) =>
        encodeRecordGeometry(
          record,
          execution.kernel,
          source.world.reference.precision ?? spatial.precision
        ),
    }
  );
  const map = await publishGeneratedMap(execution, snapshot, features, revision, execution.signal);
  execution.send({ kind: "mapPublished", reference: map });
  for (const diagnostic of warnings) execution.send({ kind: "diagnostic", diagnostic });
}
async function completedSnapshot(
  start: GenerationWorkspaceStart,
  execution: GenerationExecution,
  source: DomainSnapshot,
  result: ProducedGeneration,
  warnings: Diagnostic[],
  observers: GenerationObservers
) {
  try {
    if (result.completed) return result.state.domain;
    requireThat(
      result.state.features,
      "generation_features",
      "Generation retains its feature workspace through publication."
    );
    observers.progress?.(["finalize"], 0.995, "Publishing completed geography");
    return generationSnapshot(result, start.input, start.operationId, source, warnings);
  } catch (error) {
    // No catalog reference exists yet; publication takes ownership after this boundary.
    for (const resource of [...(result.ready?.resources ?? [])].reverse())
      await execution.store.remove(resource.id);
    throw error;
  }
}
