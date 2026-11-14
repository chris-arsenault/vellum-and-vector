import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { NativeResourceFiles, nativeGeneration } from "@atlas/engine/native";
import {
  prepareRustGeneration,
  rustApplication,
  rustGenerationSurface,
  type AtlasGenerationInput,
  type MapRunnerOptions,
  type RustCompleted,
} from "@atlas/generation";
import type { DomainSnapshot, BlockCache, FeatureReader, NetworkReader } from "@atlas/domain";
import { FieldWorkingSet, ZarrResources } from "@atlas/storage-browser";

export interface NativeCapturedRecords {
  features: FeatureReader;
  networks: NetworkReader;
}
export interface NativeGenerationOptions {
  executable: string;
  directory: string;
  resourceRoot: string;
  operationId: string;
  cacheBytes: number;
  signal?: AbortSignal;
  observers: Pick<MapRunnerOptions, "progress" | "diagnostic"> & {
    preview?(value: unknown): void | Promise<void>;
  };
}
/** Native computation and immutable resources share one backend volume. */
export async function runNativeGeneration(
  source: DomainSnapshot,
  input: AtlasGenerationInput,
  cache: BlockCache,
  options: NativeGenerationOptions,
  captured?: NativeCapturedRecords
) {
  const { directory, resourceRoot, operationId, signal } = options,
    resources = join(resourceRoot, "resources");
  signal?.throwIfAborted();
  await mkdir(directory, { recursive: true });
  await mkdir(resources, { recursive: true });
  const host = await nativeGeneration(options.executable, {
      resources,
      records: join(directory, "records.sqlite"),
      scratch: join(directory, "work.blocks"),
      cacheBytes: options.cacheBytes,
    }),
    store = new ZarrResources(new NativeResourceFiles(resourceRoot)),
    fields = new FieldWorkingSet(store, cache),
    cancel = () => host.cancel();
  signal?.addEventListener("abort", cancel, { once: true });
  let result: RustCompleted | undefined;
  try {
    signal?.throwIfAborted();
    const records = host.records;
    loadSource(source, records, captured);
    const prepared = prepareRustGeneration(source, input),
      application = rustApplication(prepared, records);
    // owner-direction(2026-11-12): computation uses one Rust core for native and WASM
    result = await host.run<RustCompleted>(
      prepared.request,
      {
        operationId,
        seed: input.seed,
        scope: prepared.source.scope,
        precision: prepared.source.world.reference.precision ?? 1e-6,
        fields: prepared.source.world.fields,
      },
      {
        observe: observer(options.observers, application.diagnostic),
      }
    );
    signal?.throwIfAborted();
    return {
      operationId,
      completed: true,
      ready: { resources: result.resources, geography: result.geography },
      state: application.completed(result, await rustGenerationSurface(fields, result)),
      async close() {
        fields.close();
        await host.close();
      },
    };
  } catch (error) {
    fields.close();
    try {
      await discardOutput(store, result);
    } finally {
      await host.close();
    }
    throw error;
  } finally {
    signal?.removeEventListener("abort", cancel);
  }
}
async function discardOutput(store: ZarrResources, result?: RustCompleted) {
  if (!result) return;
  for (const resource of [...result.resources].reverse()) await store.remove(resource.id);
}
function loadSource(
  source: DomainSnapshot,
  records: Awaited<ReturnType<typeof nativeGeneration>>["records"],
  captured?: NativeCapturedRecords
) {
  for (const feature of captured
    ? captured.features.values()
    : Object.values(source.world.features))
    records.sourceFeatures.put(feature);
  for (const node of captured
    ? captured.networks.nodes()
    : Object.values(source.world.networkNodes ?? {}))
    records.sourceNetworks.putNode(node);
  for (const reach of captured
    ? captured.networks.reaches()
    : Object.values(source.world.networkReaches ?? {}))
    records.sourceNetworks.putReach(reach);
}
function observer(
  observers: NativeGenerationOptions["observers"],
  diagnostic: NonNullable<MapRunnerOptions["diagnostic"]>
) {
  let path = ["prepare"],
    fraction = 0;
  return (kind: string, value: unknown) => {
    if (kind === "progress") {
      const progress = value as { path: string[]; fraction: number; message: string };
      path = progress.path;
      fraction = progress.fraction;
      observers.progress?.(progress.path, progress.fraction, progress.message);
    }
    if (kind === "diagnostic") {
      const entry = value as Parameters<typeof diagnostic>[0];
      diagnostic(entry);
      observers.diagnostic?.(entry);
    }
    if (kind === "workProgress")
      observers.progress?.(path, fraction, (value as { message: string }).message);
    if (kind === "preview") return observers.preview?.(value);
  };
}
