import { requireThat, type DomainSnapshot, type Diagnostic } from "@atlas/domain";
import type { AtlasGenerationInput } from "../atlasWorkflow";
import type { CompletedBoundary } from "../process";
import type { MapRunnerOptions } from "../mapRunner";
import { initializeFeatureWorkspace } from "../generationFeatures";
import { initializeNetworkWorkspace } from "../generationNetworks";
import { planHash } from "../planHash";
import { createRegionalState, refinementInputFields, refinementResolution } from "./capture";
import { clearRegionalProducts } from "./extraction/features";
import { regionalPublications } from "./extraction/publication";
import { regionalSchedule } from "./schedule";
import type { RegionalState } from "./state";

type Options = Omit<MapRunnerOptions, "seed" | "seedScope">;

export function prepareRegionalRefinement(source: DomainSnapshot, input: AtlasGenerationInput) {
  const diagnostics: Diagnostic[] = [],
    area = source.world.areas[input.areaId];
  requireThat(area?.map, "regional_map", "Refinement needs an independent captured map.");
  refinementResolution(source, input);
  if (!refinementInputFields(source, input.areaId).some((f) => f.channels?.includes("elevation")))
    diagnostics.push({
      code: "regional_parent",
      severity: "error",
      invocation: null,
      resource: input.areaId,
      message: "Capture parent terrain before refining this map.",
    });
  const configuration = {
    id: "regional-bidirectional-refinement",
    version: 2,
    parameters: {},
    sequence: regionalSchedule(input.domains).map((step) => ({
      kind: "process" as const,
      id: `refinement.${step.id}`,
      process: `refinement.${step.id}`,
      version: "2",
    })),
  };
  return { source, input: { ...input, configuration }, diagnostics };
}

/** Run the fixed schedule on this map's captured context and publish its geography once. */
export async function refineRegionalMap(
  source: DomainSnapshot,
  input: AtlasGenerationInput,
  options: Options = {}
): Promise<CompletedBoundary> {
  const prepared = prepareRegionalRefinement(source, input);
  requireThat(
    !prepared.diagnostics.length,
    "generation_configuration",
    prepared.diagnostics.map((d) => d.message).join("\n")
  );
  const check = () =>
    requireThat(!options.cancelled?.(), "generation_cancelled", "Refinement was cancelled.");
  check();
  options.progress?.(["refinement", "sample"], 0, "Sampling captured regional surface");
  const state = createRegionalState(source, prepared.input, options.cache);
  prepareStores(state, options);
  clearRegionalProducts(state);
  const steps = regionalSchedule(input.domains);
  for (const [index, step] of steps.entries()) {
    check();
    await options.yieldControl?.();
    options.progress?.(["refinement", step.id], (index + 1) / (steps.length + 1), step.message);
    step.run(state);
  }
  check();
  const result: CompletedBoundary = {
    kind: "final",
    ancestry: [],
    configurationHash: await planHash(prepared.input.configuration!),
    state: {
      domain: state.domain,
      surface: state.surface,
      facts: new Set(Object.keys(state.surface.channels)),
      history: [],
      publications: regionalPublications(state),
      features: state.features,
      sourceFeatures: state.sourceFeatures,
      networks: state.networks,
      sourceNetworks: state.sourceNetworks,
    },
  };
  releaseWorkingState(state);
  await options.saveBoundary?.(result);
  return result;
}

function releaseWorkingState(state: RegionalState) {
  const coverage = state.surface.coverage;
  coverage.release(state.inheritedHeight);
  if (state.captured) for (const band of Object.values(state.captured)) coverage.release(band);
  if (state.drainage) {
    coverage.release(state.drainage.receiver);
    coverage.release(state.drainage.order);
  }
  for (const band of Object.values(state.natural)) coverage.release(band);
  for (const band of state.magic?.inherited.values() ?? []) coverage.release(band);
}

function prepareStores(state: RegionalState, options: Options) {
  initializeFeatureWorkspace(state, options.features);
  state.sourceFeatures = options.sourceFeatures;
  state.sourceNetworks = options.sourceNetworks;
  state.contours = options.contours;
  if (options.sourceFeatures)
    for (const f of options.sourceFeatures.values({ areaId: state.input.areaId })) {
      if (state.features) state.features.put(structuredClone(f));
      else state.domain.world.features[f.id] = structuredClone(f);
    }
  initializeNetworkWorkspace(state, options.networks);
}
