import {
  openBlockCache,
  openGenerationWorkspace,
  type BrowserWorkspace,
} from "@atlas/storage-browser";
import type { BlockCache } from "@atlas/domain";
import {
  prepareAtlasGeneration,
  regionalResolution,
  type AtlasGenerationInput,
  isRegionalRefinement,
  prepareRegionalRefinement,
  refinementResolution,
  refinementReads,
} from "@atlas/generation";
import { generationSource } from "./workspaceGeneration";
import { WorkspaceFields } from "./workspaceFields";
import { loadGenerationFeatures } from "./generationInputs";

export async function workspaceGenerationSetup(
  current: Pick<BrowserWorkspace, "catalog" | "resources">,
  worldId: string,
  input: AtlasGenerationInput,
  cache?: BlockCache
) {
  const source = await generationSource(current.catalog, worldId, input.areaId);
  const regional = isRegionalRefinement(source, input.areaId);
  const working = cache ? undefined : await openBlockCache(`setup_${crypto.randomUUID()}`);
  const fields = new WorkspaceFields(current.catalog, current.resources, cache ?? working!.cache);
  let features: Awaited<ReturnType<typeof openGenerationWorkspace>> | undefined;
  try {
    if (!regional) {
      features = await openGenerationWorkspace(`setup_features_${crypto.randomUUID()}`);
      await loadGenerationFeatures(
        source,
        current.catalog,
        features.sourceFeatures,
        undefined,
        features.sourceNetworks
      );
    }
    await fields.read(source, {
      scope: source.scope,
      objects: [],
      spatialLayers: [],
      parentHistory: [],
      dependencies: false,
      channels: regional
        ? refinementReads(source, input.areaId, input.domains.includes("physical"))
        : source.world.fields
            .filter(
              (field) =>
                field.resourceId &&
                (!input.domains.includes("physical") ||
                  field.areaId !== input.areaId ||
                  field.input)
            )
            .map((field) => ({ fieldId: field.id, names: field.channels ?? [] })),
    });
    const prepared = regional
      ? prepareRegionalRefinement(source, input)
      : prepareAtlasGeneration(source, input, features!.sourceFeatures);
    return {
      input: prepared.input,
      diagnostics: prepared.diagnostics,
      resolution: regional
        ? refinementResolution(source, input)
        : regionalResolution(source, input.areaId, input.quality),
    };
  } finally {
    try {
      await fields.close();
    } finally {
      try {
        await features?.close();
      } finally {
        await working?.close();
      }
    }
  }
}
