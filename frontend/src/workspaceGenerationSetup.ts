import {
  openBlockCache,
  openGenerationWorkspace,
  type BrowserWorkspace,
} from "@atlas/storage-browser";
import {
  prepareAtlasGeneration,
  regionalResolution,
  type AtlasGenerationInput,
  isRegionalRefinement,
  prepareRegionalRefinement,
  refinementResolution,
} from "@atlas/generation";
import { generationSource } from "./workspaceGeneration";
import { WorkspaceFields } from "./workspaceFields";
import { loadGenerationFeatures } from "./generationInputs";

export async function workspaceGenerationSetup(
  current: BrowserWorkspace,
  worldId: string,
  input: AtlasGenerationInput
) {
  const source = await generationSource(current.catalog, worldId, input.areaId);
  if (isRegionalRefinement(source, input.areaId)) {
    const prepared = prepareRegionalRefinement(source, input);
    return {
      input: prepared.input,
      diagnostics: prepared.diagnostics,
      resolution: refinementResolution(source, input),
    };
  }
  const working = await openBlockCache(`setup_${crypto.randomUUID()}`);
  const fields = new WorkspaceFields(current.catalog, current.resources, working.cache);
  let features: Awaited<ReturnType<typeof openGenerationWorkspace>> | undefined;
  try {
    features = await openGenerationWorkspace(`setup_features_${crypto.randomUUID()}`);
    await loadGenerationFeatures(
      source,
      current.catalog,
      features.sourceFeatures,
      undefined,
      features.sourceNetworks
    );
    await fields.read(source, {
      scope: source.scope,
      objects: [],
      spatialLayers: [],
      parentHistory: [],
      dependencies: false,
      channels: source.world.fields
        .filter(
          (field) =>
            field.resourceId &&
            (!input.domains.includes("physical") || field.areaId !== input.areaId || field.input)
        )
        .map((field) => ({ fieldId: field.id, names: field.channels ?? [] })),
    });
    const prepared = prepareAtlasGeneration(source, input, features.sourceFeatures);
    return {
      input: prepared.input,
      diagnostics: prepared.diagnostics,
      resolution: regionalResolution(source, input.areaId, input.quality),
    };
  } finally {
    try {
      await fields.close();
    } finally {
      try {
        await features?.close();
      } finally {
        await working.close();
      }
    }
  }
}
