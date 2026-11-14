import { initializeEngine, publish_finished_map } from "@atlas/engine";
import type { FeatureReader, FieldGeography, WorkspaceScope } from "@atlas/domain";
import type { MapPublisher } from "@atlas/context";
import type { MapRef } from "@atlas/map";
import type { BinaryStore } from "./opfsStore";
import type { GeometryKernel } from "./geometryKernel";
import type { MapAssets } from "./mapAssets";
import { blockCacheBudgetBytes } from "./opfsBlockCache";
import { RustNumericalInputs } from "./rustNumericalInputs";
import { rustFeatureReader } from "./rustRecords";
import { rustSpatial } from "./rustSpatial";

export interface MapProducerHost {
  publication: MapPublisher;
  assets: Pick<MapAssets, "producerFiles">;
  binary: BinaryStore;
  kernel: GeometryKernel;
  precision: number;
  features: FeatureReader;
  geography(scope: WorkspaceScope, id: string): Promise<FieldGeography>;
}
/** One coarse Rust operation; TypeScript supplies platform handles and local worker transport. */
export async function publishFinishedMap(
  input: string,
  host: MapProducerHost,
  signal?: AbortSignal
) {
  await initializeEngine();
  const resources = new RustNumericalInputs(host.binary),
    files = host.assets.producerFiles();
  try {
    signal?.throwIfAborted();
    const result = await publish_finished_map(input, blockCacheBudgetBytes, {
      resources,
      features: rustFeatureReader(host.features),
      spatial: rustSpatial(host.kernel, host.precision),
      identity: () => crypto.randomUUID(),
      createFile: files.createFile,
      retainFile: files.retainFile,
      geography: async (scope: string, id: string) =>
        JSON.stringify(await host.geography(JSON.parse(scope) as WorkspaceScope, id)),
      publish: (method: string, args: string) => publish(host.publication, method, args),
      control: {
        cancelled: () => signal?.aborted ?? false,
        progress: () => {},
      },
    });
    return JSON.parse(result) as MapRef;
  } finally {
    resources.close();
    await files.close();
  }
}
async function publish(publisher: MapPublisher, method: string, args: string) {
  if (!["begin", "append", "addLayer", "finish", "discard"].includes(method))
    throw new Error(`Unknown map publication operation: ${method}`);
  const operation = publisher[method as keyof MapPublisher] as (...args: unknown[]) => unknown;
  await operation.apply(publisher, JSON.parse(args) as unknown[]);
}
