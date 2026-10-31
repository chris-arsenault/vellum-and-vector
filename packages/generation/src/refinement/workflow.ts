import { requireThat, type DomainSnapshot, type Diagnostic } from "@atlas/domain";
import type { AtlasGenerationInput } from "../atlasWorkflow";
import type { CompletedBoundary } from "../process";
import type { MapRunnerOptions } from "../mapRunner";
import { initializeFeatureWorkspace } from "../generationFeatures";
import { initializeNetworkWorkspace } from "../generationNetworks";
import { planHash } from "../planHash";
import { createRefinementState, refinementInputFields, refinementResolution } from "./inputs";
import { clearRegionalProducts } from "./features";
import { refineTerrain } from "./terrain";
import { refineWater } from "./water";
import { extractRegionalWater } from "./geography";
import { refinementPublications } from "./publication";
import type { RefinementState } from "./state";
import { refineLocalConditions, refineLivingCover, extractRegionalHabitats } from "./living";
import { refineMagic } from "./magic";
import { classifyRegionalMagic } from "./magicCartography";
import { refinePlaces } from "./places";
import { extractRegionalLandforms } from "./landforms";

const stages: [string, (state: RefinementState) => void][] = [
  ["terrain", refineTerrain],
  ["climate", refineLocalConditions],
  ["water", refineWater],
  ["magic", refineMagic],
  ["landforms", extractRegionalLandforms],
  ["geography", extractRegionalWater],
  ["habitats", refineLivingCover],
  ["magic-places", classifyRegionalMagic],
  ["landscapes", extractRegionalHabitats],
  ["places", refinePlaces],
];
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
    id: "regional-surface-refinement",
    version: 1,
    parameters: {},
    sequence: stages.map(([id]) => ({
      kind: "process" as const,
      id: `refinement.${id}`,
      process: `refinement.${id}`,
      version: "1",
    })),
  };
  return { source, input: { ...input, configuration }, diagnostics };
}
export async function refineRegionalMap(
  source: DomainSnapshot,
  input: AtlasGenerationInput,
  options: Omit<MapRunnerOptions, "seed" | "seedScope"> = {}
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
  const state = createRefinementState(source, prepared.input, options.cache);
  prepareStores(state, options);
  clearRegionalProducts(state);
  for (const [index, [id, apply]] of stages.entries()) {
    if (
      ["landforms", "geography", "landscapes"].includes(id) &&
      !input.domains.some((domain) => domain === "physical" || domain === "magic")
    )
      continue;
    check();
    await options.yieldControl?.();
    options.progress?.(
      ["refinement", id],
      (index + 1) / (stages.length + 2),
      `Developing regional ${id}`
    );
    apply(state);
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
      publications: refinementPublications(state),
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
function releaseWorkingState(state: RefinementState) {
  state.surface.coverage.release(state.inheritedHeight);
  if (state.terrain)
    for (const band of Object.values(state.terrain)) state.surface.coverage.release(band);
  if (state.drainage) {
    state.surface.coverage.release(state.drainage.receiver);
    state.surface.coverage.release(state.drainage.order);
  }
}
function prepareStores(
  state: RefinementState,
  options: Omit<MapRunnerOptions, "seed" | "seedScope">
) {
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
