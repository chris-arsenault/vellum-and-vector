import {
  areaSpace,
  createGrid,
  createAdaptiveField,
  createAdaptiveTopology,
  resampleChannels,
  spatial,
  semanticId,
  requireThat,
  cloneSnapshot,
  sameValue,
  type ParameterValues,
  DomainError,
  type DomainSnapshot,
  type Grid,
} from "@atlas/domain";
import { MapRunner, type MapRunnerOptions } from "./mapRunner";
import {
  MapProcessRegistry,
  type GenerationState,
  type MapProcess,
  type ProcessConfiguration,
  type ProcessSequence,
} from "./process";
import { prepareGeneratedProcess } from "./mapFeatures";
import { finalizeNamesProcess } from "./societyNaming";
import { atlasPhysicalSequence } from "./canonry/atlasSequence";
import { atlasQuality } from "./canonry/atlasProfile";
import { generationResolution } from "./resolution";
import { atlasParametersSchema, mapBoundaryName, type AtlasParameters } from "./atlasParameters";
import {
  generationSettingsSchema,
  worldGenerationSettings,
  type GenerationSettings,
} from "./generationSettings";
import { preflight } from "./preflight";
import { processConfigurationSchema } from "./configurationSchema";
import {
  resolveGenerationFeatures,
  type FeatureSelection,
  type ResolvedFeatures,
} from "./features";
import { atlasGenerationModules } from "./atlasModules";
import { serializableBindings } from "./generationBindings";
import { inheritedChannelNames, inheritedNativeFacts } from "./canonry/inheritedFacts";
import { societySequence } from "./societyProcesses";
import { boundaryDiagnostics, migrateBoundarySelection, inheritMapBoundary } from "./worldBoundary";

export interface AtlasGenerationInput {
  areaId: string;
  domains: string[];
  quality: string;
  seed: number;
  parameters?: Partial<AtlasParameters>;
  processes?: Record<string, boolean>;
  features?: FeatureSelection;
  resolvedFeatures?: ResolvedFeatures;
  settings?: GenerationSettings;
  configuration?: ProcessConfiguration;
}
export const atlasFeatureDefinitions = atlasGenerationModules.features();

export async function generateAtlas(
  source: DomainSnapshot,
  input: AtlasGenerationInput,
  options: Omit<MapRunnerOptions, "seed" | "seedScope"> = {}
) {
  const prepared = prepareAtlasGeneration(source, input);
  input = prepared.input;
  source = prepared.source;
  if (prepared.diagnostics.some((diagnostic) => diagnostic.severity === "error"))
    throw new DomainError(
      "generation_configuration",
      prepared.diagnostics.map((item) => item.message).join("\n"),
      prepared.diagnostics
    );
  options.progress?.(["prepare"], 0, "Sampling inherited geography");
  const initial = initialState(source, input);
  const registry = atlasRegistry(source, input);
  const configuration = input.configuration!;
  const result = await new MapRunner(configuration, registry).run(initial, {
    ...options,
    seed: String(input.seed),
    seedScope: JSON.stringify([
      source.world.areas[input.areaId].profile,
      spatial.bounds(source.world.areas[input.areaId].footprint),
    ]),
  });
  // Numerical scratch never leaves the worker or becomes a saved execution state.
  result.state.publications = atlasGenerationModules.publications(input, result.state.domain.world);
  delete result.state.physical;
  delete result.state.society;
  return result;
}

export function atlasRegistry(source: DomainSnapshot, input: AtlasGenerationInput) {
  input = resolveInput(source, input);
  return atlasGenerationModules
    .processes(source, input)
    .reduce((registry, process) => registry.register(process), new MapProcessRegistry())
    .register(prepareGeneratedProcess(input.domains))
    .register(finalizeNamesProcess(source));
}

export function prepareAtlasGeneration(source: DomainSnapshot, input: AtlasGenerationInput) {
  input = structuredClone(input);
  input.features = migrateBoundarySelection(input.features);
  input = inheritMapBoundary(source, input);
  source = configuredSource(source, input);
  checkRunInputs(source, input);
  input = {
    ...input,
    settings: worldGenerationSettings(source.world),
    parameters: atlasParametersSchema.parse(input.parameters ?? {}),
    processes: input.processes ?? {},
  };
  input = resolveInput(source, input);
  source = configuredSource(source, input);
  const resolvedFeatures = input.resolvedFeatures!;
  const configuration = atlasConfiguration(source, input);
  checkReviewedConfiguration(input, configuration);
  input = { ...input, configuration };
  const registry = atlasRegistry(source, input);
  const diagnostics = [
    ...boundaryDiagnostics(input),
    ...resolvedFeatures.diagnostics.filter((item) => item.code !== "feature_dependency"),
  ];
  checkNewSelection(source, input);
  diagnostics.push(
    ...atlasGenerationModules.dependencyDiagnostics({ source, input, resolved: resolvedFeatures })
  );
  const inherited = usesInheritedInputs(source, input);
  const initial = inherited ? inheritedFactsForRun(source, input) : [];
  diagnostics.push(...preflight(configuration, registry, initial));
  return { input, source, registry, diagnostics };
}
function checkRunInputs(source: DomainSnapshot, input: AtlasGenerationInput) {
  requireThat(
    input.domains.length &&
      input.domains.every((domain) =>
        ["physical", "magic", "cultural", "political", "built"].includes(domain)
      ),
    "generation_domains",
    "Select at least one generation domain."
  );
  requireThat(Number.isInteger(input.seed), "generation_seed", "Use an integer generation seed.");
  requireThat(
    input.quality in atlasQuality,
    "generation_quality",
    "Choose draft, standard or fine."
  );
  if (
    !input.domains.includes("physical") &&
    source.world.areas[input.areaId].profile !== "interior"
  )
    requireThat(
      inheritedChannelNames(source, input.areaId, false).has("elevation"),
      "generation_prerequisite",
      "Generate physical geography first, or include Land, climate and water in this request."
    );
}
function inheritedFactsForRun(source: DomainSnapshot, input: AtlasGenerationInput) {
  const channels = inheritedChannelNames(source, input.areaId, input.domains.includes("physical"));
  return [...channels, ...inheritedNativeFacts(channels).map((fact) => `canonry:${fact}`)];
}
function configuredSource(source: DomainSnapshot, input: AtlasGenerationInput) {
  const settings = generationSettingsSchema.parse(
    input.settings ?? worldGenerationSettings(source.world)
  );
  const area = source.world.areas[input.areaId];
  requireThat(area, "generation_area", "Choose an existing mapped area.");
  if (area.parentId || source.world.generations.some((run) => run.domains.includes("physical")))
    requireThat(
      sameValue(settings, worldGenerationSettings(source.world)),
      "completed_history",
      "Inherited and completed history stays fixed. Configure the new world before its first generation."
    );
  const stable =
    area.parentId || source.world.generations.some((run) => run.domains.includes("physical"));
  const boundaryMode = stable
    ? (source.world.reference.boundaryMode ?? "none")
    : mapBoundaryName(atlasParametersSchema.parse(input.parameters ?? {}).mapBoundary);
  return {
    ...source,
    world: { ...source.world, ...settings, reference: { ...source.world.reference, boundaryMode } },
  };
}
function checkReviewedConfiguration(
  input: AtlasGenerationInput,
  configuration: ProcessConfiguration
) {
  if (input.configuration)
    requireThat(
      sameValue(processConfigurationSchema.parse(input.configuration), configuration),
      "generation_configuration",
      "The reviewed configuration does not match these generation inputs."
    );
}
function usesInheritedInputs(source: DomainSnapshot, input: AtlasGenerationInput) {
  return (
    Boolean(source.world.areas[input.areaId].parentId) ||
    (!input.domains.includes("physical") && source.world.fields.length > 0)
  );
}
function checkNewSelection(source: DomainSnapshot, input: AtlasGenerationInput) {
  if (
    Object.values(input.processes ?? {}).some((enabled) => !enabled) ||
    Object.values(input.features ?? {}).some((feature) => feature.enabled === false)
  )
    requireThat(
      !source.world.generations.some((run) => run.areaId === input.areaId),
      "process_selection",
      "Process omission is available for new worlds and newly created regions. Existing-map regeneration keeps its current process configuration."
    );
}

function initialState(source: DomainSnapshot, input: AtlasGenerationInput): GenerationState {
  const domain = cloneSnapshot(source),
    area = domain.world.areas[input.areaId];
  requireThat(area, "generation_area", "Choose an existing mapped area.");
  const quality = atlasQuality[input.quality as keyof typeof atlasQuality];
  requireThat(quality, "generation_quality", "Choose draft, standard or fine detail.");
  const scope = {
    worldId: domain.world.id,
    areaId: area.id,
    spaceId: areaSpace(domain.world, area.id),
    footprint: area.footprint,
    crsId: domain.world.reference.id,
    revision: domain.world.version,
    time: "present",
    resolution: null,
  };
  domain.scope = scope;
  const extent = spatial.bounds(area.footprint);
  const { cellSpan } = generationResolution(input.quality, area.profile);
  // A child keeps its parent's boundary band. Fine numerical work occupies the
  // interior; parent samples remain authoritative at the established interface.
  const band = Math.min(cellSpan, (extent[2] - extent[0]) / 4, (extent[3] - extent[1]) / 4);
  const interior = area.boundary ? spatial.buffer(area.footprint, -band) : area.footprint;
  requireThat(
    interior && spatial.area(interior) > 0,
    "generation_extent",
    "Choose an extent with room for interior field samples."
  );
  const id = semanticId(domain.world.id, "surface", `${area.id}:${input.seed}`);
  const surface =
    area.profile !== "world" && area.profile !== "interior"
      ? createAdaptiveField(
          id,
          { ...scope, footprint: interior },
          createAdaptiveTopology(extent, {
            maximumSize: cellSpan,
            minimumSize: cellSpan,
          })
        )
      : createGrid(
          id,
          { ...scope, footprint: interior },
          Math.max(2, Math.ceil((extent[2] - extent[0]) / cellSpan) + 1),
          Math.max(2, Math.ceil((extent[3] - extent[1]) / cellSpan) + 1)
        );
  inheritSurface(source, surface, input);
  return {
    domain,
    surface,
    facts: initialFacts(surface),
    history: [],
    causes: [],
    publications: atlasGenerationModules.publications(input, domain.world),
  };
}
function inheritSurface(source: DomainSnapshot, target: Grid, input: AtlasGenerationInput) {
  const world = source.world;
  const available = world.fields.filter(
    (f) =>
      f.spaceId === target.scope.spaceId &&
      !(input.domains.includes("physical") && f.areaId === input.areaId) &&
      source.numerical[f.id] &&
      spatial.covers(source.numerical[f.id].scope.footprint, target.scope.footprint)
  );
  for (const field of available) {
    const grid = source.numerical[field.id];
    resampleChannels(grid, target);
  }
  requireThat(
    input.domains.includes("physical") ||
      target.channels.elevation ||
      world.areas[input.areaId].profile === "interior",
    "generation_prerequisite",
    "Generate physical geography first, or include it in this request."
  );
}
function initialFacts(surface: Grid) {
  const facts = new Set(Object.keys(surface.channels));
  if (surface.channels.bedrock) facts.add("geology");
  if (surface.channels.receiver) facts.add("drainage");
  return facts;
}
function invoke(process: MapProcess, id = process.contract.id) {
  return {
    kind: "process" as const,
    id,
    process: process.contract.id,
    version: process.contract.version,
  };
}
export function atlasConfiguration(
  source: DomainSnapshot,
  input: AtlasGenerationInput
): ProcessConfiguration {
  input = resolveInput(source, input);
  const settings = input.settings!,
    features = input.resolvedFeatures!;
  source = { ...source, world: { ...source.world, ...settings } };
  const sequence = configuredSequence(source, input);
  return {
    id: `atlas:${source.world.areas[input.areaId].profile}`,
    version: 4,
    parameters: atlasParametersSchema.parse(input.parameters ?? {}),
    sequence,
    inputs: serializableBindings({
      settings,
      features,
      seed: input.seed,
      quality: input.quality,
      publications: atlasGenerationModules.publications(input, source.world),
      reconciliations: atlasRegistry(source, input).reconciliations(),
      domains: input.domains,
      parameters: features.parameters,
    }),
  };
}
function configuredSequence(source: DomainSnapshot, input: AtlasGenerationInput): ProcessSequence {
  const sequence: ProcessSequence = [invoke(prepareGeneratedProcess(input.domains))];
  const area = source.world.areas[input.areaId],
    physical = input.domains.includes("physical");
  if (area.profile !== "interior" && (physical || input.domains.includes("magic"))) {
    sequence.push(...atlasPhysicalSequence(source, input));
  }
  for (const slot of ["present.products", "present.people", "present.after-people"]) {
    if (
      slot === "present.people" &&
      !["site", "interior"].includes(area.profile) &&
      ["human.cultures", "human.politics", "built.layout"].some(
        (id) => input.resolvedFeatures!.selection[id]?.enabled
      )
    )
      sequence.push(...societySequence(input));
    sequence.push(
      ...atlasGenerationModules.contribute(slot, input.resolvedFeatures!, {
        source,
        input,
        resolved: input.resolvedFeatures!,
      })
    );
  }
  requireThat(
    sequence.length > 1,
    "profile_domains",
    "Choose a generation domain supported by this profile."
  );
  sequence.push(invoke(finalizeNamesProcess(source)));
  return sequence;
}
function resolveInput(source: DomainSnapshot, input: AtlasGenerationInput): AtlasGenerationInput {
  const suppliedSettings = generationSettingsSchema.parse(
    input.settings ?? worldGenerationSettings(source.world)
  );
  const legacySettings = atlasGenerationModules.prepareSettings(
    input.features ?? {},
    suppliedSettings
  );
  const resolvedFeatures = resolveGenerationFeatures(
    atlasFeatureDefinitions,
    input.features,
    input.processes,
    input.parameters,
    input.domains,
    legacySettings as unknown as ParameterValues
  );
  const settings = generationSettingsSchema.parse(
    atlasGenerationModules.bindSettings(resolvedFeatures, legacySettings)
  );
  return { ...input, settings, resolvedFeatures, parameters: resolvedFeatures.parameters };
}
