import {
  areaSpace,
  createGrid,
  resampleChannels,
  spatial,
  semanticId,
  requireThat,
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

export interface AtlasGenerationInput {
  areaId: string;
  domains: string[];
  quality: string;
  seed: number;
  parameters?: Partial<AtlasParameters>;
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
  requireThat(
    input.domains.length &&
      input.domains.every((d) =>
        ["physical", "magic", "cultural", "political", "built"].includes(d)
      ),
    "generation_domains",
    "Select at least one generation domain."
  );
  requireThat(Number.isInteger(input.seed), "generation_seed", "Use an integer generation seed.");
  input = { ...input, parameters: atlasParametersSchema.parse(input.parameters ?? {}) };
  options.progress?.(["prepare"], 0, "Sampling inherited geography");
  const initial = initialState(source, input);
  const registry = [...processes, ...atlasNativeProcesses(input)]
    .reduce((r, process) => r.register(process), new MapProcessRegistry())
    .register(prepareGeneratedProcess(input.domains));
  const configuration = atlasConfiguration(source, input);
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

function initialState(source: DomainSnapshot, input: AtlasGenerationInput): GenerationState {
  const domain = structuredClone(source),
    area = domain.world.areas[input.areaId];
  requireThat(area, "generation_area", "Choose an existing mapped area.");
  const size = atlasQuality[input.quality as keyof typeof atlasQuality]?.samples;
  requireThat(size, "generation_quality", "Choose draft, standard or fine detail.");
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
  const surface = createGrid(
    semanticId(domain.world.id, "surface", `${area.id}:${input.seed}`),
    { ...scope, footprint: interior },
    size,
    size
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
  return {
    id: `atlas:${area.profile}`,
    version: 2,
    parameters: atlasParametersSchema.parse(input.parameters ?? {}),
    sequence,
  };
}
