import { BrowserJob } from "@atlas/engine";
import type { GenerationEvent, GenerationStatus } from "@atlas/context";
import type { MapRef } from "@atlas/map";
import type { openMapWorkspace } from "./mapWorkspace";
import { openCatalogPool, removeCatalogPool } from "./catalogPool";
import { GeometryKernel } from "./geometryKernel";
import { OpfsStore } from "./opfsStore";
import { openGenerationScratch, blockCacheBudgetBytes } from "./opfsBlockCache";
import { RustNumericalInputs } from "./rustNumericalInputs";
import { rustResourceOutput } from "./rustResourceOutput";
import { rustSpatial } from "./rustSpatial";
import { sqlDriver } from "./rustMapStore";
import type { Database } from "./catalogDatabase";

export interface BrowserJobCallbacks {
  signal: AbortSignal;
  status(change: Partial<GenerationStatus>): void;
  event(event: GenerationEvent): void;
}
type Maps = Awaited<ReturnType<typeof openMapWorkspace>>;
export async function readBrowserGeneration(
  maps: Maps,
  privateDatabase: Database,
  request: { configuration: MapRef } | { review: unknown }
): Promise<unknown> {
  const operation = crypto.randomUUID();
  const poolName = `review_${operation.replaceAll("-", "_")}`;
  const pool = await openCatalogPool(poolName);
  const records = new pool.OpfsSAHPoolDb("/records.sqlite3");
  try {
    const job = new BrowserJob(sqlDriver(privateDatabase), sqlDriver(records), maps.catalog.rust);
    try {
      if ("configuration" in request)
        return JSON.parse(job.configuration(JSON.stringify(request.configuration)));
      const kernel = await GeometryKernel.create();
      try {
        const resources = new RustNumericalInputs(
          await OpfsStore.open("atlas-generation-resources")
        );
        try {
          return JSON.parse(
            await job.review(JSON.stringify(request.review), operation, {
              resources,
              spatial: rustSpatial(kernel, 1e-6),
            })
          );
        } finally {
          resources.close();
        }
      } finally {
        kernel.close();
      }
    } finally {
      job.free();
    }
  } finally {
    records.close();
    await removeCatalogPool(poolName);
  }
}
export async function runBrowserGeneration(
  maps: Maps,
  privateDatabase: Database,
  action: unknown,
  jobId: string,
  callbacks: BrowserJobCallbacks
): Promise<MapRef> {
  const poolName = `generation_${jobId.replaceAll("-", "_")}`;
  const pool = await openCatalogPool(poolName);
  let records: Database | undefined;
  let kernel: GeometryKernel | undefined;
  let resources: RustNumericalInputs | undefined;
  let files: ReturnType<Maps["assets"]["producerFiles"]> | undefined;
  let scratch: Awaited<ReturnType<typeof openGenerationScratch>> | undefined;
  let job: BrowserJob | undefined;
  try {
    records = new pool.OpfsSAHPoolDb("/records.sqlite3");
    kernel = await GeometryKernel.create();
    const binary = await OpfsStore.open("atlas-generation-resources");
    resources = new RustNumericalInputs(binary);
    files = maps.assets.producerFiles();
    scratch = await openGenerationScratch(`generation_${jobId}`);
    job = new BrowserJob(sqlDriver(privateDatabase), sqlDriver(records), maps.catalog.rust);
    const reference = await job.run(
      JSON.stringify({
        action,
        operation: jobId,
        revision: crypto.randomUUID(),
        cacheBytes: blockCacheBudgetBytes,
      }),
      {
        scratch: scratch.access,
        resources,
        sink: rustResourceOutput(binary),
        spatial: rustSpatial(kernel, 1e-6),
        ...observations(jobId, callbacks),
      },
      { ...files, identity: () => crypto.randomUUID() }
    );
    return JSON.parse(reference) as MapRef;
  } finally {
    job?.free();
    resources?.close();
    await scratch?.close();
    await files?.close();
    kernel?.close();
    records?.close();
    await removeCatalogPool(poolName);
  }
}
function observations(jobId: string, callbacks: BrowserJobCallbacks) {
  let epoch = 0;
  return {
    mapChanged(reference: string) {
      callbacks.event({ kind: "published", reference: JSON.parse(reference) as MapRef });
    },
    control: {
      cancelled: () => callbacks.signal.aborted,
      progress(json: string) {
        const progress = JSON.parse(json) as { message: string; fraction: number };
        callbacks.status({ step: progress.message, progress: progress.fraction });
      },
    },
    workProgress(progress: number, step: string) {
      callbacks.status({ step, progress });
    },
    diagnostic(json: string) {
      callbacks.status({ message: json });
    },
    async preview(json: string) {
      callbacks.event({
        kind: "preview",
        jobId,
        epoch: epoch++,
        map: {
          mediaType: "application/vnd.atlas.preview+json",
          bytes: new TextEncoder().encode(json),
        },
      });
    },
  };
}
