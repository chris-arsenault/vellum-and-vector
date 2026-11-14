import {
  DomainError,
  mappedGenerationDiagnostics,
  requireThat,
  spatial,
  type DomainSnapshot,
  type Diagnostic,
} from "@atlas/domain";
import { atlasRegistry, resolveInput, type AtlasGenerationInput } from "../atlasWorkflow";
import { atlasGenerationModules } from "../atlasModules";
import { atlasParametersSchema } from "../atlasParameters";
import { generationBindings, serializableBindings } from "../generationBindings";
import { inheritedChannelNames, inheritedProducts } from "../world/inheritedFacts";
import { MapRunner, type MapRunnerOptions } from "../mapRunner";
import { preflight } from "../preflight";
import type {
  CompletedBoundary,
  GenerationState,
  MapProcess,
  MapProcessRegistry,
  MapProcessContext,
  ProcessConfiguration,
} from "../process";
import {
  isRegionalRefinement,
  capturedEpochCount,
  parentSampleSpan,
  refinementInputFields,
  refinementResolution,
  regionalInitialState,
} from "./capture";
import { requireGeography } from "../geographyRequired";
import "./causes/index";
import { prepareMagic } from "./magic/index";
import { Contributions } from "../coupling/fieldContributions";
import { regionalProfile } from "./profile";
import { regionalOperations, regionalAtmosphere, type ScheduledStep } from "./schedule";
import { regionalSequence } from "./sequence";
import { prepareClimate, bindRegionalClimate } from "./climate";
import { profileForExecution } from "../processes/processCatalogue";
import type { RegionalState } from "./state";
import { bindRegionalWater } from "./drainage";
import { bindRegionalOceanDistance } from "./sharedMedia";
import { mapCommand } from "../processTraits";
import { inheritRivers } from "../water/networkImport";

type Options = Omit<MapRunnerOptions, "seed" | "seedScope">;
const version = "1";

/**
 * Attach the regional work to a generation state whose physical workspace exists: the
 * captured elevation, the ledger, the round counter and the regional reading of the
 * extraction thresholds. Called once by `refinement.begin`, and by fixtures that build the
 * same state without the runner.
 */
export function beginRegional(
  state: GenerationState,
  input: AtlasGenerationInput,
  context: MapProcessContext
): RegionalState {
  requireThat(state.physical, "physical_workspace", "Initialize the physical mesh first.");
  const work = state.physical,
    map = work.map,
    parentSpan = parentSampleSpan(state.domain, input.areaId),
    inheritedHeight = map.coverage.copyBand(map.Elevation);
  inheritedHeight.retain();
  map.CompletedEpochCount = capturedEpochCount(state.domain, input.areaId);
  regionalProfile(work.profile, parentSpan, map.scale);
  // Native invocation workSpan apportions local exposure; do not divide the rates again.
  work.profile = profileForExecution(work.profile, { refined: true, passes: 1 });
  const regional: RegionalState["regional"] = {
    input: {
      areaId: input.areaId,
      quality: input.quality,
      seed: input.seed,
      domains: input.domains,
    },
    parentSpan,
    inheritedHeight,
    natural: {},
    contributions: new Contributions(map.mesh.count),
    round: 0,
  };
  const begun = Object.assign(state, { physical: work, regional });
  const capturedRivers = state.domain.world.drainage?.[input.areaId];
  if (capturedRivers)
    inheritRivers(
      map,
      capturedRivers,
      (id) => state.sourceFeatures?.get(id) ?? state.domain.world.features[id]
    );
  bindRegionalStrategies(begun, input, context);
  return begun;
}
function bindRegionalStrategies(
  state: RegionalState,
  input: AtlasGenerationInput,
  context: MapProcessContext
) {
  const enabled = (name: string) => input.resolvedFeatures?.selection[name]?.enabled;
  if (enabled("water.routing")) bindRegionalWater(state);
  if (enabled("ocean.geography")) bindRegionalOceanDistance(state);
  // The world's magic workspace on the regional field, when this run develops magic.
  if (enabled("magic.configured")) prepareMagic(state);
  prepareClimate(state);
  if (enabled("physical.climate")) bindRegionalClimate(state, context, regionalAtmosphere);
}

function stepProcess(step: ScheduledStep): MapProcess {
  return {
    contract: {
      id: `refinement.${step.id}`,
      version,
      parameters: {
        round: { type: "number", unit: null, required: false, default: 0 },
        people: { type: "boolean", unit: null, required: false, default: false },
      },
      requires: ["atlas:workspace"],
      produces: step.produces ?? [],
      invalidates: [],
      workspaceOnly: step.operation.kind !== "publish",
    },
    operation: step.operation,
    validate: (state) => {
      requireThat(state.physical, "physical_workspace", "Initialize the physical mesh first.");
      return [];
    },
  };
}

function beginProcess(input: AtlasGenerationInput): MapProcess {
  return {
    contract: {
      id: "refinement.begin",
      version,
      parameters: {},
      requires: ["atlas:workspace"],
      produces: [],
      invalidates: [],
      workspaceOnly: true,
    },
    operation: mapCommand(
      "refinement.begin",
      "initialize",
      (state, context) => {
        const bound = generationBindings(context);
        beginRegional(state, { ...input, seed: bound.seed, quality: bound.quality }, context);
      },
      []
    ),
    validate: () => [],
  };
}
/**
 * Regional specializations register beside shared operations. Final refresh calls the
 * same physical publication validator; refinement does not replay historical bookkeeping.
 */
export function regionalProcesses(input: AtlasGenerationInput): MapProcess[] {
  return [beginProcess(input), ...regionalOperations.map((step) => stepProcess(step))];
}
export function regionalRegistry(
  source: DomainSnapshot,
  input: AtlasGenerationInput
): MapProcessRegistry {
  const registry = atlasRegistry(source, input);
  for (const process of regionalProcesses(input)) registry.register(process);
  return registry;
}
function initialFacts(source: DomainSnapshot, input: AtlasGenerationInput) {
  const channels = inheritedChannelNames(source, input.areaId);
  return [...channels, ...inheritedProducts(channels)];
}

export function prepareRegionalRefinement(source: DomainSnapshot, input: AtlasGenerationInput) {
  const diagnostics: Diagnostic[] = [],
    area = source.world.areas[input.areaId];
  requireThat(area?.map, "regional_map", "Refinement needs an independent captured map.");
  requireGeography(source, input);
  refinementResolution(source, input);
  // A drawing edited on this map or its space must survive: the same rule as the world's.
  diagnostics.push(...mappedGenerationDiagnostics(source, input.areaId));
  if (!refinementInputFields(source, input.areaId).some((f) => f.channels?.includes("Elevation")))
    diagnostics.push({
      code: "regional_parent",
      severity: "error",
      invocation: null,
      resource: input.areaId,
      message: "Capture parent terrain before refining this map.",
    });
  const resolved = resolveInput(source, {
    ...input,
    parameters: atlasParametersSchema.parse(input.parameters ?? {}),
  });
  // A refinement reads a completed world: its settings (epochs, eras, systems) stay as they
  // are recorded; the resolved settings travel with the input, never back into the world.
  const configured = source;
  const registry = regionalRegistry(configured, resolved);
  const configuration: ProcessConfiguration = {
    id: "regional-bidirectional-refinement",
    version: 3,
    parameters: resolved.parameters ?? {},
    sequence: regionalSequence(configured, resolved),
    inputs: serializableBindings({
      settings: resolved.settings!,
      features: resolved.resolvedFeatures!,
      seed: resolved.seed,
      quality: resolved.quality,
      publications: atlasGenerationModules.publications(resolved, configured.world),
      reconciliations: registry.reconciliations(),
      domains: resolved.domains,
      parameters: resolved.resolvedFeatures!.parameters,
    }),
  };
  if (!diagnostics.length)
    diagnostics.push(...preflight(configuration, registry, initialFacts(source, input)));
  return {
    source: configured,
    input: { ...resolved, configuration },
    diagnostics,
    registry,
  };
}

/** Run the refinement through the generator's runner and publish its geography once. */
export async function refineRegionalMap(
  source: DomainSnapshot,
  input: AtlasGenerationInput,
  options: Options = {}
): Promise<CompletedBoundary> {
  requireThat(
    isRegionalRefinement(source, input.areaId),
    "regional_map",
    "Refinement needs an independent captured map."
  );
  const prepared = prepareRegionalRefinement(source, input);
  if (prepared.diagnostics.some((d) => d.severity === "error"))
    throw new DomainError(
      "generation_configuration",
      prepared.diagnostics.map((d) => d.message).join("\n"),
      prepared.diagnostics
    );
  options.progress?.(["prepare"], 0, "Sampling captured regional surface");
  const initial = regionalInitialState(prepared.source, prepared.input, options.cache),
    area = prepared.source.world.areas[input.areaId],
    result = await new MapRunner(prepared.input.configuration!, prepared.registry).run(initial, {
      ...options,
      seed: String(prepared.input.seed),
      seedScope: JSON.stringify([area.profile, spatial.bounds(area.footprint)]),
    });
  // Numerical scratch never leaves the worker or becomes a saved execution state.
  result.state.publications = atlasGenerationModules.publications(
    prepared.input,
    result.state.domain.world
  );
  delete result.state.physical;
  return result;
}
