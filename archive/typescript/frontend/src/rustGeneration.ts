import {
  prepareRustGeneration,
  rustApplication,
  rustGenerationSurface,
  type AtlasGenerationInput,
  type GenerationDiagnostic,
  type MapRunnerOptions,
  type RustCompleted,
} from "@atlas/generation";
import { generate_map, initializeEngine } from "@atlas/engine";
import type { DomainSnapshot } from "@atlas/domain";
import {
  blockCacheBudgetBytes,
  FieldWorkingSet,
  openGenerationScratch,
  RustNumericalInputs,
  rustFeatureReader,
  rustFeatureWorkspace,
  rustNetworkReader,
  rustNetworkWorkspace,
  rustResourceOutput,
  rustSpatial,
  type BinaryStore,
} from "@atlas/storage-browser";
import type { GenerationExecution } from "./generationExecution";
import { rustGenerationPreview, type RustPreview } from "./rustGenerationPreview";
import { transferableBuffers } from "./transferableBuffers";

type Observers = Pick<MapRunnerOptions, "progress" | "diagnostic">;
type Host = Pick<
  GenerationExecution,
  | "features"
  | "sourceFeatures"
  | "networks"
  | "sourceNetworks"
  | "kernel"
  | "store"
  | "cancelled"
  | "send"
> & { blocks: Pick<GenerationExecution["blocks"], "cache"> };
type Prepared = ReturnType<typeof prepareRustGeneration>;
const yieldControl = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

/** Both immutable inputs and completed output stay in this worker's local resource store. */
export async function runRustGeneration(
  source: DomainSnapshot,
  input: AtlasGenerationInput,
  operationId: string,
  binary: BinaryStore,
  execution: Host,
  observers: Observers,
  openScratch = openGenerationScratch
) {
  await initializeEngine();
  const prepared = prepareRustGeneration(source, input),
    application = rustApplication(prepared, execution),
    resources = new RustNumericalInputs(binary),
    fields = new FieldWorkingSet(execution.store, execution.blocks.cache);
  let result: RustCompleted | undefined;
  try {
    const scratch = await openScratch(`rust_generation_${operationId}`);
    try {
      await initializeEngine();
      result = JSON.parse(
        await generate_map(
          JSON.stringify(prepared.request),
          JSON.stringify({
            operationId,
            seed: input.seed,
            scope: prepared.source.scope,
            precision: prepared.source.world.reference.precision ?? 1e-6,
            fields: prepared.source.world.fields,
          }),
          blockCacheBudgetBytes,
          {
            scratch: scratch.access,
            resources,
            sink: rustResourceOutput(binary),
            spatial: rustSpatial(
              execution.kernel,
              prepared.source.world.reference.precision ?? 1e-6
            ),
            features: rustFeatureWorkspace(execution.features),
            sourceFeatures: rustFeatureReader(execution.sourceFeatures),
            networks: rustNetworkWorkspace(execution.networks),
            sourceNetworks: rustNetworkReader(execution.sourceNetworks),
            ...observations(prepared, execution, {
              ...observers,
              diagnostic(diagnostic) {
                application.diagnostic(diagnostic);
                observers.diagnostic?.(diagnostic);
              },
            }),
          }
        )
      ) as RustCompleted;
    } finally {
      await scratch.close();
    }
    const surface = await rustGenerationSurface(fields, result);
    return {
      operationId,
      completed: true,
      state: application.completed(result, surface),
      ready: { resources: result.resources, geography: result.geography },
      close: () => fields.close(),
    };
  } catch (error) {
    fields.close();
    if (result)
      for (const resource of [...result.resources].reverse())
        await execution.store.remove(resource.id);
    throw error;
  } finally {
    resources.close();
  }
}
function observations(prepared: Prepared, execution: Host, observers: Observers) {
  let progress = { path: ["prepare"], fraction: 0, message: "Preparing geography" };
  return {
    control: {
      cancelled: execution.cancelled,
      yieldControl,
      progress(json: string) {
        progress = JSON.parse(json) as typeof progress;
        observers.progress?.(progress.path, progress.fraction, progress.message);
      },
    },
    workProgress(_fraction: number, message: string) {
      observers.progress?.(progress.path, progress.fraction, message);
    },
    diagnostic(json: string) {
      observers.diagnostic?.(JSON.parse(json) as GenerationDiagnostic);
    },
    async preview(json: string) {
      const preview = rustGenerationPreview(JSON.parse(json) as RustPreview, prepared.source.scope);
      execution.send({ kind: "preview", ...preview }, transferableBuffers(preview.grid));
      await yieldControl();
    },
  };
}
