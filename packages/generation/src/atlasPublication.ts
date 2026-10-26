import { restoreMappedEdits, type Diagnostic, type DomainSnapshot } from "@atlas/domain";
import { atlasParametersSchema } from "./atlasParameters";
import type { AtlasGenerationInput } from "./atlasWorkflow";
import type { CompletedBoundary } from "./process";
import { publishGenerationProducts } from "./publication";

/** Prepare editor geography before its numerical resources leave the generation worker. */
export function generationSnapshot(
  result: CompletedBoundary,
  input: AtlasGenerationInput,
  id: string,
  original?: DomainSnapshot,
  warnings: Diagnostic[] = []
): DomainSnapshot {
  const snapshot = result.state.domain,
    world = snapshot.world;
  world.version++;
  if (original) restoreMappedEdits(snapshot, original);
  publishGenerationProducts(result.state, id, original, warnings);
  world.areas[input.areaId].version = world.version;
  world.generations.push({
    id,
    areaId: input.areaId,
    domains: input.domains,
    quality: input.quality,
    seed: input.seed,
    parameters: atlasParametersSchema.parse(input.parameters ?? {}),
    completedAt: new Date().toISOString(),
    physicalEpochs: structuredClone(world.epochs),
    magicSystems: structuredClone(world.magicSystems ?? []),
    configuration: input.configuration && { ...input.configuration },
  });
  return snapshot;
}
