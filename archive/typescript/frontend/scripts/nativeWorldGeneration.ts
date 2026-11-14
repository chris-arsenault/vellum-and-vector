import { resolve } from "node:path";
import type { BlockCache, DomainSnapshot } from "@atlas/domain";
import type { AtlasGenerationInput, MapRunnerOptions } from "@atlas/generation";
import {
  runNativeGeneration,
  type NativeCapturedRecords,
} from "../../packages/server/src/nativeGeneration";

/** Existing workloads use the backend's application adapter with their own local volume. */
export function nativeWorldGeneration(
  source: DomainSnapshot,
  input: AtlasGenerationInput,
  output: string,
  cache: BlockCache,
  observers: Pick<MapRunnerOptions, "progress" | "diagnostic">,
  captured?: NativeCapturedRecords & { directory: string }
) {
  const directory = resolve(output, `native-${crypto.randomUUID()}`);
  return runNativeGeneration(
    source,
    input,
    cache,
    {
      directory,
      resourceRoot: captured?.directory ?? directory,
      executable: resolve(process.env.ATLAS_NATIVE_GENERATOR ?? "../target/debug/atlas_generate"),
      operationId: crypto.randomUUID(),
      cacheBytes: 512 * 1024 * 1024,
      observers,
    },
    captured
  );
}
