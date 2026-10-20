import {
  areaSpace,
  createGrid,
  createAdaptiveField,
  createAdaptiveTopology,
  resampleChannels,
  spatial,
  canonryMagicPresets,
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
import { thermalMagicProcess, magicStorageProcess } from "./mapMagic";
import { materialMagicProcess } from "./mapMagicEffects";
import { culturalProcess, politicalProcess } from "./mapPeople";
import { builtProcess } from "./mapBuilt";
import { prepareGeneratedProcess } from "./mapFeatures";
import { atlasNativeProcesses } from "./canonry/atlasProcesses";
import { atlasPhysicalSequence } from "./canonry/atlasSequence";
import { atlasQuality } from "./canonry/atlasProfile";
import { atlasParametersSchema, type AtlasParameters } from "./atlasParameters";
import {
  generationSettingsSchema,
  worldGenerationSettings,
  type GenerationSettings,
} from "./generationSettings";
import { preflight } from "./preflight";
import { processConfigurationSchema } from "./configurationSchema";
import {
  selectedSequence,
  selectionDiagnostics,
  ecologicalMagicDiagnostics,
} from "./processSelection";
import { inheritedChannelNames, inheritedNativeFacts } from "./canonry/inheritedFacts";

export interface AtlasGenerationInput {
  areaId: string;
  domains: string[];
  quality: string;
  seed: number;
  parameters?: Partial<AtlasParameters>;
  processes?: Record<string, boolean>;
  settings?: GenerationSettings;
  configuration?: ProcessConfiguration;
}
const processes = [
  thermalMagicProcess,
  magicStorageProcess,
  culturalProcess,
  politicalProcess,
  builtProcess,
  materialMagicProcess,
];

export async function generateAtlas(
  source: DomainSnapshot,
  input: AtlasGenerationInput,
  options: Omit<MapRunnerOptions, "seed" | "seedScope"> = {}
) {
  const prepared = prepareAtlasGeneration(source, input);
  input = prepared.input;
  source = prepared.source;
  if (prepared.diagnostics.length)
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
  delete result.state.physical;
  return result;
}

export function atlasRegistry(source: DomainSnapshot, input: AtlasGenerationInput) {
  return [...processes, ...atlasNativeProcesses(input, source)]
    .reduce(
      (registry, process) =>
        registry.register(profileProcess(process, source.world.areas[input.areaId].profile)),
      new MapProcessRegistry()
    )
    .register(prepareGeneratedProcess(input.domains));
}
function profileProcess(process: MapProcess, profile: string): MapProcess {
  if (process.contract.id !== "built.layout" || ["site", "interior"].includes(profile))
    return process;
  return { ...process, contract: { ...process.contract, requires: ["elevation"] } };
}

export function prepareAtlasGeneration(source: DomainSnapshot, input: AtlasGenerationInput) {
  source = configuredSource(source, input);
  checkRunInputs(source, input);
  input = {
    ...input,
    settings: worldGenerationSettings(source.world),
    parameters: atlasParametersSchema.parse(input.parameters ?? {}),
    processes: input.processes ?? {},
  };
  const configuration = atlasConfiguration(source, input);
  checkReviewedConfiguration(input, configuration);
  input = { ...input, configuration };
  const registry = atlasRegistry(source, input);
  const diagnostics = selectionDiagnostics(
    input.processes ?? {},
    registry.contracts().map((contract) => contract.id)
  );
  checkNewSelection(source, input);
  diagnostics.push(
    ...ecologicalMagicDiagnostics(
      input.processes ?? {},
      input.domains,
      source.world.magicSystems ?? []
    )
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
  return { ...source, world: { ...source.world, ...settings } };
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
  if (Object.values(input.processes ?? {}).some((enabled) => !enabled))
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
  const size = Math.sqrt(quality.baseCells);
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
  // A child keeps its parent's boundary band. Fine numerical work occupies the
  // interior; parent samples remain authoritative at the established interface.
  const band = Math.min(extent[2] - extent[0], extent[3] - extent[1]) / size;
  const interior = area.boundary ? spatial.buffer(area.footprint, -band) : area.footprint;
  requireThat(
    interior && spatial.area(interior) > 0,
    "generation_extent",
    "Choose an extent with room for interior field samples."
  );
  const id = semanticId(domain.world.id, "surface", `${area.id}:${input.seed}`);
  const aspect = Math.sqrt((extent[2] - extent[0]) / (extent[3] - extent[1]));
  const surface =
    area.profile !== "world" && area.profile !== "interior"
      ? createAdaptiveField(
          id,
          { ...scope, footprint: interior },
          createAdaptiveTopology(extent, {
            maximumSize: Math.max(extent[2] - extent[0], extent[3] - extent[1]) / size,
            minimumSize: Math.max(extent[2] - extent[0], extent[3] - extent[1]) / size,
          })
        )
      : createGrid(
          id,
          { ...scope, footprint: interior },
          area.profile === "interior" ? size : Math.max(2, Math.ceil(size * aspect) + 1),
          area.profile === "interior" ? size : Math.max(2, Math.ceil(size / aspect) + 1)
        );
  inheritSurface(source, surface, input);
  return { domain, surface, facts: initialFacts(surface), history: [], causes: [] };
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
  const settings = generationSettingsSchema.parse(
    input.settings ?? worldGenerationSettings(source.world)
  );
  source = { ...source, world: { ...source.world, ...settings } };
  const sequence = configuredSequence(source, input);
  return {
    id: `atlas:${source.world.areas[input.areaId].profile}`,
    version: 3,
    parameters: {
      ...atlasParametersSchema.parse(input.parameters ?? {}),
      magicConfiguration: JSON.stringify(source.world.magicSystems ?? canonryMagicPresets()),
    },
    sequence: selectedSequence(sequence, input.processes ?? {}),
    inputs: {
      settings: settings as unknown as ParameterValues,
      seed: input.seed,
      quality: input.quality,
      processes: input.processes ?? {},
    },
  };
}
function configuredSequence(source: DomainSnapshot, input: AtlasGenerationInput): ProcessSequence {
  const sequence: ProcessSequence = [invoke(prepareGeneratedProcess(input.domains))];
  const area = source.world.areas[input.areaId],
    physical = input.domains.includes("physical");
  if (area.profile !== "interior" && (physical || input.domains.includes("magic"))) {
    sequence.push(...atlasPhysicalSequence(source, input));
  }
  if (input.domains.includes("cultural")) sequence.push(invoke(culturalProcess));
  if (input.domains.includes("political")) sequence.push(invoke(politicalProcess));
  if (input.domains.includes("built")) sequence.push(invoke(builtProcess));
  requireThat(
    sequence.length > 1,
    "profile_domains",
    "Choose a generation domain supported by this profile."
  );
  return sequence;
}
