import {
  DomainError,
  fieldInterpolator,
  sweepBudget,
  mappedGenerationDiagnostics,
  requireThat,
  spatial,
  type DomainSnapshot,
  type Diagnostic,
} from "@atlas/domain";
import { atlasRegistry, resolveInput, type AtlasGenerationInput } from "../atlasWorkflow";
import { nativePosition } from "../world/atlasWorkspace";
import { units } from "../world/math";
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
  ProcessConfiguration,
  ProcessInvocation,
  ProcessSequence,
} from "../process";
import {
  isRegionalRefinement,
  parentSampleSpan,
  refinementInputFields,
  refinementResolution,
  regionalInitialState,
} from "./capture";
import "./causes/index";
import { prepareMagic } from "./magic/index";
import { Contributions } from "./media";
import { regionalProfile } from "./profile";
import { regionalExtraction, regionalSchedule, type ScheduledStep } from "./schedule";
import type { RegionalState } from "./state";

type Options = Omit<MapRunnerOptions, "seed" | "seedScope">;
const version = "3";

/**
 * Attach the regional work to a generation state whose physical workspace exists: the
 * captured elevation, the ledger, the round counter and the regional reading of the
 * extraction thresholds. Called once by `refinement.begin`, and by fixtures that build the
 * same state without the runner.
 */
export function beginRegional(state: GenerationState, input: AtlasGenerationInput): RegionalState {
  requireThat(state.physical, "physical_workspace", "Initialize the physical mesh first.");
  const work = state.physical,
    map = work.map,
    physical = input.domains.includes("physical"),
    parentSpan = parentSampleSpan(state.domain, input.areaId, physical),
    inheritedHeight = map.coverage.copyBand(map.Elevation);
  inheritedHeight.retain();
  regionalProfile(work.profile, parentSpan, map.scale);
  inheritDerived(state);
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
    proposed: [],
  };
  const begun = Object.assign(state, { physical: work, regional });
  // The world's magic workspace on the regional field, when this run develops magic.
  if (input.domains.includes("magic")) prepareMagic(begun);
  return begun;
}

/**
 * Captured channels the projection derives rather than binds (discharge, lake level) have no
 * inheritance binding; a refinement reads them as the evidence of its rivers and lakes.
 */
function inheritDerived(state: GenerationState) {
  const work = state.physical!,
    map = work.map,
    surface = state.surface,
    at = (name: string) =>
      surface.channels[name]
        ? fieldInterpolator(surface, name, false, undefined, sweepBudget(surface))
        : undefined,
    flow = at("flow"),
    level = at("waterLevel");
  for (let i = 0; i < map.mesh.count; i++) {
    const p = nativePosition(work, i);
    if (flow) map.FlowAccumulation.set(i, Math.max(0, flow(p)));
    if (level && map.WaterKindCodes.get(i) === 2)
      map.WaterSurfaceElevations.set(i, map.BaseSeaLevel + units(level(p)));
  }
}
function stepProcess(step: ScheduledStep, produces: string[] = []): MapProcess {
  return {
    contract: {
      id: `refinement.${step.id}`,
      version,
      parameters: {},
      requires: ["atlas:workspace"],
      produces,
      invalidates: [],
      workspaceOnly: !step.publishes,
    },
    behavior: {
      kind: step.publishes ? "extract" : "model-pass",
      ...(step.publishes
        ? {
            extract(state, context) {
              context.progress(0, step.message);
              step.run(state as RegionalState, context);
            },
          }
        : {
            applyPass(state, context) {
              context.progress(0, step.message);
              step.run(state as RegionalState, context);
            },
          }),
    } as MapProcess["behavior"],
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
    behavior: {
      kind: "initialize",
      initialize(state, context) {
        const bound = generationBindings(context);
        beginRegional(state, { ...input, seed: bound.seed, quality: bound.quality });
      },
    },
    validate: () => [],
  };
}
/**
 * The regional processes: the schedule's steps as processes beside the world's own. The
 * refresh leaves the field routed and classified, which is the state the world's extraction
 * requires (`atlas:validated`); the world's own validation operation checks world-process
 * invariants that a refinement does not run, so the refresh produces the fact itself.
 */
export function regionalProcesses(input: AtlasGenerationInput): MapProcess[] {
  return [
    beginProcess(input),
    ...regionalSchedule(input.domains).map((step) =>
      stepProcess(step, step.id === "refresh" ? ["atlas:validated"] : [])
    ),
    ...regionalExtraction(input.domains)
      .filter((step) => step.id !== "features")
      .map((step) => stepProcess(step)),
  ];
}
export function regionalRegistry(
  source: DomainSnapshot,
  input: AtlasGenerationInput
): MapProcessRegistry {
  const registry = atlasRegistry(source, input);
  for (const process of regionalProcesses(input)) registry.register(process);
  return registry;
}
const invoke = (id: string, processVersion = "1", feature?: string): ProcessInvocation => ({
  kind: "process",
  id,
  process: id,
  version: id.startsWith("refinement.") ? version : processVersion,
  ...(feature ? { feature } : {}),
});
/** The capability a regional step stands for in the setup view: its water and climate steps. */
function stepFeature(id: string) {
  if (id.endsWith("/water")) return "water.routing";
  if (id.endsWith("/environment")) return "physical.climate";
  return undefined;
}
/**
 * The fixed coupled realization schedule as a process sequence (spec 7): the world's
 * initialization builds the field on the child lattice, the regional steps develop it, the
 * world's projection and extraction publish it, and the regional identity and place steps
 * finish with what only a refinement knows.
 */
export function regionalSequence(input: AtlasGenerationInput): ProcessSequence {
  return [
    invoke("atlas.initialize"),
    invoke("refinement.begin"),
    ...regionalSchedule(input.domains).map((step) =>
      invoke(`refinement.${step.id}`, undefined, stepFeature(step.id))
    ),
    invoke("atlas.project"),
    ...regionalExtraction(input.domains).flatMap((step) =>
      step.id === "features"
        ? [invoke("atlas.features"), invoke("atlas.magic-places")]
        : [invoke(`refinement.${step.id}`)]
    ),
    invoke("atlas.names", "1"),
  ];
}
function initialFacts(source: DomainSnapshot, input: AtlasGenerationInput) {
  const channels = inheritedChannelNames(source, input.areaId, input.domains.includes("physical"));
  return [...channels, ...inheritedProducts(channels)];
}

export function prepareRegionalRefinement(source: DomainSnapshot, input: AtlasGenerationInput) {
  const diagnostics: Diagnostic[] = [],
    area = source.world.areas[input.areaId];
  requireThat(area?.map, "regional_map", "Refinement needs an independent captured map.");
  refinementResolution(source, input);
  // A drawing edited on this map or its space must survive: the same rule as the world's.
  diagnostics.push(...mappedGenerationDiagnostics(source, input.areaId));
  if (!refinementInputFields(source, input.areaId).some((f) => f.channels?.includes("elevation")))
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
    sequence: regionalSequence(resolved),
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
  delete result.state.society;
  return result;
}
